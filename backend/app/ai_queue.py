from __future__ import annotations

import asyncio
import os
from datetime import timedelta
from time import perf_counter
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from .ai import vision_provider
from .db import SessionLocal
from .models import AiJob, AssistantScan, Event, utcnow
from .schemas import AssistantAnalysisBundle, AssistantObjectAnalysis, AssistantScanOut, FunAnalysisBundle
from .storage import delete_image

TERMINAL_STATUSES = {"success", "error", "timeout"}
ACTIVE_STATUSES = {"queued", "running"}
FUN_FEATURES = {"fun_analyze", "fun_wish"}

def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


MAX_AI_IN_FLIGHT = _env_int("MAX_AI_IN_FLIGHT", 20, 1, 100)
AI_WORKER_POLL_MS = _env_int("AI_WORKER_POLL_MS", 250, 50, 5000)
AI_JOB_RETENTION_HOURS = _env_int("AI_JOB_RETENTION_HOURS", 168, 1, 168)
MAX_FUN_IN_FLIGHT = _env_int(
    "MAX_FUN_IN_FLIGHT",
    max(1, MAX_AI_IN_FLIGHT // 4),
    1,
    MAX_AI_IN_FLIGHT,
)



class AiQueueService:
    """Small PostgreSQL-backed queue for the event MVP.

    The API process also owns the dispatcher. PostgreSQL remains the source of
    truth so queued/running jobs can be recovered after a backend restart.
    """

    def __init__(self) -> None:
        self._dispatcher: asyncio.Task[None] | None = None
        self._running_tasks: set[asyncio.Task[None]] = set()
        self._stopping = False

    async def start(self) -> None:
        self._stopping = False
        with SessionLocal.begin() as db:
            # A backend restart may leave jobs marked running although no worker
            # owns them anymore. Requeue them instead of losing the request.
            db.execute(
                update(AiJob)
                .where(AiJob.status == "running")
                .values(status="queued", started_at=None, error_code=None, error_message=None)
            )
        self._dispatcher = asyncio.create_task(self._dispatch_loop(), name="brocai-ai-dispatcher")

    async def stop(self) -> None:
        self._stopping = True
        if self._dispatcher:
            self._dispatcher.cancel()
            try:
                await self._dispatcher
            except asyncio.CancelledError:
                pass
        # Let in-flight calls finish cleanly on a normal shutdown. A hard crash
        # leaves them as `running`; start() requeues those rows on recovery.
        if self._running_tasks:
            await asyncio.gather(*self._running_tasks, return_exceptions=True)

    async def _dispatch_loop(self) -> None:
        while not self._stopping:
            try:
                while len(self._running_tasks) < MAX_AI_IN_FLIGHT:
                    job_id = self._claim_next_job()
                    if job_id is None:
                        break
                    task = asyncio.create_task(self._process_job(job_id), name=f"brocai-ai-{job_id}")
                    self._running_tasks.add(task)
                    task.add_done_callback(self._running_tasks.discard)
                await asyncio.sleep(AI_WORKER_POLL_MS / 1000)
            except asyncio.CancelledError:
                raise
            except Exception:
                # The dispatcher must stay alive even if PostgreSQL has a brief
                # hiccup. Health/metrics will expose degraded behavior later.
                await asyncio.sleep(1)

    def _claim_next_job(self) -> str | None:
        with SessionLocal.begin() as db:
            # CORE always gets first access to free worker slots. This prevents
            # a FunLab burst from starving seller/assistant traffic.
            job = db.scalar(
                select(AiJob)
                .where(
                    AiJob.status == "queued",
                    AiJob.feature.notin_(FUN_FEATURES),
                )
                .order_by(AiJob.created_at.asc(), AiJob.id.asc())
                .with_for_update(skip_locked=True)
                .limit(1)
            )

            if job is None:
                fun_in_flight = int(
                    db.scalar(
                        select(func.count(AiJob.id)).where(
                            AiJob.status == "running",
                            AiJob.feature.in_(FUN_FEATURES),
                        )
                    )
                    or 0
                )
                if fun_in_flight >= MAX_FUN_IN_FLIGHT:
                    return None

                job = db.scalar(
                    select(AiJob)
                    .where(
                        AiJob.status == "queued",
                        AiJob.feature.in_(FUN_FEATURES),
                    )
                    .order_by(AiJob.created_at.asc(), AiJob.id.asc())
                    .with_for_update(skip_locked=True)
                    .limit(1)
                )

            if job is None:
                return None
            job.status = "running"
            job.started_at = utcnow()
            job.attempts += 1
            self._emit(
                db,
                job.session_id,
                "ai_analysis_started",
                {
                    "feature": job.feature,
                    "job_id": job.id,
                    "lane": "fun" if job.feature in FUN_FEATURES else "core",
                    "max_fun_in_flight": MAX_FUN_IN_FLIGHT,
                },
            )
            return job.id

    async def _process_job(self, job_id: str) -> None:
        started = perf_counter()
        with SessionLocal() as db:
            job = db.get(AiJob, job_id)
            if job is None:
                return
            feature = job.feature
            payload = dict(job.payload or {})
            sid = job.session_id

        try:
            # Provider clients own their HTTP timeout. Avoid a second asyncio
            # timeout here: cancelling a Python worker thread cannot stop the
            # underlying HTTP call safely.
            raw_result = await asyncio.to_thread(self._execute_job_sync, feature, payload, sid)
        except Exception as exc:
            code = getattr(exc, "error_code", None)
            if not isinstance(code, str) or not code:
                code = "AI-TIMEOUT" if self._looks_like_timeout(exc) else "AI-PROVIDER-ERROR"
            message = getattr(exc, "public_message", None)
            if not isinstance(message, str) or not message:
                message = self._friendly_error(exc)
            self._finish_error(job_id, code, message, started, exc=exc)
            self._cleanup_failed_upload(feature, payload)
            return

        duration_ms = round((perf_counter() - started) * 1000)
        result = dict(raw_result)
        try:
            with SessionLocal.begin() as db:
                job = db.get(AiJob, job_id)
                if job is None:
                    return

                # Persist feature-specific side effects in the same transaction as
                # the terminal job status. This keeps restart recovery idempotent.
                if feature == "assistant":
                    bundle = AssistantAnalysisBundle.model_validate(result)
                    analysis = bundle.analysis
                    stored_analysis = analysis.model_dump(mode="json")
                    stored_analysis["_assistant_quick_replies"] = bundle.quick_replies.model_dump(mode="json")
                    scan = AssistantScan(session_id=sid, analysis=stored_analysis, question_count=0)
                    db.add(scan)
                    db.flush()
                    result = AssistantScanOut(
                        **analysis.model_dump(),
                        scan_id=scan.id,
                        questions_remaining=3,
                    ).model_dump(mode="json")
                    self._emit(
                        db,
                        sid,
                        "object_scan_completed",
                        {
                            "category": analysis.category.value,
                            "confidence": analysis.confidence,
                            "mode": analysis.analysis_mode,
                            "precomputed_quick_replies": 3,
                        },
                    )

                elif feature == "fun_analyze":
                    bundle = FunAnalysisBundle.model_validate(result)
                    analysis = bundle.analysis
                    stored_analysis = analysis.model_dump(mode="json")
                    stored_analysis["_fun_bundle"] = bundle.fun.model_dump(mode="json")
                    scan = AssistantScan(session_id=sid, analysis=stored_analysis, question_count=0)
                    db.add(scan)
                    db.flush()
                    result = AssistantScanOut(
                        **analysis.model_dump(),
                        scan_id=scan.id,
                        questions_remaining=3,
                    ).model_dump(mode="json")
                    self._emit(
                        db,
                        sid,
                        "fun_object_ready",
                        {
                            "category": analysis.category.value,
                            "confidence": analysis.confidence,
                            "mode": analysis.analysis_mode,
                            "precomputed_wishes": 4,
                        },
                    )

                elif feature == "assistant_question":
                    scan = db.scalar(
                        select(AssistantScan)
                        .where(AssistantScan.id == payload["scan_id"], AssistantScan.session_id == sid)
                        .with_for_update()
                    )
                    if scan is None:
                        raise RuntimeError("Analyse introuvable pour cette session.")
                    scan.question_count += 1
                    remaining = max(0, 3 - scan.question_count)
                    result["questions_remaining"] = remaining
                    self._emit(
                        db,
                        sid,
                        "object_chat_question",
                        {
                            "question_type": payload["question_type"],
                            "question_index": scan.question_count,
                            "displayed_price_provided": payload.get("displayed_price_eur") is not None,
                            "cached": False,
                        },
                    )

                elif feature == "fun_wish":
                    scan = db.scalar(
                        select(AssistantScan)
                        .where(AssistantScan.id == payload["scan_id"], AssistantScan.session_id == sid)
                        .with_for_update()
                    )
                    if scan is None:
                        raise RuntimeError("Objet FunLab introuvable pour cette session.")
                    scan.question_count += 1
                    remaining = max(0, 3 - scan.question_count)
                    result["wishes_remaining"] = remaining
                    result["wish_index"] = scan.question_count
                    self._emit(
                        db,
                        sid,
                        "fun_wish_completed",
                        {
                            "wish_type": payload["wish_type"],
                            "quest_type": payload.get("quest_type"),
                            "wish_index": scan.question_count,
                            "wishes_remaining": remaining,
                        },
                    )
                    if remaining == 0:
                        self._emit(db, sid, "fun_session_completed", {"wishes_used": 3})

                job.status = "success"
                job.result = result
                job.completed_at = utcnow()
                job.duration_ms = duration_ms
                queue_wait_ms = None
                if job.started_at is not None:
                    queue_wait_ms = max(0, round((job.started_at - job.created_at).total_seconds() * 1000))
                properties = {
                    "feature": job.feature,
                    "job_id": job.id,
                    "success": True,
                    "latency_ms": duration_ms,
                    "queue_wait_ms": queue_wait_ms,
                }
                if isinstance(result, dict):
                    if result.get("confidence") is not None:
                        properties["confidence"] = result["confidence"]
                    if result.get("analysis_mode") is not None:
                        properties["mode"] = result["analysis_mode"]
                self._emit(db, job.session_id, "ai_analysis_completed", properties)

        except Exception as exc:
            try:
                self._finish_error(job_id, "AI-PERSISTENCE-ERROR", "La réponse n’a pas pu être enregistrée. Réessaie.", started)
                self._cleanup_failed_upload(feature, payload)
            except Exception:
                # If PostgreSQL itself is unavailable, keep the running row and
                # its upload intact so startup recovery can retry it.
                pass
            return

        if feature in {"assistant", "fun_analyze"} and payload.get("image_key"):
            delete_image(payload["image_key"])
        if feature == "fun_wish":
            for image_key in payload.get("image_keys", []):
                delete_image(image_key)

    def _execute_job_sync(self, feature: str, payload: dict[str, Any], sid: str) -> dict[str, Any]:
        if feature == "seller":
            analysis = vision_provider.analyze_for_listing(payload["image_key"], payload.get("filename"))
            return analysis.model_dump(mode="json")

        if feature == "assistant":
            bundle = vision_provider.analyze_assistant_bundle(payload["image_key"])
            return bundle.model_dump(mode="json")

        if feature == "fun_analyze":
            bundle = vision_provider.analyze_fun_bundle(payload["image_key"])
            return bundle.model_dump(mode="json")

        if feature == "assistant_question":
            scan_id = payload["scan_id"]
            with SessionLocal() as db:
                scan = db.scalar(
                    select(AssistantScan)
                    .where(AssistantScan.id == scan_id, AssistantScan.session_id == sid)
                )
                if scan is None:
                    raise RuntimeError("Analyse introuvable pour cette session.")
                analysis = AssistantObjectAnalysis.model_validate(scan.analysis)

            answer = vision_provider.answer_object_question(
                analysis,
                payload["question_type"],
                payload.get("question"),
                payload.get("displayed_price_eur"),
            )
            return {"answer": answer}

        if feature == "fun_wish":
            scan_id = payload["scan_id"]
            with SessionLocal() as db:
                scan = db.scalar(
                    select(AssistantScan).where(AssistantScan.id == scan_id, AssistantScan.session_id == sid)
                )
                if scan is None:
                    raise RuntimeError("Objet FunLab introuvable pour cette session.")
                analysis = AssistantObjectAnalysis.model_validate(scan.analysis)

            creation = vision_provider.create_fun_wish(
                analysis,
                payload["wish_type"],
                payload.get("quest_type"),
                list(payload.get("image_keys", [])),
            )
            return creation.model_dump(mode="json")

        raise RuntimeError(f"Type de tâche IA inconnu : {feature}")

    def _finish_error(
        self,
        job_id: str,
        code: str,
        message: str,
        started: float,
        *,
        exc: Exception | None = None,
    ) -> None:
        duration_ms = round((perf_counter() - started) * 1000)
        with SessionLocal.begin() as db:
            job = db.get(AiJob, job_id)
            if job is None:
                return
            job.status = "timeout" if "TIMEOUT" in code.upper() else "error"
            job.error_code = code
            job.error_message = message
            job.completed_at = utcnow()
            job.duration_ms = duration_ms
            properties: dict[str, Any] = {
                "feature": job.feature,
                "job_id": job.id,
                "code": code,
            }
            primary_code = getattr(exc, "primary_code", None) if exc is not None else None
            if isinstance(primary_code, str) and primary_code:
                properties["primary_code"] = primary_code
            self._emit(db, job.session_id, "error_shown", properties)

    @staticmethod
    def _cleanup_failed_upload(feature: str, payload: dict[str, Any]) -> None:
        image_key = payload.get("image_key")
        if image_key and feature in {"seller", "assistant", "fun_analyze"}:
            delete_image(image_key)
        if feature == "fun_wish":
            for queued_image_key in payload.get("image_keys", []):
                delete_image(queued_image_key)

    @staticmethod
    def _looks_like_timeout(exc: Exception) -> bool:
        status_code = getattr(exc, "status_code", None)
        text = str(exc).lower()
        return status_code in {408, 504} or "timeout" in text or "deadline" in text

    @staticmethod
    def _friendly_error(exc: Exception) -> str:
        status_code = getattr(exc, "status_code", None)
        if status_code == 429:
            return "L’IA reçoit beaucoup de demandes. Réessaie dans un instant."
        if status_code in {500, 502, 503, 504}:
            return "Le service d’analyse est momentanément indisponible. Réessaie dans un instant."
        text = str(exc).lower()
        if "timeout" in text or "deadline" in text:
            return "L’analyse a pris trop de temps. Réessaie dans un instant."
        return "L’analyse n’est pas disponible pour le moment."

    @staticmethod
    def _emit(db: Session, sid: str, name: str, properties: dict[str, Any] | None = None) -> None:
        db.add(Event(session_id=sid, event_name=name, properties=properties or {}))

    def status_snapshot(self, db: Session, job: AiJob) -> dict[str, Any]:
        queue_position: int | None = None
        wait_label: str | None = None

        if job.status == "queued":
            queue_position = int(
                db.scalar(
                    select(func.count(AiJob.id)).where(
                        AiJob.status == "queued",
                        or_(
                            AiJob.created_at < job.created_at,
                            (AiJob.created_at == job.created_at) & (AiJob.id <= job.id),
                        ),
                    )
                )
                or 0
            )
            wait_label = self._estimate_wait_label(db, queue_position)
        elif job.status == "running":
            queue_position = 0
            wait_label = "analyse en cours"

        queue_size = int(db.scalar(select(func.count(AiJob.id)).where(AiJob.status == "queued")) or 0)
        in_flight = int(db.scalar(select(func.count(AiJob.id)).where(AiJob.status == "running")) or 0)
        return {
            "queue_position": queue_position,
            "queue_size": queue_size,
            "in_flight": in_flight,
            "wait_label": wait_label,
        }

    def _estimate_wait_label(self, db: Session, position: int) -> str:
        recent = list(
            db.scalars(
                select(AiJob.duration_ms)
                .where(AiJob.status == "success", AiJob.duration_ms.is_not(None))
                .order_by(AiJob.completed_at.desc())
                .limit(20)
            ).all()
        )
        average_ms = sum(recent) / len(recent) if recent else 12_000
        batches = max(1, (position + MAX_AI_IN_FLIGHT - 1) // MAX_AI_IN_FLIGHT)
        estimate_seconds = batches * average_ms / 1000
        if estimate_seconds < 20:
            return "quelques secondes"
        if estimate_seconds < 60:
            return "moins d’une minute"
        if estimate_seconds < 120:
            return "environ 1–2 min"
        minutes = max(2, round(estimate_seconds / 60))
        return f"environ {minutes} min"

    def cleanup_old_jobs(self) -> None:
        cutoff = utcnow() - timedelta(hours=AI_JOB_RETENTION_HOURS)
        with SessionLocal.begin() as db:
            old_jobs = list(
                db.scalars(
                    select(AiJob).where(AiJob.status.in_(TERMINAL_STATUSES), AiJob.completed_at < cutoff)
                ).all()
            )
            for job in old_jobs:
                db.delete(job)


ai_queue = AiQueueService()

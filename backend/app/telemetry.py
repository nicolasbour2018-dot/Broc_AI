from __future__ import annotations

import asyncio
import csv
import hmac
import io
import json
import logging
import os
import resource
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal, engine, get_db
from .journeys import journey_metrics
from .models import AiJob, AssistantScan, Event, Listing, MetricSnapshot, utcnow

router = APIRouter(prefix="/api", tags=["telemetry"])
health_router = APIRouter(tags=["health"])
TERMINAL_STATUSES = {"success", "error", "timeout"}
FUN_FEATURES = ("fun_analyze", "fun_wish")
AI_ROUTING_MODES = {"auto", "gemini_only", "qwen_only"}
CONFIGURED_AI_ROUTING_MODE = settings.ai_routing_mode.strip().lower()
METRIC_SNAPSHOT_INTERVAL_SECONDS = 20
logger = logging.getLogger(__name__)


def _bounded_env_int(name: str, default: int, maximum: int = 100) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(1, min(maximum, value))


def _max_ai_in_flight() -> int:
    return _bounded_env_int("MAX_AI_IN_FLIGHT", 20)


def _max_fun_in_flight() -> int:
    return min(_max_ai_in_flight(), _bounded_env_int("MAX_FUN_IN_FLIGHT", 4))

ClientEventName = Literal[
    "session_started",
    "onboarding_viewed",
    "onboarding_marketplace_clicked",
    "marketplace_opened",
    "marketplace_category_selected",
    "batch_started",
    "batch_completed",
    "batch_published",
    "nav_opened",
    "catalogue_loaded",
    "error_shown",
    "demo_opened",
    "feature_clicked",
    "chat_started",
    "message_count",
    "demo_duration_s",
    "demo_reset",
]
ClientEventValue = str | int | float | bool | None
ExportDataset = Literal["events", "ai_jobs", "listings"]
ExportFormat = Literal["csv", "json"]


class ClientEventIn(BaseModel):
    event_name: ClientEventName
    properties: dict[str, ClientEventValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def keep_payload_small(self) -> "ClientEventIn":
        if len(self.properties) > 12:
            raise ValueError("Trop de propriétés analytics.")
        serialized = json.dumps(self.properties, ensure_ascii=False, separators=(",", ":"))
        if len(serialized.encode("utf-8")) > 2048:
            raise ValueError("Payload analytics trop volumineux.")
        return self


class AdminRoutingIn(BaseModel):
    mode: Literal["auto", "gemini_only", "qwen_only"]
    reason: str = Field(default="Changement manuel depuis Console Ops", max_length=180)


def _session_id(value: str | None) -> str:
    return (value or "anonymous")[:64]


def _require_admin_token(x_admin_token: str | None = Header(default=None)) -> None:
    expected = (settings.admin_token or "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ADMIN_TOKEN n’est pas configuré sur le serveur.",
        )
    if not x_admin_token or not hmac.compare_digest(x_admin_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token admin invalide.")


def _storage_status() -> str:
    try:
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        return "ok" if os.access(settings.upload_dir, os.W_OK) else "error"
    except OSError:
        return "error"


def _readiness_snapshot() -> dict[str, str]:
    database = "ok"
    try:
        with engine.connect() as connection:
            connection.execute(select(1))
    except Exception:
        database = "error"

    storage = _storage_status()
    ready = "ok" if database == "ok" and storage == "ok" else "degraded"
    return {"status": ready, "database": database, "storage": storage}


def _routing_control() -> dict[str, Any]:
    active_mode = settings.ai_routing_mode.strip().lower()
    return {
        "active_mode": active_mode,
        "configured_mode": CONFIGURED_AI_ROUTING_MODE,
        "override_active": active_mode != CONFIGURED_AI_ROUTING_MODE,
        "fallback_configured": bool((settings.hf_token or "").strip()),
    }


@health_router.get("/health/live")
def health_live() -> dict[str, str]:
    return {"status": "ok"}


@health_router.get("/health/ready")
def health_ready(response: Response) -> dict[str, str]:
    snapshot = _readiness_snapshot()
    if snapshot["status"] != "ok":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return snapshot


def _event_count(db: Session, name: str) -> int:
    return int(db.scalar(select(func.count(Event.id)).where(Event.event_name == name)) or 0)


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 1)


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(ordered) - 1)
    fraction = position - lower_index
    value = ordered[lower_index] + (ordered[upper_index] - ordered[lower_index]) * fraction
    return round(value, 1)


def _read_system_metrics() -> dict[str, int | float | None]:
    cpu_count = os.cpu_count() or 1
    load_1m: float | None = None
    load_percent: float | None = None
    try:
        load_1m = round(os.getloadavg()[0], 2)
        load_percent = round(load_1m / cpu_count * 100, 1)
    except (AttributeError, OSError):
        pass

    total_mb: float | None = None
    used_mb: float | None = None
    usage_percent: float | None = None
    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        values: dict[str, int] = {}
        try:
            for line in meminfo.read_text().splitlines():
                key, raw = line.split(":", 1)
                values[key] = int(raw.strip().split()[0])
            total_kb = values.get("MemTotal")
            available_kb = values.get("MemAvailable")
            if total_kb and available_kb is not None:
                used_kb = max(0, total_kb - available_kb)
                total_mb = round(total_kb / 1024, 1)
                used_mb = round(used_kb / 1024, 1)
                usage_percent = round(used_kb / total_kb * 100, 1)
        except (OSError, ValueError, KeyError):
            pass

    process_rss_mb: float | None = None
    try:
        raw_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        divisor = 1024 * 1024 if sys.platform == "darwin" else 1024
        process_rss_mb = round(raw_rss / divisor, 1)
    except (ValueError, OSError):
        pass

    disk_total_mb: float | None = None
    disk_used_mb: float | None = None
    disk_usage_percent: float | None = None
    try:
        disk = shutil.disk_usage(settings.upload_dir)
        disk_total_mb = round(disk.total / 1024 / 1024, 1)
        disk_used_mb = round(disk.used / 1024 / 1024, 1)
        disk_usage_percent = round(disk.used / disk.total * 100, 1) if disk.total else None
    except OSError:
        pass

    return {
        "cpu_count": cpu_count,
        "load_1m": load_1m,
        "load_percent_of_capacity": load_percent,
        "memory_used_mb": used_mb,
        "memory_total_mb": total_mb,
        "memory_usage_percent": usage_percent,
        "process_rss_mb": process_rss_mb,
        "disk_used_mb": disk_used_mb,
        "disk_total_mb": disk_total_mb,
        "disk_usage_percent": disk_usage_percent,
    }



def _aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)

def _queue_wait_ms(job: AiJob) -> int | None:
    started_at = _aware_utc(job.started_at)
    created_at = _aware_utc(job.created_at)
    if started_at is None or created_at is None:
        return None
    return max(0, round((started_at - created_at).total_seconds() * 1000))


def _lane(feature: str) -> str:
    return "fun" if feature in FUN_FEATURES else "core"


def _analysis_mode(job: AiJob) -> str | None:
    result = job.result
    if not isinstance(result, dict):
        return None
    value = result.get("analysis_mode")
    return value if isinstance(value, str) and value else None


def _provider_and_model(analysis_mode: str | None) -> tuple[str | None, str | None]:
    if not analysis_mode:
        return None, None
    if ":" not in analysis_mode:
        return analysis_mode, None
    provider, model = analysis_mode.split(":", 1)
    return provider, model


def _ops_status(
    *,
    queued: int,
    core_queued: int,
    running: int,
    fun_queued: int,
    fun_running: int,
    recent_terminal: int,
    recent_errors: int,
    last_hour_terminal: int,
    last_hour_error_rate: float,
) -> dict[str, str]:
    max_total = _max_ai_in_flight()
    max_fun = _max_fun_in_flight()
    recent_error_rate = (recent_errors / recent_terminal * 100) if recent_terminal else 0.0

    if recent_terminal >= 3 and recent_errors >= 3 and recent_error_rate >= 50:
        return {
            "level": "critical",
            "label": "Problème IA — erreurs anormales",
            "detail": f"{recent_errors}/{recent_terminal} jobs en erreur sur les 15 dernières minutes.",
        }
    if core_queued > 0 and running >= max_total:
        return {
            "level": "warning",
            "label": "Charge importante — CORE en attente",
            "detail": f"{core_queued} job(s) CORE attendent, {running}/{max_total} slots sont occupés.",
        }
    if fun_queued > 0 and fun_running >= max_fun:
        return {
            "level": "warning",
            "label": "Charge importante — FUN limité",
            "detail": f"FUN utilise {fun_running}/{max_fun} slots et {fun_queued} job(s) attendent. CORE reste prioritaire.",
        }
    if queued >= max_total:
        return {
            "level": "warning",
            "label": "Backlog IA à surveiller",
            "detail": f"{queued} job(s) sont en attente pour {max_total} slots disponibles.",
        }
    if last_hour_terminal >= 5 and last_hour_error_rate >= 20:
        return {
            "level": "warning",
            "label": "Erreurs IA à surveiller",
            "detail": f"Taux d’erreur sur 1 h : {last_hour_error_rate:.1f} %.",
        }
    return {
        "level": "ok",
        "label": "Tout va bien",
        "detail": "CORE est prioritaire, la capacité IA et les erreurs récentes sont dans la zone normale.",
    }


@router.post("/events", status_code=status.HTTP_204_NO_CONTENT)
def record_client_event(
    payload: ClientEventIn,
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Response:
    db.add(
        Event(
            session_id=_session_id(x_session_id),
            event_name=payload.event_name,
            properties=payload.properties,
        )
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/admin/routing", dependencies=[Depends(_require_admin_token)])
def update_admin_routing(payload: AdminRoutingIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    previous_mode = settings.ai_routing_mode.strip().lower()
    next_mode = payload.mode.strip().lower()
    if next_mode not in AI_ROUTING_MODES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Mode de routage IA invalide.")

    settings.ai_routing_mode = next_mode
    changed = previous_mode != next_mode
    if changed:
        db.add(
            Event(
                session_id="ops:nicolas",
                event_name="ops_action",
                properties={
                    "actor": "Nicolas",
                    "action": "routing_override",
                    "target": "ai_router",
                    "reason": payload.reason.strip() or "Changement manuel depuis Console Ops",
                    "result": "success",
                    "from_mode": previous_mode,
                    "to_mode": next_mode,
                },
            )
        )
        db.commit()

    return {"changed": changed, **_routing_control()}


@router.get("/admin/diagnostics", dependencies=[Depends(_require_admin_token)])
def admin_diagnostics(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _collect_admin_metrics(db)


@router.get("/admin/metrics", dependencies=[Depends(_require_admin_token)])
def admin_metrics(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _collect_admin_metrics(db)


@router.get("/admin/journeys", dependencies=[Depends(_require_admin_token)])
def admin_journeys(db: Session = Depends(get_db)) -> dict[str, Any]:
    return journey_metrics(db, utcnow())


def _collect_admin_metrics(db: Session) -> dict[str, Any]:
    now = utcnow()
    readiness = _readiness_snapshot()
    one_minute_ago = now - timedelta(minutes=1)
    one_hour_ago = now - timedelta(hours=1)
    fifteen_minutes_ago = now - timedelta(minutes=15)

    queued = int(db.scalar(select(func.count(AiJob.id)).where(AiJob.status == "queued")) or 0)
    running = int(db.scalar(select(func.count(AiJob.id)).where(AiJob.status == "running")) or 0)
    fun_queued = int(
        db.scalar(
            select(func.count(AiJob.id)).where(AiJob.status == "queued", AiJob.feature.in_(FUN_FEATURES))
        )
        or 0
    )
    fun_running = int(
        db.scalar(
            select(func.count(AiJob.id)).where(AiJob.status == "running", AiJob.feature.in_(FUN_FEATURES))
        )
        or 0
    )
    core_queued = max(0, queued - fun_queued)
    core_running = max(0, running - fun_running)

    total_ai_calls = int(db.scalar(select(func.count(AiJob.id))) or 0)
    last_hour_calls = int(db.scalar(select(func.count(AiJob.id)).where(AiJob.created_at >= one_hour_ago)) or 0)

    recent_terminal_jobs = list(
        db.scalars(
            select(AiJob)
            .where(AiJob.status.in_(TERMINAL_STATUSES), AiJob.completed_at.is_not(None))
            .order_by(AiJob.completed_at.desc())
            .limit(30)
        ).all()
    )
    recent_latencies = [float(job.duration_ms) for job in recent_terminal_jobs if job.duration_ms is not None]
    recent_waits = [float(wait) for job in recent_terminal_jobs if (wait := _queue_wait_ms(job)) is not None]
    recent_core_waits = [
        float(wait)
        for job in recent_terminal_jobs
        if _lane(job.feature) == "core" and (wait := _queue_wait_ms(job)) is not None
    ]
    recent_fun_waits = [
        float(wait)
        for job in recent_terminal_jobs
        if _lane(job.feature) == "fun" and (wait := _queue_wait_ms(job)) is not None
    ]

    status_counts = {
        name: int(db.scalar(select(func.count(AiJob.id)).where(AiJob.status == name)) or 0)
        for name in ("success", "error", "timeout")
    }
    last_hour_status_counts = {
        name: int(
            db.scalar(
                select(func.count(AiJob.id)).where(
                    AiJob.status == name,
                    AiJob.completed_at.is_not(None),
                    AiJob.completed_at >= one_hour_ago,
                )
            )
            or 0
        )
        for name in ("success", "error", "timeout")
    }
    last_hour_terminal = sum(last_hour_status_counts.values())
    last_hour_errors = last_hour_status_counts["error"] + last_hour_status_counts["timeout"]
    error_rate = round(last_hour_errors / last_hour_terminal * 100, 1) if last_hour_terminal else 0.0
    success_rate = round(last_hour_status_counts["success"] / last_hour_terminal * 100, 1) if last_hour_terminal else None

    recent_15_status_counts = {
        name: int(
            db.scalar(
                select(func.count(AiJob.id)).where(
                    AiJob.status == name,
                    AiJob.completed_at.is_not(None),
                    AiJob.completed_at >= fifteen_minutes_ago,
                )
            )
            or 0
        )
        for name in ("success", "error", "timeout")
    }
    recent_15_terminal = sum(recent_15_status_counts.values())
    recent_15_errors = recent_15_status_counts["error"] + recent_15_status_counts["timeout"]

    last_minute_calls = int(
        db.scalar(select(func.count(AiJob.id)).where(AiJob.created_at >= one_minute_ago)) or 0
    )
    last_minute_errors = int(
        db.scalar(
            select(func.count(AiJob.id)).where(
                AiJob.status == "error",
                AiJob.completed_at.is_not(None),
                AiJob.completed_at >= one_minute_ago,
            )
        )
        or 0
    )
    last_minute_timeouts = int(
        db.scalar(
            select(func.count(AiJob.id)).where(
                AiJob.status == "timeout",
                AiJob.completed_at.is_not(None),
                AiJob.completed_at >= one_minute_ago,
            )
        )
        or 0
    )
    last_minute_rate_limits = int(
        db.scalar(
            select(func.count(AiJob.id)).where(
                AiJob.completed_at.is_not(None),
                AiJob.completed_at >= one_minute_ago,
                AiJob.error_code.contains("429"),
            )
        )
        or 0
    )

    provider_jobs = list(
        db.scalars(
            select(AiJob)
            .where(
                AiJob.status == "success",
                AiJob.completed_at.is_not(None),
                AiJob.completed_at >= one_hour_ago,
            )
            .order_by(AiJob.completed_at.desc())
        ).all()
    )
    provider_modes = [mode for job in provider_jobs if (mode := _analysis_mode(job)) is not None]
    primary_mode = f"gemini:{settings.gemini_model}"
    quality_mode = f"gemini:{settings.gemini_quality_model}"
    provider_primary = sum(mode == primary_mode for mode in provider_modes)
    provider_quality = sum(mode == quality_mode for mode in provider_modes)
    provider_qwen = sum(mode.startswith("qwen-hf:") for mode in provider_modes)
    provider_other = max(0, len(provider_modes) - provider_primary - provider_quality - provider_qwen)
    routing_mode = settings.ai_routing_mode.strip().lower()
    active_analysis_mode = provider_modes[0] if provider_modes else None
    active_provider, active_model = _provider_and_model(active_analysis_mode)
    routing_control = _routing_control()
    if routing_mode == "auto" and provider_qwen > 0:
        fallback_state = "used_last_hour"
    elif routing_control["fallback_configured"]:
        fallback_state = "configured"
    else:
        fallback_state = "not_configured"

    activity_jobs = list(
        db.scalars(select(AiJob).order_by(AiJob.created_at.desc()).limit(12)).all()
    )
    recent_rows = [
        {
            "id": job.id,
            "feature": job.feature,
            "lane": _lane(job.feature),
            "status": job.status,
            "analysis_mode": _analysis_mode(job),
            "duration_ms": job.duration_ms,
            "queue_wait_ms": _queue_wait_ms(job),
            "error_code": job.error_code,
            "error_message": job.error_message,
            "created_at": job.created_at.isoformat(),
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        }
        for job in activity_jobs
    ]

    recent_error_jobs = list(
        db.scalars(
            select(AiJob)
            .where(AiJob.status.in_(("error", "timeout")), AiJob.completed_at.is_not(None))
            .order_by(AiJob.completed_at.desc())
            .limit(6)
        ).all()
    )
    recent_errors = [
        {
            "id": job.id,
            "feature": job.feature,
            "lane": _lane(job.feature),
            "status": job.status,
            "error_code": job.error_code,
            "error_message": job.error_message,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        }
        for job in recent_error_jobs
    ]

    catalogue_events = list(
        db.scalars(
            select(Event)
            .where(Event.event_name == "catalogue_loaded")
            .order_by(Event.created_at.desc())
            .limit(30)
        ).all()
    )
    catalogue_latencies: list[float] = []
    for event in catalogue_events:
        value = (event.properties or {}).get("latency_ms")
        if isinstance(value, (int, float)):
            catalogue_latencies.append(float(value))

    total_listings = int(db.scalar(select(func.count(Listing.id))) or 0)
    active_listings = int(db.scalar(select(func.count(Listing.id)).where(Listing.sold_at.is_(None))) or 0)
    assistant_scans = int(db.scalar(select(func.count(AssistantScan.id))) or 0)

    ops = _ops_status(
        queued=queued,
        core_queued=core_queued,
        running=running,
        fun_queued=fun_queued,
        fun_running=fun_running,
        recent_terminal=recent_15_terminal,
        recent_errors=recent_15_errors,
        last_hour_terminal=last_hour_terminal,
        last_hour_error_rate=error_rate,
    )

    ops_events = list(
        db.scalars(
            select(Event)
            .where(Event.event_name == "ops_action")
            .order_by(Event.created_at.desc())
            .limit(8)
        ).all()
    )
    ops_timeline = [
        {
            "id": event.id,
            "created_at": event.created_at.isoformat(),
            **(event.properties or {}),
        }
        for event in ops_events
    ]

    system_metrics = _read_system_metrics()
    metric_snapshot = {
        "timestamp": now.isoformat(),
        "active_sessions": None,
        "queued_core": core_queued,
        "queued_fun": fun_queued,
        "running_core": core_running,
        "running_fun": fun_running,
        "core_wait_p50_ms": _percentile(recent_core_waits, 0.50),
        "core_wait_p95_ms": _percentile(recent_core_waits, 0.95),
        "fun_wait_p50_ms": _percentile(recent_fun_waits, 0.50),
        "fun_wait_p95_ms": _percentile(recent_fun_waits, 0.95),
        "inference_p50_ms": _percentile(recent_latencies, 0.50),
        "inference_p95_ms": _percentile(recent_latencies, 0.95),
        "cpu_load_percent_of_capacity": system_metrics["load_percent_of_capacity"],
        "ram_usage_percent": system_metrics["memory_usage_percent"],
        "disk_usage_percent": system_metrics["disk_usage_percent"],
        "provider": active_provider,
        "model": active_model,
        "routing_mode": routing_mode,
        "rpm": last_minute_calls,
        "errors_last_minute": last_minute_errors,
        "timeouts_last_minute": last_minute_timeouts,
        "rate_limits_429_last_minute": last_minute_rate_limits,
        "tokens": None,
        "estimated_cost_usd": None,
        "load_state": ops["level"],
        "fun_cooldown_seconds": None,
        "fallback_state": fallback_state,
    }

    return {
        "generated_at": now.isoformat(),
        "ops": ops,
        "service": {
            "status": "ok",
            "live": "ok",
            "ready": readiness["status"],
            "database": readiness["database"],
            "storage": readiness["storage"],
            "routing_mode": routing_mode,
        },
        "routing_control": routing_control,
        "ops_timeline": ops_timeline,
        "queue": {
            "queued": queued,
            "running": running,
            "max_in_flight": _max_ai_in_flight(),
            "core": {"queued": core_queued, "running": core_running},
            "fun": {"queued": fun_queued, "running": fun_running, "max_in_flight": _max_fun_in_flight()},
        },
        "ai": {
            "total_calls": total_ai_calls,
            "last_hour_calls": last_hour_calls,
            "success": status_counts["success"],
            "error": status_counts["error"],
            "timeout": status_counts["timeout"],
            "recent_sample_size": len(recent_terminal_jobs),
            "average_latency_ms": _average(recent_latencies),
            "average_queue_wait_ms": _average(recent_waits),
            "inference_p50_ms": metric_snapshot["inference_p50_ms"],
            "inference_p95_ms": metric_snapshot["inference_p95_ms"],
            "core_wait_p50_ms": metric_snapshot["core_wait_p50_ms"],
            "core_wait_p95_ms": metric_snapshot["core_wait_p95_ms"],
            "fun_wait_p50_ms": metric_snapshot["fun_wait_p50_ms"],
            "fun_wait_p95_ms": metric_snapshot["fun_wait_p95_ms"],
            "last_minute_calls": last_minute_calls,
            "last_minute_errors": last_minute_errors,
            "last_minute_timeouts": last_minute_timeouts,
            "last_minute_rate_limits_429": last_minute_rate_limits,
            "last_hour_success_rate_percent": success_rate,
            "last_hour_error_rate_percent": error_rate,
            "last_hour_terminal": last_hour_terminal,
            "providers": {
                "sample_size": len(provider_modes),
                "gemini_primary": provider_primary,
                "gemini_quality": provider_quality,
                "qwen": provider_qwen,
                "fallback_qwen": provider_qwen if routing_mode == "auto" else 0,
                "other": provider_other,
                "primary_mode": primary_mode,
                "quality_mode": quality_mode,
            },
        },
        "product": {
            "sessions": _event_count(db, "session_started"),
            "publications": _event_count(db, "listing_published"),
            "listings_total": total_listings,
            "listings_active": active_listings,
            "searches": _event_count(db, "search_performed"),
            "listing_views": _event_count(db, "listing_viewed"),
            "assistant_scans": assistant_scans,
            "assistant_questions": _event_count(db, "object_chat_question"),
            "errors_shown": _event_count(db, "error_shown"),
        },
        "catalogue": {
            "average_latency_ms": _average(catalogue_latencies),
            "recent_sample_size": len(catalogue_latencies),
        },
        "system": system_metrics,
        "metric_snapshot": metric_snapshot,
        "recent_jobs": recent_rows,
        "recent_errors": recent_errors,
    }


class MetricSnapshotRecorder:
    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="brocai-metric-snapshots")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self._capture)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Periodic metric snapshot persistence failed")
            await asyncio.sleep(METRIC_SNAPSHOT_INTERVAL_SECONDS)

    @staticmethod
    def _capture() -> None:
        with SessionLocal.begin() as db:
            metrics = _collect_admin_metrics(db)
            snapshot = metrics["metric_snapshot"]
            db.add(MetricSnapshot(captured_at=datetime.fromisoformat(snapshot["timestamp"]), snapshot=snapshot))


metric_snapshot_recorder = MetricSnapshotRecorder()


def _events_export(db: Session) -> list[dict[str, Any]]:
    rows = list(db.scalars(select(Event).order_by(Event.created_at.asc())).all())
    return [
        {
            "id": row.id,
            "session_id": row.session_id,
            "event_name": row.event_name,
            "created_at": row.created_at.isoformat(),
            "properties": row.properties or {},
        }
        for row in rows
    ]


def _jobs_export(db: Session) -> list[dict[str, Any]]:
    rows = list(db.scalars(select(AiJob).order_by(AiJob.created_at.asc())).all())
    return [
        {
            "id": row.id,
            "session_id": row.session_id,
            "feature": row.feature,
            "lane": _lane(row.feature),
            "status": row.status,
            "analysis_mode": _analysis_mode(row),
            "attempts": row.attempts,
            "duration_ms": row.duration_ms,
            "queue_wait_ms": _queue_wait_ms(row),
            "error_code": row.error_code,
            "error_message": row.error_message,
            "created_at": row.created_at.isoformat(),
            "started_at": row.started_at.isoformat() if row.started_at else None,
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        }
        for row in rows
    ]


def _listings_export(db: Session) -> list[dict[str, Any]]:
    rows = list(db.scalars(select(Listing).order_by(Listing.created_at.asc())).all())
    return [
        {
            "id": row.id,
            "title": row.title,
            "category": row.category,
            "price_eur": float(row.price_eur),
            "stand_number": row.stand_number,
            "seller_alias": row.seller_alias,
            "created_at": row.created_at.isoformat(),
            "sold_at": row.sold_at.isoformat() if row.sold_at else None,
        }
        for row in rows
    ]


def _csv_response(rows: list[dict[str, Any]], filename: str) -> Response:
    buffer = io.StringIO()
    if rows:
        writer = csv.DictWriter(buffer, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        for row in rows:
            serialized = {
                key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
                for key, value in row.items()
            }
            writer.writerow(serialized)
    return Response(
        content="\ufeff" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _json_response(rows: list[dict[str, Any]], filename: str) -> Response:
    return Response(
        content=json.dumps(rows, ensure_ascii=False, indent=2),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/admin/export", dependencies=[Depends(_require_admin_token)])
def admin_export(
    dataset: ExportDataset,
    format: ExportFormat = "csv",
    db: Session = Depends(get_db),
) -> Response:
    exporters = {
        "events": _events_export,
        "ai_jobs": _jobs_export,
        "listings": _listings_export,
    }
    rows = exporters[dataset](db)
    suffix = "csv" if format == "csv" else "json"
    filename = f"brocai-{dataset}-{utcnow().date().isoformat()}.{suffix}"
    if format == "csv":
        return _csv_response(rows, filename)
    return _json_response(rows, filename)

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .ai_queue import ACTIVE_STATUSES, ai_queue
from .db import get_db
from .models import AiJob, AssistantScan, Event
from .schemas import AiJobOut, FunCreativeBundle, FunQuestType, FunWishOut, FunWishRequest
from .storage import delete_image, save_image

router = APIRouter(prefix="/api/fun", tags=["funlab"])


def _session_id(value: str | None) -> str:
    return (value or "anonymous")[:64]


def _job_out(db: Session, job: AiJob) -> AiJobOut:
    return AiJobOut(
        id=job.id,
        feature=job.feature,
        status=job.status,
        result=job.result,
        error_code=job.error_code,
        error_message=job.error_message,
        **ai_queue.status_snapshot(db, job),
    )


def _enqueue(db: Session, sid: str, feature: str, payload: dict, related_id: str | None = None) -> AiJobOut:
    job = AiJob(session_id=sid, feature=feature, related_id=related_id, status="queued", payload=payload)
    db.add(job)
    db.flush()
    db.add(Event(session_id=sid, event_name="ai_analysis_queued", properties={"feature": feature, "job_id": job.id}))
    db.commit()
    db.refresh(job)
    return _job_out(db, job)


def _scan_with_available_wish(db: Session, sid: str, scan_id: str) -> tuple[AssistantScan, int]:
    scan = db.scalar(
        select(AssistantScan)
        .where(AssistantScan.id == scan_id, AssistantScan.session_id == sid)
        .with_for_update()
    )
    if scan is None:
        raise HTTPException(status_code=404, detail="Objet FunLab introuvable pour cette session.")

    pending = int(
        db.scalar(
            select(func.count(AiJob.id)).where(
                AiJob.feature == "fun_wish",
                AiJob.related_id == scan_id,
                AiJob.status.in_(ACTIVE_STATUSES),
            )
        )
        or 0
    )
    if scan.question_count + pending >= 3:
        raise HTTPException(status_code=409, detail="Les trois vœux de cet objet sont déjà utilisés ou en cours.")
    return scan, scan.question_count + pending + 1


@router.post("/analyze", response_model=AiJobOut, status_code=status.HTTP_202_ACCEPTED)
async def analyze_fun_object(
    photo: UploadFile = File(...),
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AiJobOut:
    sid = _session_id(x_session_id)
    image_key = await save_image(photo)
    db.add(Event(session_id=sid, event_name="fun_photo_submitted", properties={"content_type": photo.content_type}))
    return _enqueue(
        db,
        sid,
        "fun_analyze",
        {"image_key": image_key, "content_type": photo.content_type},
    )


@router.post("/scans/{scan_id}/wishes", response_model=FunWishOut)
def create_fun_wish(
    scan_id: str,
    payload: FunWishRequest,
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> FunWishOut:
    if payload.wish_type == "fairground_quest":
        raise HTTPException(status_code=400, detail="La quête utilise le parcours photo dédié.")

    sid = _session_id(x_session_id)
    scan, wish_index = _scan_with_available_wish(db, sid, scan_id)
    raw_bundle = (scan.analysis or {}).get("_fun_bundle")
    if not isinstance(raw_bundle, dict):
        raise HTTPException(
            status_code=409,
            detail="Les créations pré-calculées ne sont pas disponibles. Reprends une photo de l’objet.",
        )

    try:
        bundle = FunCreativeBundle.model_validate(raw_bundle)
    except Exception as exc:
        raise HTTPException(
            status_code=409,
            detail="Les créations pré-calculées sont invalides. Reprends une photo de l’objet.",
        ) from exc

    draft = getattr(bundle, payload.wish_type)
    db.add(
        Event(
            session_id=sid,
            event_name="fun_wish_selected",
            properties={"wish_type": payload.wish_type, "wish_index": wish_index, "quest": False},
        )
    )
    scan.question_count += 1
    remaining = max(0, 3 - scan.question_count)
    db.add(
        Event(
            session_id=sid,
            event_name="fun_wish_completed",
            properties={
                "wish_type": payload.wish_type,
                "quest_type": None,
                "wish_index": wish_index,
                "wishes_remaining": remaining,
                "cached": True,
            },
        )
    )
    if remaining == 0:
        db.add(Event(session_id=sid, event_name="fun_session_completed", properties={"wishes_used": 3}))
    db.commit()

    return FunWishOut(
        **draft.model_dump(mode="json"),
        wishes_remaining=remaining,
        wish_index=wish_index,
    )


@router.post("/scans/{scan_id}/quest", response_model=AiJobOut, status_code=status.HTTP_202_ACCEPTED)
async def create_fun_quest(
    scan_id: str,
    quest_type: FunQuestType = Form(...),
    selfie: UploadFile = File(...),
    mission_one: UploadFile = File(...),
    mission_two: UploadFile = File(...),
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AiJobOut:
    sid = _session_id(x_session_id)
    existing = db.scalar(select(AssistantScan.id).where(AssistantScan.id == scan_id, AssistantScan.session_id == sid))
    if existing is None:
        raise HTTPException(status_code=404, detail="Objet FunLab introuvable pour cette session.")

    image_keys: list[str] = []
    try:
        for upload in (selfie, mission_one, mission_two):
            image_keys.append(await save_image(upload))

        _, wish_index = _scan_with_available_wish(db, sid, scan_id)
        db.add(
            Event(
                session_id=sid,
                event_name="fun_wish_selected",
                properties={
                    "wish_type": "fairground_quest",
                    "quest_type": quest_type,
                    "wish_index": wish_index,
                    "quest": True,
                },
            )
        )
        return _enqueue(
            db,
            sid,
            "fun_wish",
            {
                "scan_id": scan_id,
                "wish_type": "fairground_quest",
                "quest_type": quest_type,
                "image_keys": image_keys,
            },
            related_id=scan_id,
        )
    except Exception:
        for image_key in image_keys:
            delete_image(image_key)
        raise

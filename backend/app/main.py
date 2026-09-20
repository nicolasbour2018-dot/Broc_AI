from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from .ai_queue import ACTIVE_STATUSES, ai_queue
from .categories import ListingCategory, normalize_category
from .config import settings
from .db import engine, get_db, init_db
from .funlab import router as funlab_router
from .models import AiJob, AssistantScan, Event, Listing, utcnow
from .schemas import (
    AiJobOut,
    AssistantObjectAnalysis,
    AssistantQuestionOut,
    AssistantQuestionRequest,
    AssistantQuickReplies,
    HealthOut,
    ListingCreate,
    ListingOut,
    ListingStatusUpdate,
    ListingUpdate,
)
from .seller_report import router as seller_report_router
from .storage import image_exists, save_image
from .telemetry import health_router, metric_snapshot_recorder, router as telemetry_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    ai_queue.cleanup_old_jobs()
    await ai_queue.start()
    await metric_snapshot_recorder.start()
    try:
        yield
    finally:
        await metric_snapshot_recorder.stop()
        await ai_queue.stop()


app = FastAPI(title=settings.app_name, version="0.5.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)
app.mount("/media", StaticFiles(directory=settings.upload_dir, check_dir=False), name="media")
app.include_router(health_router)
app.include_router(telemetry_router)
app.include_router(funlab_router)
app.include_router(seller_report_router)


def session_id(value: str | None) -> str:
    return (value or "anonymous")[:64]


def emit_event(db: Session, sid: str, name: str, properties: dict | None = None) -> None:
    db.add(Event(session_id=sid, event_name=name, properties=properties or {}))


def _format_euro(value: float) -> str:
    rounded = round(float(value) * 2) / 2
    if rounded.is_integer():
        return f"{int(rounded)} €"
    return f"{rounded:.1f}".replace(".", ",") + " €"


def _cached_assistant_answer(
    analysis: AssistantObjectAnalysis,
    quick_replies: AssistantQuickReplies,
    question_type: str,
    displayed_price_eur: float | None,
) -> str:
    base_answer = getattr(quick_replies, question_type)
    if question_type == "tell_more":
        return base_answer

    if question_type == "negotiate" and displayed_price_eur is None:
        return (
            "« Il me plaît bien ! Vous pourriez me faire un petit prix ? 🙂 »"
            f"\n\n{base_answer}"
        )

    if displayed_price_eur is None:
        return base_answer

    price = max(0.0, float(displayed_price_eur))
    price_range = analysis.price_range_eur

    if question_type == "good_deal":
        if price_range is not None:
            if price < price_range.min:
                context = f"À {_format_euro(price)}, le prix affiché est sous la fourchette indicative de {_format_euro(price_range.min)} à {_format_euro(price_range.max)}."
            elif price <= price_range.max:
                context = f"À {_format_euro(price)}, le prix affiché se situe dans la fourchette indicative de {_format_euro(price_range.min)} à {_format_euro(price_range.max)}."
            else:
                context = f"À {_format_euro(price)}, le prix affiché est au-dessus de la fourchette indicative de {_format_euro(price_range.min)} à {_format_euro(price_range.max)}."
        elif analysis.estimated_price_eur is not None:
            context = f"À {_format_euro(price)}, compare surtout avec le repère visuel d’environ {_format_euro(analysis.estimated_price_eur)}."
        else:
            context = f"À {_format_euro(price)}, la photo seule ne donne pas assez de repères pour classer précisément l’affaire."
        return f"{context} {base_answer}"

    if question_type == "negotiate":
        if price <= 0:
            return (
                "« Il me plaît bien ! Vous pourriez me faire un petit prix ? 🙂 »"
                f"\n\n{base_answer}"
            )
        if price_range is not None and price <= price_range.min:
            phrase = (
                "« Il me plaît bien ! Si je vous le prends maintenant, "
                "vous pourriez me faire un tout petit geste ? 🙂 »"
            )
            context = (
                f"À {_format_euro(price)}, le prix est déjà dans le bas de la fourchette : "
                "mieux vaut demander un petit geste sans insister."
            )
            return f"{phrase}\n\n{context} {base_answer}"

        floor = price_range.min if price_range is not None else 0.0
        target = max(floor, price * 0.9)
        target = round(target * 2) / 2
        if target >= price:
            target = max(0.0, round((price - 0.5) * 2) / 2)
        if 0 < target < price:
            phrase = (
                "« Il me plaît bien, mais mon budget brocante négocie aussi 😄 "
                f"Vous me le laisseriez à {_format_euro(target)} ? »"
            )
            context = (
                f"Tu proposes environ 10 % sous les {_format_euro(price)} affichés : "
                "c’est une ouverture raisonnable et le vendeur reste libre de contre-proposer."
            )
            return f"{phrase}\n\n{context} {base_answer}"

    return base_answer


def ai_job_out(db: Session, job: AiJob) -> AiJobOut:
    snapshot = ai_queue.status_snapshot(db, job)
    return AiJobOut(
        id=job.id,
        feature=job.feature,
        status=job.status,
        result=job.result,
        error_code=job.error_code,
        error_message=job.error_message,
        **snapshot,
    )


def enqueue_ai_job(
    db: Session,
    sid: str,
    feature: str,
    payload: dict,
    *,
    related_id: str | None = None,
) -> AiJobOut:
    job = AiJob(
        session_id=sid,
        feature=feature,
        related_id=related_id,
        status="queued",
        payload=payload,
    )
    db.add(job)
    db.flush()
    emit_event(db, sid, "ai_analysis_queued", {"feature": feature, "job_id": job.id})
    db.commit()
    db.refresh(job)
    return ai_job_out(db, job)


def listing_out(listing: Listing) -> ListingOut:
    return ListingOut(
        id=listing.id,
        image_url=f"/media/{listing.image_key}",
        title=listing.title,
        description=listing.description,
        fun_line=listing.fun_line,
        category=normalize_category(listing.category),
        price_eur=listing.price_eur,
        stand_number=listing.stand_number,
        seller_alias=listing.seller_alias,
        created_at=listing.created_at,
        sold_at=listing.sold_at,
    )


@app.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return HealthOut(status="ok", database="ok")
    except Exception:
        return HealthOut(status="degraded", database="error")


@app.get("/api/ai/jobs/{job_id}", response_model=AiJobOut)
def get_ai_job(
    job_id: str,
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AiJobOut:
    sid = session_id(x_session_id)
    job = db.get(AiJob, job_id)
    if job is None or job.session_id != sid:
        raise HTTPException(status_code=404, detail="Tâche d’analyse introuvable pour cette session.")
    return ai_job_out(db, job)


@app.post("/api/assistant/analyze", response_model=AiJobOut, status_code=status.HTTP_202_ACCEPTED)
async def analyze_object_photo(
    photo: UploadFile = File(...),
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AiJobOut:
    sid = session_id(x_session_id)
    saved = await save_image(photo)
    emit_event(db, sid, "image_optimized", saved.telemetry("assistant"))
    return enqueue_ai_job(
        db,
        sid,
        "assistant",
        {"image_key": saved.image_key, "content_type": saved.sent_content_type},
    )


@app.post(
    "/api/assistant/scans/{scan_id}/questions",
    response_model=AiJobOut | AssistantQuestionOut,
)
def ask_object_question(
    scan_id: str,
    payload: AssistantQuestionRequest,
    response: Response,
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AiJobOut | AssistantQuestionOut:
    sid = session_id(x_session_id)
    scan = db.scalar(
        select(AssistantScan)
        .where(AssistantScan.id == scan_id, AssistantScan.session_id == sid)
        .with_for_update()
    )
    if scan is None:
        raise HTTPException(status_code=404, detail="Analyse introuvable pour cette session.")

    pending = int(
        db.scalar(
            select(func.count(AiJob.id)).where(
                AiJob.feature == "assistant_question",
                AiJob.related_id == scan_id,
                AiJob.status.in_(ACTIVE_STATUSES),
            )
        )
        or 0
    )
    if scan.question_count + pending >= 3:
        raise HTTPException(status_code=409, detail="Les trois questions pour cet objet ont déjà été utilisées ou sont en cours.")

    def enqueue_question() -> AiJobOut:
        response.status_code = status.HTTP_202_ACCEPTED
        return enqueue_ai_job(
            db,
            sid,
            "assistant_question",
            {
                "scan_id": scan_id,
                "question_type": payload.question_type,
                "question": payload.question,
                "displayed_price_eur": payload.displayed_price_eur,
            },
            related_id=scan_id,
        )

    if payload.question_type == "free":
        return enqueue_question()

    raw_quick_replies = (scan.analysis or {}).get("_assistant_quick_replies")
    if not isinstance(raw_quick_replies, dict):
        return enqueue_question()

    try:
        quick_replies = AssistantQuickReplies.model_validate(raw_quick_replies)
        analysis = AssistantObjectAnalysis.model_validate(scan.analysis)
    except Exception:
        return enqueue_question()

    answer = _cached_assistant_answer(
        analysis,
        quick_replies,
        payload.question_type,
        payload.displayed_price_eur,
    )
    scan.question_count += 1
    remaining = max(0, 3 - scan.question_count)
    emit_event(
        db,
        sid,
        "object_chat_question",
        {
            "question_type": payload.question_type,
            "question_index": scan.question_count,
            "displayed_price_provided": payload.displayed_price_eur is not None,
            "cached": True,
        },
    )
    db.commit()
    return AssistantQuestionOut(answer=answer, questions_remaining=remaining)


@app.post("/api/seller/analyze", response_model=AiJobOut, status_code=status.HTTP_202_ACCEPTED)
async def analyze_seller_photo(
    photo: UploadFile = File(...),
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AiJobOut:
    sid = session_id(x_session_id)
    saved = await save_image(photo)
    emit_event(db, sid, "image_optimized", saved.telemetry("seller"))
    emit_event(db, sid, "seller_photo_submitted", {"content_type": photo.content_type})
    return enqueue_ai_job(
        db,
        sid,
        "seller",
        {"image_key": saved.image_key, "filename": photo.filename, "content_type": saved.sent_content_type},
    )


@app.get("/api/seller/listings", response_model=list[ListingOut])
def seller_listings(
    stand_number: str = Query(min_length=1, max_length=40),
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[ListingOut]:
    stand = stand_number.strip()
    statement = (
        select(Listing)
        .where(Listing.stand_number == stand)
        .order_by(Listing.sold_at.is_not(None), Listing.created_at.desc())
    )
    rows = list(db.scalars(statement).all())
    emit_event(db, session_id(x_session_id), "seller_listings_opened", {"stand": stand, "count": len(rows)})
    db.commit()
    return [listing_out(item) for item in rows]


@app.patch("/api/seller/listings/{listing_id}", response_model=ListingOut)
def update_listing(
    listing_id: str,
    payload: ListingUpdate,
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ListingOut:
    listing = db.get(Listing, listing_id)
    if listing is None or listing.stand_number != payload.stand_number:
        raise HTTPException(status_code=404, detail="Annonce introuvable pour ce stand.")

    listing.title = payload.title.strip()
    listing.description = payload.description.strip()
    listing.fun_line = payload.fun_line.strip() if payload.fun_line else None
    listing.category = payload.category.value
    listing.price_eur = payload.price_eur
    listing.seller_alias = payload.seller_alias.strip() if payload.seller_alias else None
    emit_event(
        db,
        session_id(x_session_id),
        "listing_updated",
        {"listing_id": listing.id, "stand": listing.stand_number},
    )
    db.commit()
    db.refresh(listing)
    return listing_out(listing)


@app.patch("/api/seller/listings/{listing_id}/status", response_model=ListingOut)
def update_listing_status(
    listing_id: str,
    payload: ListingStatusUpdate,
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ListingOut:
    listing = db.get(Listing, listing_id)
    if listing is None or listing.stand_number != payload.stand_number:
        raise HTTPException(status_code=404, detail="Annonce introuvable pour ce stand.")

    listing.sold_at = utcnow() if payload.sold else None
    emit_event(
        db,
        session_id(x_session_id),
        "listing_marked_sold" if payload.sold else "listing_relisted",
        {"listing_id": listing.id, "stand": listing.stand_number},
    )
    db.commit()
    db.refresh(listing)
    return listing_out(listing)


@app.post("/api/listings", response_model=ListingOut, status_code=status.HTTP_201_CREATED)
def create_listing(
    payload: ListingCreate,
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ListingOut:
    if not image_exists(payload.image_key):
        raise HTTPException(status_code=400, detail="La photo associée à l'annonce est introuvable.")

    listing = Listing(
        **payload.model_dump(exclude={"category"}),
        category=payload.category.value,
    )
    db.add(listing)
    emit_event(
        db,
        session_id(x_session_id),
        "listing_published",
        {"category": payload.category, "stand": payload.stand_number, "price_eur": float(payload.price_eur)},
    )
    db.commit()
    db.refresh(listing)
    return listing_out(listing)


@app.get("/api/listings", response_model=list[ListingOut])
def list_listings(
    q: str | None = Query(default=None, max_length=100),
    category: ListingCategory | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[ListingOut]:
    statement = select(Listing).where(Listing.sold_at.is_(None))
    cleaned = (q or "").strip()
    if category is not None:
        statement = statement.where(Listing.category == category.value)
    if cleaned:
        pattern = f"%{cleaned}%"
        statement = statement.where(
            or_(
                Listing.title.ilike(pattern),
                Listing.description.ilike(pattern),
                Listing.category.ilike(pattern),
            )
        )
    statement = statement.order_by(Listing.created_at.desc()).limit(limit)
    rows = list(db.scalars(statement).all())
    if cleaned or category is not None:
        emit_event(db, session_id(x_session_id), "search_performed", {"query_length": len(cleaned), "category": category.value if category else None, "results": len(rows)})
        db.commit()
    return [listing_out(item) for item in rows]


@app.get("/api/listings/{listing_id}", response_model=ListingOut)
def get_listing(
    listing_id: str,
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ListingOut:
    listing = db.get(Listing, listing_id)
    if listing is None or listing.sold_at is not None:
        raise HTTPException(status_code=404, detail="Annonce introuvable.")
    emit_event(db, session_id(x_session_id), "listing_viewed", {"listing_id": listing.id})
    db.commit()
    return listing_out(listing)

from contextlib import asynccontextmanager
from time import perf_counter

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from .ai import vision_provider
from .categories import ListingCategory, normalize_category
from .config import settings
from .db import engine, get_db, init_db
from .models import AssistantScan, Event, Listing, utcnow
from .schemas import (
    AssistantObjectAnalysis,
    AssistantQuestionOut,
    AssistantQuestionRequest,
    AssistantScanOut,
    HealthOut,
    ListingCreate,
    ListingOut,
    ListingStatusUpdate,
    ListingUpdate,
    SellerAnalysis,
)
from .storage import delete_image, image_exists, save_image


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    yield


app = FastAPI(title=settings.app_name, version="0.4.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)
app.mount("/media", StaticFiles(directory=settings.upload_dir, check_dir=False), name="media")


def session_id(value: str | None) -> str:
    return (value or "anonymous")[:64]


def emit_event(db: Session, sid: str, name: str, properties: dict | None = None) -> None:
    db.add(Event(session_id=sid, event_name=name, properties=properties or {}))


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


@app.post("/api/assistant/analyze", response_model=AssistantScanOut)
async def analyze_object_photo(
    photo: UploadFile = File(...),
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AssistantScanOut:
    sid = session_id(x_session_id)
    started = perf_counter()
    image_key = await save_image(photo)
    emit_event(db, sid, "ai_analysis_started", {"feature": "assistant", "queue_position": 0})
    try:
        analysis = await run_in_threadpool(vision_provider.analyze_object, image_key)
    except Exception as exc:
        emit_event(db, sid, "error_shown", {"feature": "assistant_analysis", "code": "analysis_failed"})
        db.commit()
        raise HTTPException(status_code=502, detail="L'analyse de cet objet n'est pas disponible pour le moment.") from exc
    finally:
        delete_image(image_key)

    scan = AssistantScan(
        session_id=sid,
        analysis=analysis.model_dump(mode="json"),
        question_count=0,
    )
    db.add(scan)
    emit_event(
        db,
        sid,
        "object_scan_completed",
        {
            "category": analysis.category.value,
            "confidence": analysis.confidence,
            "latency_ms": round((perf_counter() - started) * 1000),
            "mode": analysis.analysis_mode,
        },
    )
    db.commit()
    db.refresh(scan)
    return AssistantScanOut(
        **analysis.model_dump(),
        scan_id=scan.id,
        questions_remaining=3,
    )


@app.post("/api/assistant/scans/{scan_id}/questions", response_model=AssistantQuestionOut)
async def ask_object_question(
    scan_id: str,
    payload: AssistantQuestionRequest,
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AssistantQuestionOut:
    sid = session_id(x_session_id)
    scan = db.scalar(
        select(AssistantScan)
        .where(AssistantScan.id == scan_id, AssistantScan.session_id == sid)
        .with_for_update()
    )
    if scan is None:
        raise HTTPException(status_code=404, detail="Analyse introuvable pour cette session.")
    if scan.question_count >= 3:
        raise HTTPException(status_code=409, detail="Les trois questions pour cet objet ont déjà été utilisées.")

    analysis = AssistantObjectAnalysis.model_validate(scan.analysis)
    try:
        answer = await run_in_threadpool(
            vision_provider.answer_object_question,
            analysis,
            payload.question_type,
            payload.question,
            payload.displayed_price_eur,
        )
    except Exception as exc:
        emit_event(db, sid, "error_shown", {"feature": "assistant_question", "code": "question_failed"})
        db.commit()
        raise HTTPException(status_code=502, detail="La réponse n'est pas disponible pour le moment.") from exc

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
        },
    )
    db.commit()
    return AssistantQuestionOut(answer=answer, questions_remaining=remaining)


@app.post("/api/seller/analyze", response_model=SellerAnalysis)
async def analyze_seller_photo(
    photo: UploadFile = File(...),
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SellerAnalysis:
    sid = session_id(x_session_id)
    started = perf_counter()
    image_key = await save_image(photo)
    emit_event(db, sid, "seller_photo_submitted", {"content_type": photo.content_type})
    emit_event(db, sid, "ai_analysis_started", {"feature": "seller", "queue_position": 0})
    try:
        analysis = await run_in_threadpool(vision_provider.analyze_for_listing, image_key, photo.filename)
    except Exception as exc:
        emit_event(db, sid, "error_shown", {"feature": "seller_analysis", "code": "analysis_failed"})
        db.commit()
        raise HTTPException(status_code=502, detail="L'analyse n'est pas disponible pour le moment.") from exc

    emit_event(
        db,
        sid,
        "ai_analysis_completed",
        {
            "feature": "seller",
            "success": True,
            "latency_ms": round((perf_counter() - started) * 1000),
            "confidence": analysis.confidence,
            "mode": analysis.analysis_mode,
        },
    )
    db.commit()
    return analysis


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

from __future__ import annotations

import csv
import hmac
import io
import json
import os
import resource
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import AiJob, AssistantScan, Event, Listing, utcnow

router = APIRouter(prefix="/api", tags=["telemetry"])
TERMINAL_STATUSES = {"success", "error", "timeout"}


def _max_ai_in_flight() -> int:
    try:
        value = int(os.getenv("MAX_AI_IN_FLIGHT", "20"))
    except ValueError:
        value = 20
    return max(1, min(100, value))

ClientEventName = Literal["session_started", "nav_opened", "catalogue_loaded", "error_shown"]
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


def _event_count(db: Session, name: str) -> int:
    return int(db.scalar(select(func.count(Event.id)).where(Event.event_name == name)) or 0)


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 1)


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

    return {
        "cpu_count": cpu_count,
        "load_1m": load_1m,
        "load_percent_of_capacity": load_percent,
        "memory_used_mb": used_mb,
        "memory_total_mb": total_mb,
        "memory_usage_percent": usage_percent,
        "process_rss_mb": process_rss_mb,
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


@router.get("/admin/metrics", dependencies=[Depends(_require_admin_token)])
def admin_metrics(db: Session = Depends(get_db)) -> dict[str, Any]:
    now = utcnow()
    one_hour_ago = now - timedelta(hours=1)

    queue_counts = {
        status_name: int(db.scalar(select(func.count(AiJob.id)).where(AiJob.status == status_name)) or 0)
        for status_name in ("queued", "running")
    }

    total_ai_calls = int(db.scalar(select(func.count(AiJob.id))) or 0)
    last_hour_calls = int(db.scalar(select(func.count(AiJob.id)).where(AiJob.created_at >= one_hour_ago)) or 0)

    recent_jobs = list(
        db.scalars(
            select(AiJob)
            .where(AiJob.status.in_(TERMINAL_STATUSES), AiJob.completed_at.is_not(None))
            .order_by(AiJob.completed_at.desc())
            .limit(30)
        ).all()
    )
    last_hour_terminal = [
        job for job in recent_jobs
        if (completed_at := _aware_utc(job.completed_at)) is not None and completed_at >= one_hour_ago
    ]
    recent_latencies = [float(job.duration_ms) for job in recent_jobs if job.duration_ms is not None]
    recent_waits = [float(wait) for job in recent_jobs if (wait := _queue_wait_ms(job)) is not None]
    error_jobs = [job for job in last_hour_terminal if job.status in {"error", "timeout"}]
    error_rate = round(len(error_jobs) / len(last_hour_terminal) * 100, 1) if last_hour_terminal else 0.0

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

    status_counts = {
        name: int(db.scalar(select(func.count(AiJob.id)).where(AiJob.status == name)) or 0)
        for name in ("success", "error", "timeout")
    }

    recent_rows = []
    for job in recent_jobs[:8]:
        recent_rows.append(
            {
                "id": job.id,
                "feature": job.feature,
                "status": job.status,
                "duration_ms": job.duration_ms,
                "queue_wait_ms": _queue_wait_ms(job),
                "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            }
        )

    return {
        "generated_at": now.isoformat(),
        "service": {"status": "ok", "database": "ok"},
        "queue": {
            "queued": queue_counts["queued"],
            "running": queue_counts["running"],
            "max_in_flight": _max_ai_in_flight(),
        },
        "ai": {
            "total_calls": total_ai_calls,
            "last_hour_calls": last_hour_calls,
            "success": status_counts["success"],
            "error": status_counts["error"],
            "timeout": status_counts["timeout"],
            "recent_sample_size": len(recent_jobs),
            "average_latency_ms": _average(recent_latencies),
            "average_queue_wait_ms": _average(recent_waits),
            "last_hour_error_rate_percent": error_rate,
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
        "system": _read_system_metrics(),
        "recent_jobs": recent_rows,
    }


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
            "status": row.status,
            "attempts": row.attempts,
            "duration_ms": row.duration_ms,
            "queue_wait_ms": _queue_wait_ms(row),
            "error_code": row.error_code,
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

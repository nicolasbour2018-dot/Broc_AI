from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Event

PARIS = ZoneInfo("Europe/Paris")
JOURNEY_EVENTS = {
    "session_started",
    "onboarding_viewed",
    "onboarding_marketplace_clicked",
    "marketplace_opened",
    "marketplace_category_selected",
    "search_performed",
    "listing_viewed",
    "batch_started",
    "batch_completed",
    "batch_published",
}
ENTRY_SOURCES = {
    "welcome", "home", "home_listing", "marketplace", "seller_dashboard", "seller_create", "direct",
}
SESSION_STAGES = (
    "session_started",
    "onboarding_viewed",
    "onboarding_marketplace_clicked",
    "marketplace_opened",
    "marketplace_category_selected",
    "search_performed",
    "listing_viewed",
)


def device_properties(device_context: str | None, seller_stand: str | None, entry_source: str | None = None) -> dict[str, Any]:
    stand = (seller_stand or "").strip()
    if device_context == "seller" and stand:
        properties: dict[str, Any] = {"device_context": "seller", "seller_stand": stand[:40]}
    elif device_context == "visitor" and not stand:
        properties = {"device_context": "visitor", "seller_stand": None}
    else:
        properties = {"device_context": "unknown", "seller_stand": None}
    if entry_source in ENTRY_SOURCES:
        properties["entry_source"] = entry_source
    return properties


def qualified_view(properties: dict[str, Any]) -> bool:
    return properties.get("is_own_listing") is False and properties.get("device_context") in {"visitor", "seller"}


def qualified_listing_view_counts(db: Session, listing_ids: list[str]) -> dict[str, int]:
    if not listing_ids:
        return {}
    listing_id = Event.properties["listing_id"].as_string()
    rows = db.execute(
        select(Event.properties).where(Event.event_name == "listing_viewed", listing_id.in_(listing_ids))
    ).all()
    counts = {item_id: 0 for item_id in listing_ids}
    for (properties,) in rows:
        if qualified_view(properties):
            counts[properties["listing_id"]] += 1
    return counts


def _count(value: Any) -> int:
    return value if type(value) is int and value >= 0 else 0


def _window(rows: list[Event], start: datetime, end: datetime) -> dict[str, Any]:
    segments: dict[str, dict[str, set[str]]] = {
        context: {stage: set() for stage in SESSION_STAGES}
        for context in ("visitor", "seller", "unknown")
    }
    views = {context: {"own": 0, "other": 0, "unknown": 0} for context in segments}
    batches: dict[str, dict[str, dict[str, int]]] = {}
    for event in rows:
        timestamp = (
            event.created_at.replace(tzinfo=timezone.utc)
            if event.created_at.tzinfo is None else event.created_at
        )
        if not start <= timestamp < end:
            continue
        properties = event.properties or {}
        context = properties.get("device_context")
        if context not in segments:
            context = "unknown"
        if event.event_name in SESSION_STAGES and (
            event.event_name != "search_performed" or _count(properties.get("query_length")) > 0
        ):
            segments[context][event.event_name].add(event.session_id)
        if event.event_name == "listing_viewed":
            kind = "own" if properties.get("is_own_listing") is True else "other" if qualified_view(properties) else "unknown"
            views[context][kind] += 1
        if event.event_name in {"batch_started", "batch_completed", "batch_published"}:
            batch_id = properties.get("batch_id")
            if not isinstance(batch_id, str) or not batch_id:
                continue
            batch = batches.setdefault(batch_id, {})
            batch[event.event_name] = {
                "size": _count(properties.get("batch_size")),
                "published": _count(properties.get("published_count")),
                "failed": _count(properties.get("failed_count")),
            }
    return {
        "since": start.isoformat(),
        "until": end.isoformat(),
        "segments": {
            context: {
                "sessions": {stage: len(ids) for stage, ids in stages.items()},
                "views": views[context],
            }
            for context, stages in segments.items()
        },
        "batches": {
            "started": sum("batch_started" in batch for batch in batches.values()),
            "completed": sum("batch_completed" in batch for batch in batches.values()),
            "published": sum(batch.get("batch_published", {}).get("published", 0) > 0 for batch in batches.values()),
            "published_items": sum(batch.get("batch_published", {}).get("published", 0) for batch in batches.values()),
            "failed_items": sum(batch.get("batch_published", {}).get("failed", 0) for batch in batches.values()),
        },
    }


def journey_metrics(db: Session, now: datetime) -> dict[str, Any]:
    current = now.astimezone(timezone.utc)
    day_start = (
        current.astimezone(PARIS)
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .astimezone(timezone.utc)
    )
    recent_start = current - timedelta(minutes=15)
    statement = (
        select(Event)
        .where(Event.created_at >= min(day_start, recent_start), Event.event_name.in_(JOURNEY_EVENTS))
        .order_by(Event.created_at, Event.id)
    )
    rows = list(db.scalars(statement).all())
    return {
        "generated_at": current.isoformat(),
        "timezone": "Europe/Paris",
        "recent": _window(rows, recent_start, current),
        "today": _window(rows, day_start, current),
    }

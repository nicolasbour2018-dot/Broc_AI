"""Stand codes: a 4-digit code chosen by the first device protects a stand's listings from other sellers.

The first device to open a stand chooses its code. Any other device joins with the same code and gets its own
token, sent as `X-Stand-Token` on every write. Guesses are rate-limited per stand; an admin reset frees the stand.
This is deliberately light security for a one-day brocante, not an account system.
"""

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Event, Stand, StandDevice, utcnow
from .telemetry import _require_admin_token

router = APIRouter(prefix="/api", tags=["stands"])

PIN_PATTERN = re.compile(r"^\d{4}$")
MAX_FAILED_ATTEMPTS = 5
LOCK_DURATION = timedelta(minutes=15)
PBKDF2_ITERATIONS = 100_000


class StandSessionIn(BaseModel):
    stand_number: str = Field(min_length=1, max_length=40)
    pin: str

    @field_validator("stand_number")
    @classmethod
    def normalize_stand_number(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Le numéro de stand est obligatoire.")
        return cleaned

    @field_validator("pin")
    @classmethod
    def check_pin(cls, value: str) -> str:
        if not PIN_PATTERN.fullmatch(value):
            raise ValueError("Le code doit contenir exactement 4 chiffres.")
        return value


class StandSessionOut(BaseModel):
    stand_number: str
    token: str
    created: bool


def hash_pin(pin: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS).hex()
    return f"{salt}${digest}"


def pin_matches(pin: str, stored: str) -> bool:
    salt, _, expected = stored.partition("$")
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS).hex()
    return hmac.compare_digest(digest, expected)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _aware(value: datetime) -> datetime:
    # SQLite returns naive datetimes even for timezone-aware columns.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _issue_device(db: Session, stand_number: str) -> str:
    token = secrets.token_urlsafe(32)
    db.add(StandDevice(token_hash=hash_token(token), stand_number=stand_number))
    return token


def _event(db: Session, sid: str | None, name: str, stand: str) -> None:
    db.add(Event(session_id=(sid or "anonymous")[:64], event_name=name, properties={"stand": stand}))


def require_stand_owner(db: Session, stand_number: str, token: str | None) -> None:
    """Rejects a write on `stand_number` unless the request carries a token issued for this stand."""
    if not settings.stand_pin_required:
        return
    device = db.get(StandDevice, hash_token(token)) if token else None
    if device is None or device.stand_number != stand_number:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ce téléphone n’est pas autorisé sur ce stand. Touchez « Changer de stand » et saisissez le code du stand.",
        )


@router.post("/seller/stands/session", response_model=StandSessionOut)
def open_stand_session(
    payload: StandSessionIn,
    x_session_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> StandSessionOut:
    """Opens a new stand with the given code, or joins an existing one when the code matches."""
    stand = db.get(Stand, payload.stand_number)
    if stand is None:
        db.add(Stand(stand_number=payload.stand_number, pin_hash=hash_pin(payload.pin)))
        token = _issue_device(db, payload.stand_number)
        _event(db, x_session_id, "stand_opened", payload.stand_number)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ce stand vient d’être ouvert sur un autre téléphone. Réessayez avec son code.")
        return StandSessionOut(stand_number=payload.stand_number, token=token, created=True)

    now = utcnow()
    if stand.locked_until is not None and _aware(stand.locked_until) > now:
        minutes = max(1, round((_aware(stand.locked_until) - now).total_seconds() / 60))
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=f"Trop d’essais pour ce stand. Réessayez dans {minutes} min.")

    if not pin_matches(payload.pin, stand.pin_hash):
        stand.failed_attempts += 1
        if stand.failed_attempts >= MAX_FAILED_ATTEMPTS:
            stand.failed_attempts = 0
            stand.locked_until = now + LOCK_DURATION
        _event(db, x_session_id, "stand_pin_failed", payload.stand_number)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ce stand est déjà ouvert avec un autre code. Saisissez son code, ou demandez à l’organisateur de le réinitialiser.",
        )

    stand.failed_attempts = 0
    stand.locked_until = None
    token = _issue_device(db, payload.stand_number)
    _event(db, x_session_id, "stand_joined", payload.stand_number)
    db.commit()
    return StandSessionOut(stand_number=payload.stand_number, token=token, created=False)


@router.delete(
    "/admin/stands/{stand_number}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_require_admin_token)],
)
def reset_stand(stand_number: str, db: Session = Depends(get_db)) -> Response:
    """Frees a stand: its code and every device token are forgotten. Its listings stay online."""
    stand = stand_number.strip()
    db.execute(delete(StandDevice).where(StandDevice.stand_number == stand))
    db.execute(delete(Stand).where(Stand.stand_number == stand))
    _event(db, "admin", "stand_reset", stand)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

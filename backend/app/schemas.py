from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator


Confidence = Literal["low", "medium", "high"]


class PriceRange(BaseModel):
    min: float = Field(ge=0)
    max: float = Field(ge=0)


class SellerAnalysis(BaseModel):
    image_key: str
    title: str
    description: str
    category: str | None = None
    suggested_price_eur: float = Field(ge=0)
    price_range_eur: PriceRange
    confidence: Confidence
    fun_line: str | None = None
    analysis_mode: str


class ListingCreate(BaseModel):
    image_key: str
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=1200)
    category: str | None = Field(default=None, max_length=80)
    price_eur: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    stand_number: str = Field(min_length=1, max_length=40)
    seller_alias: str | None = Field(default=None, max_length=80)

    @field_validator("stand_number")
    @classmethod
    def normalize_stand_number(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Le numéro de stand est obligatoire.")
        return cleaned


class ListingUpdate(BaseModel):
    stand_number: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=1200)
    category: str | None = Field(default=None, max_length=80)
    price_eur: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    seller_alias: str | None = Field(default=None, max_length=80)

    @field_validator("stand_number")
    @classmethod
    def normalize_update_stand_number(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Le numéro de stand est obligatoire.")
        return cleaned


class ListingStatusUpdate(BaseModel):
    stand_number: str = Field(min_length=1, max_length=40)
    sold: bool

    @field_validator("stand_number")
    @classmethod
    def normalize_stand_number(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Le numéro de stand est obligatoire.")
        return cleaned


class ListingOut(BaseModel):
    id: str
    image_url: str
    title: str
    description: str
    category: str | None
    price_eur: Decimal
    stand_number: str
    seller_alias: str | None
    created_at: datetime
    sold_at: datetime | None


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "error"]

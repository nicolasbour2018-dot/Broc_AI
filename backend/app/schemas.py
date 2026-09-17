from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .categories import ListingCategory


Confidence = Literal["low", "medium", "high"]


class PriceRange(BaseModel):
    min: float = Field(ge=0)
    max: float = Field(ge=0)


class SellerAnalysis(BaseModel):
    image_key: str
    title: str
    description: str
    category: ListingCategory
    suggested_price_eur: float = Field(ge=0)
    price_range_eur: PriceRange
    confidence: Confidence
    fun_line: str | None = Field(default=None, max_length=180)
    analysis_mode: str


AssistantQuestionType = Literal["good_deal", "tell_more", "negotiate", "free"]


class AssistantObjectAnalysis(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    category: ListingCategory
    description: str = Field(min_length=1, max_length=500)
    context_note: str = Field(min_length=1, max_length=600)
    estimated_price_eur: float | None = Field(default=None, ge=0)
    price_range_eur: PriceRange | None = None
    confidence: Confidence
    caution: str = Field(min_length=1, max_length=320)
    analysis_mode: str


class AssistantScanOut(AssistantObjectAnalysis):
    scan_id: str
    questions_remaining: int = Field(ge=0, le=3)


class AssistantQuestionRequest(BaseModel):
    question_type: AssistantQuestionType
    question: str | None = Field(default=None, max_length=240)
    displayed_price_eur: float | None = Field(default=None, ge=0)

    @field_validator("question")
    @classmethod
    def validate_free_question(cls, value: str | None, info):
        cleaned = value.strip() if value else None
        if info.data.get("question_type") == "free" and not cleaned:
            raise ValueError("Écris une question avant de l'envoyer.")
        return cleaned


class AssistantQuestionOut(BaseModel):
    answer: str = Field(min_length=1, max_length=1200)
    questions_remaining: int = Field(ge=0, le=3)


class ListingCreate(BaseModel):
    image_key: str
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=1200)
    fun_line: str | None = Field(default=None, max_length=180)
    category: ListingCategory = ListingCategory.OTHER
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
    fun_line: str | None = Field(default=None, max_length=180)
    category: ListingCategory = ListingCategory.OTHER
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
    fun_line: str | None
    category: ListingCategory
    price_eur: Decimal
    stand_number: str
    seller_alias: str | None
    created_at: datetime
    sold_at: datetime | None


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "error"]

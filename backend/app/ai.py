import base64
from pathlib import Path
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from .config import settings
from .schemas import PriceRange, SellerAnalysis


class VisionProvider(Protocol):
    def analyze_for_listing(self, image_key: str, original_filename: str | None) -> SellerAnalysis: ...


class GeminiListingDraft(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=500)
    category: str | None = Field(default=None, max_length=80)
    suggested_price_eur: float = Field(ge=0)
    price_min_eur: float = Field(ge=0)
    price_max_eur: float = Field(ge=0)
    confidence: Literal["low", "medium", "high"]
    fun_line: str | None = Field(default=None, max_length=180)


MIME_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
}


class MockVisionProvider:
    """Local development provider. Its output is always labelled as a mock."""

    def analyze_for_listing(self, image_key: str, original_filename: str | None) -> SellerAnalysis:
        stem = Path(original_filename or "objet").stem.replace("_", " ").replace("-", " ").strip()
        title = stem.capitalize() if stem and stem.lower() not in {"image", "img", "photo"} else "Objet de brocante"
        return SellerAnalysis(
            image_key=image_key,
            title=title[:160],
            description="Décrivez brièvement l’objet, son état et ce qui le rend intéressant.",
            category="À identifier",
            suggested_price_eur=10.0,
            price_range_eur=PriceRange(min=5.0, max=20.0),
            confidence="low",
            fun_line="Brouillon local : tout reste modifiable avant publication.",
            analysis_mode="mock-fallback",
        )


class GeminiVisionProvider:
    def __init__(self) -> None:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY est obligatoire quand AI_PROVIDER=gemini.")

        from google import genai

        self.client = genai.Client(api_key=settings.gemini_api_key)

    def analyze_for_listing(self, image_key: str, original_filename: str | None) -> SellerAnalysis:
        from google.genai import types

        image_path = settings.upload_dir / image_key
        suffix = image_path.suffix.lower()
        mime_type = MIME_BY_SUFFIX.get(suffix)
        if mime_type is None:
            raise ValueError(f"Format d'image non pris en charge par Gemini : {suffix}")

        prompt = """
Tu aides un vendeur lors d'une brocante française à préparer une annonce courte à partir d'une photo.
Analyse uniquement ce qui est raisonnablement visible. N'invente pas de marque, d'authenticité, de matériau,
d'époque ou d'état précis si la photo ne permet pas de l'établir. Le prix est seulement indicatif.

Retourne :
- un titre concret et court ;
- une description de 1 à 3 phrases, directement réutilisable ;
- une catégorie simple ;
- un prix conseillé en euros et une fourchette prudente ;
- un niveau de confiance low/medium/high ;
- éventuellement une très courte touche fun, sans sur-promesse.

Le vendeur modifiera librement toutes les propositions avant publication.
""".strip()

        response = self.client.models.generate_content(
            model=settings.gemini_model,
            contents=[
                prompt,
                types.Part.from_bytes(data=image_path.read_bytes(), mime_type=mime_type),
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiListingDraft,
                temperature=0.2,
            ),
        )
        if not response.text:
            raise RuntimeError("Gemini n'a renvoyé aucune analyse exploitable.")

        result = GeminiListingDraft.model_validate_json(response.text)
        price_min, price_max = sorted((result.price_min_eur, result.price_max_eur))
        return SellerAnalysis(
            image_key=image_key,
            title=result.title.strip(),
            description=result.description.strip(),
            category=result.category.strip() if result.category else None,
            suggested_price_eur=result.suggested_price_eur,
            price_range_eur=PriceRange(min=price_min, max=price_max),
            confidence=result.confidence,
            fun_line=result.fun_line.strip() if result.fun_line else None,
            analysis_mode=f"gemini:{settings.gemini_model}",
        )


def get_vision_provider() -> VisionProvider:
    provider = settings.ai_provider.strip().lower()
    if provider == "mock":
        return MockVisionProvider()
    if provider == "gemini":
        return GeminiVisionProvider()
    raise RuntimeError(f"AI_PROVIDER inconnu : {settings.ai_provider!r}. Utilisez 'mock' ou 'gemini'.")


vision_provider = get_vision_provider()

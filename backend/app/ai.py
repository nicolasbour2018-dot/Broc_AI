import os
import json
from pathlib import Path
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from .categories import LISTING_CATEGORIES, ListingCategory
from .config import settings
from .schemas import AssistantObjectAnalysis, AssistantQuestionType, PriceRange, SellerAnalysis


class VisionProvider(Protocol):
    def analyze_for_listing(self, image_key: str, original_filename: str | None) -> SellerAnalysis: ...

    def analyze_object(self, image_key: str) -> AssistantObjectAnalysis: ...

    def answer_object_question(
        self,
        analysis: AssistantObjectAnalysis,
        question_type: AssistantQuestionType,
        question: str | None,
        displayed_price_eur: float | None,
    ) -> str: ...


class GeminiListingDraft(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=500)
    category: ListingCategory
    suggested_price_eur: float = Field(ge=0)
    price_min_eur: float = Field(ge=0)
    price_max_eur: float = Field(ge=0)
    confidence: Literal["low", "medium", "high"]
    fun_line: str | None = Field(default=None, max_length=180)


class GeminiObjectAnalysis(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    category: ListingCategory
    description: str = Field(min_length=1, max_length=500)
    context_note: str = Field(min_length=1, max_length=600)
    estimated_price_eur: float | None = Field(default=None, ge=0)
    price_min_eur: float | None = Field(default=None, ge=0)
    price_max_eur: float | None = Field(default=None, ge=0)
    confidence: Literal["low", "medium", "high"]
    caution: str = Field(min_length=1, max_length=320)


class GeminiQuestionAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=900)


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
            category=ListingCategory.OTHER,
            suggested_price_eur=10.0,
            price_range_eur=PriceRange(min=5.0, max=20.0),
            confidence="low",
            fun_line="Brouillon local : tout reste modifiable avant publication.",
            analysis_mode="mock-fallback",
        )

    def analyze_object(self, image_key: str) -> AssistantObjectAnalysis:
        return AssistantObjectAnalysis(
            name="Objet de brocante",
            category=ListingCategory.OTHER,
            description="Analyse simulée en mode développement.",
            context_note="Active Gemini pour obtenir une identification et un contexte visuel réels.",
            estimated_price_eur=10.0,
            price_range_eur=PriceRange(min=5.0, max=20.0),
            confidence="low",
            caution="Cette analyse est un exemple local, pas une expertise de l’objet.",
            analysis_mode="mock-fallback",
        )

    def answer_object_question(
        self,
        analysis: AssistantObjectAnalysis,
        question_type: AssistantQuestionType,
        question: str | None,
        displayed_price_eur: float | None,
    ) -> str:
        if question_type == "good_deal":
            return "Mode développement : compare le prix affiché à la fourchette indicative, puis vérifie surtout l’état réel de l’objet."
        if question_type == "tell_more":
            return "Mode développement : l’analyse détaillée sera générée par Gemini lorsque le fournisseur réel est activé."
        if question_type == "negotiate":
            return "Mode développement : propose poliment un prix un peu inférieur et garde le sourire — la brocante reste un échange entre personnes."
        return f"Mode développement : question reçue — {question or 'aucune question'}"


class GeminiVisionProvider:
    def __init__(self) -> None:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY est obligatoire quand AI_PROVIDER=gemini.")

        from google import genai

        self.client = genai.Client(api_key=settings.gemini_api_key, http_options={"timeout": max(10, min(300, int(os.getenv("AI_JOB_TIMEOUT_SECONDS", "60")))) * 1000})

    @staticmethod
    def _image_part(image_key: str):
        from google.genai import types

        image_path = settings.upload_dir / image_key
        suffix = image_path.suffix.lower()
        mime_type = MIME_BY_SUFFIX.get(suffix)
        if mime_type is None:
            raise ValueError(f"Format d'image non pris en charge par Gemini : {suffix}")
        return types.Part.from_bytes(data=image_path.read_bytes(), mime_type=mime_type)

    def analyze_for_listing(self, image_key: str, original_filename: str | None) -> SellerAnalysis:
        from google.genai import types

        prompt = """
Tu aides un vendeur lors d'une brocante française à préparer une annonce courte à partir d'une photo.
Analyse uniquement ce qui est raisonnablement visible. N'invente pas de marque, d'authenticité, de matériau,
d'époque ou d'état précis si la photo ne permet pas de l'établir. Le prix est seulement indicatif.

Retourne :
- un titre concret et court ;
- une description de 1 à 3 phrases, directement réutilisable ;
- UNE catégorie choisie strictement dans cette liste :
  {categories}
  Si aucune catégorie ne convient clairement, choisis "Autre" ;
- un prix conseillé en euros et une fourchette prudente, pensés spécifiquement pour une BROCANTE / VIDE-GRENIER en France ;
  estime un prix de transaction réaliste sur place, pas un prix d'annonce en ligne ni un prix neuf. Pour un objet courant, privilégie un prix attractif qui a de bonnes chances de déclencher une vente dans la journée : remise en main propre, objet vendu en l'état, sans garantie et avec provenance souvent inconnue.
  La borne basse correspond à une vente rapide, le prix conseillé à un compromis réaliste, la borne haute à un prix encore plausible en brocante. Utilise de préférence des montants simples à payer (0,50 €, 1 €, 2 €, 5 € ou multiples raisonnables).
  Ne sous-évalue pas mécaniquement un objet qui semble réellement rare ou de collection : si la valeur est très incertaine, élargis plutôt la fourchette et baisse le niveau de confiance ;
- un niveau de confiance low/medium/high ;
- éventuellement une très courte touche fun, sans sur-promesse.

Le vendeur modifiera librement toutes les propositions avant publication.
""".format(categories=" | ".join(LISTING_CATEGORIES)).strip()

        response = self.client.models.generate_content(
            model=settings.gemini_model,
            contents=[prompt, self._image_part(image_key)],
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
            category=result.category,
            suggested_price_eur=result.suggested_price_eur,
            price_range_eur=PriceRange(min=price_min, max=price_max),
            confidence=result.confidence,
            fun_line=result.fun_line.strip() if result.fun_line else None,
            analysis_mode=f"gemini:{settings.gemini_model}",
        )

    def analyze_object(self, image_key: str) -> AssistantObjectAnalysis:
        from google.genai import types

        prompt = """
Tu aides un visiteur d'une brocante française à comprendre un objet photographié.
Reste prudent : une photo ne permet pas de certifier une marque, une authenticité, une matière, une date ou une valeur.
Ne présente jamais une hypothèse comme certaine.

Retourne une fiche courte avec :
- le nom probable de l'objet ;
- UNE catégorie choisie strictement dans cette liste : {categories} ;
- une description factuelle très courte ;
- un peu de contexte sur l'usage, le style ou l'époque seulement si c'est raisonnablement inférable ;
- une estimation de prix indicative et une fourchette prudente si cela a du sens, sinon null. Cette estimation doit correspondre à un prix réaliste de brocante / vide-grenier en France, généralement plus orienté vente sur place que prix d'annonce en ligne ;
- un niveau de confiance low/medium/high ;
- un avertissement court expliquant l'incertitude principale.

Si aucune catégorie ne convient clairement, choisis "Autre".
""".format(categories=" | ".join(LISTING_CATEGORIES)).strip()

        response = self.client.models.generate_content(
            model=settings.gemini_model,
            contents=[prompt, self._image_part(image_key)],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiObjectAnalysis,
                temperature=0.2,
            ),
        )
        if not response.text:
            raise RuntimeError("Gemini n'a renvoyé aucune analyse exploitable.")

        result = GeminiObjectAnalysis.model_validate_json(response.text)
        price_range = None
        if result.price_min_eur is not None and result.price_max_eur is not None:
            low, high = sorted((result.price_min_eur, result.price_max_eur))
            price_range = PriceRange(min=low, max=high)

        return AssistantObjectAnalysis(
            name=result.name.strip(),
            category=result.category,
            description=result.description.strip(),
            context_note=result.context_note.strip(),
            estimated_price_eur=result.estimated_price_eur,
            price_range_eur=price_range,
            confidence=result.confidence,
            caution=result.caution.strip(),
            analysis_mode=f"gemini:{settings.gemini_model}",
        )

    def answer_object_question(
        self,
        analysis: AssistantObjectAnalysis,
        question_type: AssistantQuestionType,
        question: str | None,
        displayed_price_eur: float | None,
    ) -> str:
        from google.genai import types

        intent = {
            "good_deal": "Évalue si cela semble être une bonne affaire, en comparant le prix affiché s'il est fourni à l'estimation, et rappelle brièvement l'incertitude.",
            "tell_more": "Donne un peu plus de contexte utile sur l'usage, le style, les éléments distinctifs et une époque possible sans inventer de certitude.",
            "negotiate": "Aide à négocier avec tact : propose éventuellement une cible de prix, une phrase courte à dire et une petite touche d'humour. Réponse de 2 à 3 phrases maximum.",
            "free": "Réponds directement à la question libre à partir de la fiche de l'objet, sans inventer ce qui n'est pas établi.",
        }[question_type]

        prompt = f"""
Tu réponds à une question sur un objet de brocante déjà analysé. Tu n'as plus accès à la photo : base-toi uniquement sur la fiche ci-dessous.
Sois bref, utile, chaleureux et prudent. Une estimation visuelle n'est pas une expertise ni une authentification.

Fiche objet :
{json.dumps(analysis.model_dump(mode='json'), ensure_ascii=False)}

Prix affiché par le visiteur : {displayed_price_eur if displayed_price_eur is not None else 'non renseigné'} €
Type de demande : {question_type}
Consigne : {intent}
Question libre : {question or 'aucune'}
""".strip()

        response = self.client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiQuestionAnswer,
                temperature=0.35,
            ),
        )
        if not response.text:
            raise RuntimeError("Gemini n'a renvoyé aucune réponse exploitable.")
        return GeminiQuestionAnswer.model_validate_json(response.text).answer.strip()


def get_vision_provider() -> VisionProvider:
    provider = settings.ai_provider.strip().lower()
    if provider == "mock":
        return MockVisionProvider()
    if provider == "gemini":
        return GeminiVisionProvider()
    raise RuntimeError(f"AI_PROVIDER inconnu : {settings.ai_provider!r}. Utilisez 'mock' ou 'gemini'.")


vision_provider = get_vision_provider()

from __future__ import annotations

import base64
import copy
import json
import mimetypes
import time
from pathlib import Path
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel, Field

from .categories import LISTING_CATEGORIES, ListingCategory
from .config import settings
from .schemas import (
    AssistantAnalysisBundle,
    AssistantObjectAnalysis,
    AssistantQuestionType,
    AssistantQuickReplies,
    FunAnalysisBundle,
    FunCreativeBundle,
    FunCreativeDraft,
    FunQuestType,
    FunWishType,
    PriceRange,
    SellerAnalysis,
)


class QwenFallbackError(RuntimeError):
    pass


class QwenListingDraft(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=500)
    category: ListingCategory
    suggested_price_eur: float = Field(ge=0)
    price_min_eur: float = Field(ge=0)
    price_max_eur: float = Field(ge=0)
    confidence: Literal["low", "medium", "high"]
    fun_line: str | None = Field(default=None, max_length=180)


class QwenObjectAnalysis(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    category: ListingCategory
    description: str = Field(min_length=1, max_length=500)
    context_note: str = Field(min_length=1, max_length=600)
    estimated_price_eur: float | None = Field(default=None, ge=0)
    price_min_eur: float | None = Field(default=None, ge=0)
    price_max_eur: float | None = Field(default=None, ge=0)
    confidence: Literal["low", "medium", "high"]
    caution: str = Field(min_length=1, max_length=320)


class QwenQuestionAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=900)


class QwenAssistantBundleDraft(BaseModel):
    analysis: QwenObjectAnalysis
    quick_replies: AssistantQuickReplies


class QwenFunBundleDraft(BaseModel):
    analysis: QwenObjectAnalysis
    fun: FunCreativeBundle


def _strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    schema = copy.deepcopy(model.model_json_schema())

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object":
                node["additionalProperties"] = False
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(schema)
    return schema


def _analysis_from_draft(result: QwenObjectAnalysis) -> AssistantObjectAnalysis:
    price_range = None
    if result.price_min_eur is not None and result.price_max_eur is not None:
        low, high = sorted((result.price_min_eur, result.price_max_eur))
        price_range = PriceRange(min=low, max=high)

    confidence = result.confidence.strip().lower()
    if confidence not in {"low", "medium", "high"}:
        confidence = "low"

    return AssistantObjectAnalysis(
        name=result.name.strip(),
        category=result.category,
        description=result.description.strip(),
        context_note=result.context_note.strip(),
        estimated_price_eur=result.estimated_price_eur,
        price_range_eur=price_range,
        confidence=confidence,
        caution=result.caution.strip(),
        analysis_mode=f"qwen-hf:{settings.hf_qwen_model}",
    )


class QwenVisionProvider:
    def _image_data_url(self, image_key: str) -> str:
        path = settings.upload_dir / image_key
        mime_type, _ = mimetypes.guess_type(path.name)
        if mime_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise QwenFallbackError(f"Format image Qwen non pris en charge : {path.suffix}")
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"

    def _call(
        self,
        *,
        operation: str,
        prompt: str,
        schema_model: type[BaseModel],
        image_keys: list[str] | None = None,
    ) -> BaseModel:
        token = (settings.hf_token or "").strip()
        if not token:
            raise QwenFallbackError("HF_TOKEN absent : fallback Qwen indisponible.")

        content: str | list[dict[str, Any]]
        if image_keys:
            parts: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
            parts.extend(
                {
                    "type": "image_url",
                    "image_url": {"url": self._image_data_url(image_key)},
                }
                for image_key in image_keys
            )
            content = parts
        else:
            content = prompt

        payload = {
            "model": settings.hf_qwen_model,
            "messages": [{"role": "user", "content": content}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": f"brocai_{operation}",
                    "schema": _strict_schema(schema_model),
                    "strict": True,
                },
            },
            "stream": False,
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        attempts = max(1, min(3, settings.hf_fallback_max_attempts))

        for attempt in range(1, attempts + 1):
            request = Request(
                settings.hf_router_url,
                data=body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            try:
                with urlopen(request, timeout=max(5, min(60, settings.hf_timeout_seconds))) as response:
                    data = json.loads(response.read().decode("utf-8"))
                choices = data.get("choices") or []
                if not choices:
                    raise QwenFallbackError("Réponse Qwen sans choices.")
                raw_text = choices[0].get("message", {}).get("content")
                if not isinstance(raw_text, str) or not raw_text.strip():
                    raise QwenFallbackError("Réponse Qwen vide.")
                return schema_model.model_validate_json(raw_text)
            except HTTPError as exc:
                body_text = exc.read().decode("utf-8", errors="replace")
                if exc.code in {502, 503, 504} and attempt < attempts:
                    time.sleep(2 ** (attempt - 1))
                    continue
                raise QwenFallbackError(
                    f"Fallback Qwen HTTP {exc.code}: {body_text[:600]}"
                ) from exc
            except (URLError, TimeoutError, OSError) as exc:
                if attempt < attempts:
                    time.sleep(2 ** (attempt - 1))
                    continue
                raise QwenFallbackError(
                    f"Fallback Qwen réseau/timeout : {type(exc).__name__}: {exc}"
                ) from exc
            except (json.JSONDecodeError, ValueError) as exc:
                raise QwenFallbackError(
                    f"Fallback Qwen réponse inutilisable : {type(exc).__name__}: {exc}"
                ) from exc

        raise QwenFallbackError("Fallback Qwen épuisé sans réponse.")

    def analyze_for_listing(self, image_key: str, original_filename: str | None) -> SellerAnalysis:
        prompt = """
Tu aides un vendeur lors d'une brocante française à préparer une annonce courte à partir d'une photo.
Analyse uniquement ce qui est raisonnablement visible. N'invente pas de marque, d'authenticité, de matériau,
d'époque ou d'état précis si la photo ne permet pas de l'établir. Le prix est seulement indicatif.

Retourne :
- un titre concret et court ;
- une description de 1 à 3 phrases, directement réutilisable ;
- UNE catégorie choisie strictement dans cette liste : {categories}. Si aucune ne convient, choisis "Autre" ;
- un prix conseillé et une fourchette prudente pour une vente en brocante / vide-grenier en France ;
- un niveau de confiance low/medium/high ;
- éventuellement une très courte touche fun.

Privilégie des prix réalistes de transaction sur place. Pour un objet courant, favorise un prix attractif.
Ne sous-évalue pas mécaniquement un objet potentiellement rare : élargis plutôt la fourchette et baisse la confiance.
""".format(categories=" | ".join(LISTING_CATEGORIES)).strip()
        result = self._call(
            operation="seller",
            prompt=prompt,
            schema_model=QwenListingDraft,
            image_keys=[image_key],
        )
        assert isinstance(result, QwenListingDraft)
        low, high = sorted((result.price_min_eur, result.price_max_eur))
        confidence = result.confidence.strip().lower()
        if confidence not in {"low", "medium", "high"}:
            confidence = "low"
        return SellerAnalysis(
            image_key=image_key,
            title=result.title.strip(),
            description=result.description.strip(),
            category=result.category,
            suggested_price_eur=result.suggested_price_eur,
            price_range_eur=PriceRange(min=low, max=high),
            confidence=confidence,
            fun_line=result.fun_line.strip() if result.fun_line else None,
            analysis_mode=f"qwen-hf:{settings.hf_qwen_model}",
        )

    def analyze_object(self, image_key: str) -> AssistantObjectAnalysis:
        prompt = """
Tu aides un visiteur d'une brocante française à comprendre un objet photographié.
Reste prudent : une photo ne permet pas de certifier une marque, une authenticité, une matière, une date ou une valeur.

Retourne une fiche courte avec le nom probable, UNE catégorie parmi {categories}, une description factuelle,
un contexte prudent, une estimation et une fourchette de brocante si cela a du sens sinon null,
une confiance low/medium/high et un avertissement court. Si aucune catégorie ne convient, choisis "Autre".
""".format(categories=" | ".join(LISTING_CATEGORIES)).strip()
        result = self._call(
            operation="assistant_object",
            prompt=prompt,
            schema_model=QwenObjectAnalysis,
            image_keys=[image_key],
        )
        assert isinstance(result, QwenObjectAnalysis)
        return _analysis_from_draft(result)

    def analyze_assistant_bundle(self, image_key: str) -> AssistantAnalysisBundle:
        prompt = """
Tu prépares en UNE seule analyse l’expérience Assistant photo de BrocAI à partir d’une photo d’objet prise dans une brocante française.

Commence par identifier prudemment l’objet :
- nom probable ;
- UNE catégorie choisie strictement dans cette liste : {categories} ;
- description factuelle très courte ;
- contexte utile sur l’usage, le style ou l’époque seulement si c’est raisonnablement inférable ;
- estimation de prix indicative et fourchette prudente si cela a du sens, sinon null ;
- confiance low/medium/high ;
- avertissement court sur l’incertitude principale.

Prépare ensuite trois réponses rapides cohérentes :
- good_deal : aide à juger une bonne affaire sans supposer connaître le prix affiché exact ;
- tell_more : 2 à 3 phrases de contexte supplémentaire utile ;
- negotiate : tactique courte, polie et naturelle, sans inventer de prix affiché exact.

Une photo ne permet pas de certifier marque, authenticité, matière, date, provenance ou valeur.
Les prix sont des repères de brocante en France, pas une expertise.
Retourne exactement "analysis" et "quick_replies".
""".format(categories=" | ".join(LISTING_CATEGORIES)).strip()
        result = self._call(
            operation="assistant_bundle",
            prompt=prompt,
            schema_model=QwenAssistantBundleDraft,
            image_keys=[image_key],
        )
        assert isinstance(result, QwenAssistantBundleDraft)
        return AssistantAnalysisBundle(
            analysis=_analysis_from_draft(result.analysis),
            quick_replies=result.quick_replies,
        )

    def analyze_fun_bundle(self, image_key: str) -> FunAnalysisBundle:
        prompt = """
Tu prépares en UNE seule analyse l’expérience FunLab de BrocAI à partir d’une photo d’objet prise dans une brocante française.

Identifie prudemment l’objet : nom, UNE catégorie parmi {categories}, description courte, contexte prudent,
estimation/fourchette de brocante si pertinente, confiance low/medium/high et avertissement.

Prépare ensuite quatre créations courtes :
- bring_to_life : personnage, tempérament, mini-réplique et micro-histoire ;
- movie_star : affiche de film imaginaire, slogan et mini-pitch ;
- imaginary_past : biographie très courte et explicitement inventée ;
- secret_power : super-pouvoir absurde, faiblesse ridicule et punchline.

N’invente jamais marque, authenticité, origine, matière, époque ou valeur comme un fait certain.
Chaque création contient title, subtitle, story, badge et son wish_type exact.
Retourne exactement "analysis" et "fun".
""".format(categories=" | ".join(LISTING_CATEGORIES)).strip()
        result = self._call(
            operation="fun_bundle",
            prompt=prompt,
            schema_model=QwenFunBundleDraft,
            image_keys=[image_key],
        )
        assert isinstance(result, QwenFunBundleDraft)
        result.fun.bring_to_life.wish_type = "bring_to_life"
        result.fun.movie_star.wish_type = "movie_star"
        result.fun.imaginary_past.wish_type = "imaginary_past"
        result.fun.secret_power.wish_type = "secret_power"
        return FunAnalysisBundle(
            analysis=_analysis_from_draft(result.analysis),
            fun=result.fun,
        )

    def answer_object_question(
        self,
        analysis: AssistantObjectAnalysis,
        question_type: AssistantQuestionType,
        question: str | None,
        displayed_price_eur: float | None,
    ) -> str:
        intent = {
            "good_deal": "Évalue si cela semble être une bonne affaire et rappelle l'incertitude.",
            "tell_more": "Donne un peu plus de contexte utile sans inventer de certitude.",
            "negotiate": "Aide à négocier avec tact en 2 à 3 phrases maximum.",
            "free": "Réponds directement à la question libre sans inventer ce qui n'est pas établi.",
        }[question_type]
        prompt = f"""
Tu réponds à une question sur un objet de brocante déjà analysé.
Sois bref, utile, chaleureux et prudent.

Fiche objet :
{json.dumps(analysis.model_dump(mode='json'), ensure_ascii=False)}

Prix affiché : {displayed_price_eur if displayed_price_eur is not None else 'non renseigné'} €
Type : {question_type}
Consigne : {intent}
Question libre : {question or 'aucune'}
""".strip()
        result = self._call(
            operation="assistant_question",
            prompt=prompt,
            schema_model=QwenQuestionAnswer,
        )
        assert isinstance(result, QwenQuestionAnswer)
        return result.answer.strip()

    def create_fun_wish(
        self,
        analysis: AssistantObjectAnalysis,
        wish_type: FunWishType,
        quest_type: FunQuestType | None,
        image_keys: list[str],
    ) -> FunCreativeDraft:
        intents = {
            "bring_to_life": "Transforme l'objet en personnage avec tempérament, mini-réplique et micro-histoire.",
            "movie_star": "Imagine une affiche de film fictive avec titre, slogan et mini-pitch.",
            "imaginary_past": "Écris une biographie très courte et explicitement imaginaire.",
            "secret_power": "Invente un super-pouvoir absurde, une faiblesse ridicule et une punchline.",
            "fairground_quest": "Raconte une mini-aventure à la fête foraine à partir des trois photos.",
        }
        prompt = f"""
Tu écris pour le FunLab de BrocAI. Le sujet principal reste l'objet.
Tout élément historique, biographique, héroïque ou cinématographique est imaginaire.
N'affirme jamais marque, authenticité, origine ou valeur comme certaine.

Objet :
{json.dumps(analysis.model_dump(mode='json'), ensure_ascii=False)}

Vœu : {wish_type}
Consigne : {intents[wish_type]}
Quête : {quest_type or 'aucune'}

Retourne title, subtitle, story en 2 à 4 phrases, badge et wish_type exactement "{wish_type}".
""".strip()
        if wish_type == "fairground_quest" and len(image_keys) != 3:
            raise ValueError("La quête FunLab attend exactement trois photos.")
        result = self._call(
            operation="fun_wish",
            prompt=prompt,
            schema_model=FunCreativeDraft,
            image_keys=image_keys or None,
        )
        assert isinstance(result, FunCreativeDraft)
        result.wish_type = wish_type
        return result

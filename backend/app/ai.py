import os
import json
import logging
import time
from pathlib import Path
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field, ValidationError

from .categories import LISTING_CATEGORIES, ListingCategory
from .config import settings
from .qwen import QwenVisionProvider
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


class VisionProvider(Protocol):
    def analyze_for_listing(self, image_key: str, original_filename: str | None) -> SellerAnalysis: ...

    def analyze_object(self, image_key: str) -> AssistantObjectAnalysis: ...

    def analyze_assistant_bundle(self, image_key: str) -> AssistantAnalysisBundle: ...

    def analyze_fun_bundle(self, image_key: str) -> FunAnalysisBundle: ...

    def answer_object_question(
        self,
        analysis: AssistantObjectAnalysis,
        question_type: AssistantQuestionType,
        question: str | None,
        displayed_price_eur: float | None,
    ) -> str: ...

    def create_fun_wish(
        self,
        analysis: AssistantObjectAnalysis,
        wish_type: FunWishType,
        quest_type: FunQuestType | None,
        image_keys: list[str],
    ) -> FunCreativeDraft: ...


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


class GeminiAssistantBundleDraft(BaseModel):
    analysis: GeminiObjectAnalysis
    quick_replies: AssistantQuickReplies


class GeminiFunBundleDraft(BaseModel):
    analysis: GeminiObjectAnalysis
    fun: FunCreativeBundle


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

    @staticmethod
    def _simulate_test_conditions() -> None:
        """Optional load-test controls; inert unless explicitly enabled."""
        try:
            delay_ms = int(os.getenv("AI_MOCK_DELAY_MS", "0"))
        except ValueError:
            delay_ms = 0
        delay_ms = max(0, min(30_000, delay_ms))
        if delay_ms:
            time.sleep(delay_ms / 1000)

        if os.getenv("AI_MOCK_FORCE_ERROR", "").strip().lower() in {"1", "true", "yes", "on"}:
            raise RuntimeError("Erreur mock forcée pour test de résilience.")

    def analyze_for_listing(self, image_key: str, original_filename: str | None) -> SellerAnalysis:
        self._simulate_test_conditions()
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
        self._simulate_test_conditions()
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

    def analyze_assistant_bundle(self, image_key: str) -> AssistantAnalysisBundle:
        analysis = self.analyze_object(image_key)
        return AssistantAnalysisBundle(
            analysis=analysis,
            quick_replies=AssistantQuickReplies(
                good_deal="Compare le prix affiché à la fourchette indicative et vérifie surtout l’état réel de l’objet avant de décider.",
                tell_more="Cet objet est présenté en mode développement : avec Gemini actif, BrocAI ajoute du contexte prudent sur son usage, son style et son époque possible.",
                negotiate="Reste simple et souriant : demande si le vendeur peut faire un petit geste, sans présenter l’estimation visuelle comme une expertise.",
            ),
        )

    def analyze_fun_bundle(self, image_key: str) -> FunAnalysisBundle:
        self._simulate_test_conditions()
        analysis = AssistantObjectAnalysis(
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
        name = analysis.name

        def draft(
            wish_type: FunWishType,
            title: str,
            subtitle: str,
            story: str,
            badge: str,
        ) -> FunCreativeDraft:
            return FunCreativeDraft(
                wish_type=wish_type,
                title=title,
                subtitle=subtitle,
                story=story,
                badge=badge,
            )

        return FunAnalysisBundle(
            analysis=analysis,
            fun=FunCreativeBundle(
                bring_to_life=draft(
                    "bring_to_life",
                    f"{name} prend vie",
                    "Caractère : curieux, légèrement dramatique.",
                    f"{name} s’est réveillé avec une seule idée : découvrir ce qui se passe de l’autre côté du stand. Sa réplique préférée : « On ne me range pas, on m’expose ! »",
                    "Objet vivant",
                ),
                movie_star=draft(
                    "movie_star",
                    f"{name} — Le grand rôle",
                    "Cette saison, la brocante a trouvé sa star.",
                    f"Dans ce film totalement imaginaire, {name} vole la vedette à tout le monde et refuse catégoriquement les doublures. Sortie mondiale : juste après la fermeture de la brocante.",
                    "Affiche fictive",
                ),
                imaginary_past=draft(
                    "imaginary_past",
                    f"Les vies secrètes de {name}",
                    "Biographie 100 % inventée.",
                    f"La légende raconte que {name} a traversé trois déménagements, un dimanche pluvieux et une négociation historique à 2 €. Rien de tout cela n’est vrai — mais il mérite clairement son autobiographie.",
                    "Passé imaginaire",
                ),
                secret_power=draft(
                    "secret_power",
                    f"Le pouvoir de {name}",
                    "Pouvoir : attirer les bonnes affaires à dix mètres.",
                    "Son seul point faible ? Les étiquettes de prix de travers. Face à elles, même ses pouvoirs deviennent incontrôlables.",
                    "Pouvoir débloqué",
                ),
            ),
        )

    def answer_object_question(
        self,
        analysis: AssistantObjectAnalysis,
        question_type: AssistantQuestionType,
        question: str | None,
        displayed_price_eur: float | None,
    ) -> str:
        self._simulate_test_conditions()
        if question_type == "good_deal":
            return "Mode développement : compare le prix affiché à la fourchette indicative, puis vérifie surtout l’état réel de l’objet."
        if question_type == "tell_more":
            return "Mode développement : l’analyse détaillée sera générée par Gemini lorsque le fournisseur réel est activé."
        if question_type == "negotiate":
            return "Mode développement : propose poliment un prix un peu inférieur et garde le sourire — la brocante reste un échange entre personnes."
        return f"Mode développement : question reçue — {question or 'aucune question'}"

    def create_fun_wish(
        self,
        analysis: AssistantObjectAnalysis,
        wish_type: FunWishType,
        quest_type: FunQuestType | None,
        image_keys: list[str],
    ) -> FunCreativeDraft:
        self._simulate_test_conditions()
        name = analysis.name or "Objet de brocante"
        examples = {
            "bring_to_life": (
                f"{name} prend vie",
                "Caractère : curieux, légèrement dramatique.",
                f"{name} s’est réveillé avec une seule idée : découvrir ce qui se passe de l’autre côté du stand. Sa réplique préférée : « On ne me range pas, on m’expose ! »",
                "Objet vivant",
            ),
            "movie_star": (
                f"{name} — Le grand rôle",
                "Cette saison, la brocante a trouvé sa star.",
                f"Dans ce film totalement imaginaire, {name} vole la vedette à tout le monde et refuse catégoriquement les doublures. Sortie mondiale : juste après la fermeture de la brocante.",
                "Affiche fictive",
            ),
            "imaginary_past": (
                f"Les vies secrètes de {name}",
                "Biographie 100 % inventée.",
                f"La légende raconte que {name} a traversé trois déménagements, un dimanche pluvieux et une négociation historique à 2 €. Rien de tout cela n’est vrai — mais il mérite clairement son autobiographie.",
                "Passé imaginaire",
            ),
            "secret_power": (
                f"Le pouvoir de {name}",
                "Pouvoir : attirer les bonnes affaires à dix mètres.",
                "Son seul point faible ? Les étiquettes de prix de travers. Face à elles, même ses pouvoirs deviennent incontrôlables.",
                "Pouvoir débloqué",
            ),
            "fairground_quest": (
                f"{name} à la fête",
                "Trois photos, une épopée complètement inventée.",
                f"Après un selfie officiel, {name} a inspecté la fête comme une célébrité en tournée. Entre les deux indices photographiés, il a trouvé son décor préféré et décidé que cette sortie méritait déjà une suite.",
                "Quête accomplie",
            ),
        }
        title, subtitle, story, badge = examples[wish_type]
        return FunCreativeDraft(wish_type=wish_type, title=title, subtitle=subtitle, story=story, badge=badge)


class GeminiVisionProvider:
    def __init__(self, model_id: str | None = None) -> None:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY est obligatoire quand AI_PROVIDER=gemini.")

        self.model_id = model_id or settings.gemini_model
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
  raisonne comme un vendeur qui veut réellement vendre l'objet aujourd'hui, pas comme une annonce Leboncoin/eBay, un antiquaire ou un prix neuf. La remise en main propre, l'absence de garantie et la provenance souvent inconnue tirent le prix vers le bas.
  Pour un objet courant, non signé et sans caractère collector visible, pars franchement dans le bas des prix de brocante : beaucoup de petits objets se vendent entre 0,50 € et 5 €, et de nombreux objets usuels entre 3 € et 10 €. Monte vers 10-20 € seulement si la taille, l'état apparent, la qualité ou le caractère complet le justifient clairement. Au-delà de 20-30 €, demande-toi s'il existe un indice visuel concret qui justifie vraiment ce niveau.
  En cas d'incertitude entre deux fourchettes plausibles, choisis plutôt la moitié basse : le vendeur pourra toujours augmenter le prix avant publication.
  La borne basse correspond à une vente rapide, le prix conseillé à un prix attractif de brocante, la borne haute à un prix encore défendable sur place. Utilise des montants simples à payer, notamment 0,50 €, 1 €, 2 €, 3 €, 5 € et 10 €.
  Ne brade pas mécaniquement un objet qui semble réellement rare, recherché ou de collection : dans ce cas seulement, élargis la fourchette et baisse le niveau de confiance ;
- un niveau de confiance low/medium/high ;
- éventuellement une très courte touche fun, sans sur-promesse.

Le vendeur modifiera librement toutes les propositions avant publication.
""".format(categories=" | ".join(LISTING_CATEGORIES)).strip()

        response = self.client.models.generate_content(
            model=self.model_id,
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
            analysis_mode=f"gemini:{self.model_id}",
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
- une estimation de prix indicative et une fourchette prudente si cela a du sens, sinon null. Estime un prix de TRANSACTION en brocante / vide-grenier en France, pas un prix d'annonce en ligne. Pour un objet courant non collector, privilégie franchement le bas de la fourchette : beaucoup de petits objets sont à 0,50-5 €, beaucoup d'objets usuels à 3-10 €, et un prix supérieur à 20-30 € doit être justifié par un indice visuel concret. En cas d'hésitation, choisis plutôt la moitié basse ;
- un niveau de confiance low/medium/high ;
- un avertissement court expliquant l'incertitude principale.

Si aucune catégorie ne convient clairement, choisis "Autre".
""".format(categories=" | ".join(LISTING_CATEGORIES)).strip()

        response = self.client.models.generate_content(
            model=self.model_id,
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
            analysis_mode=f"gemini:{self.model_id}",
        )

    def analyze_assistant_bundle(self, image_key: str) -> AssistantAnalysisBundle:
        from google.genai import types

        prompt = """
Tu prépares en UNE seule analyse l’expérience Assistant photo de BrocAI à partir d’une photo d’objet prise dans une brocante française.

Commence par identifier prudemment l’objet :
- nom probable ;
- UNE catégorie choisie strictement dans cette liste : {categories} ;
- description factuelle très courte ;
- contexte utile sur l’usage, le style ou l’époque seulement si c’est raisonnablement inférable ;
- estimation de prix indicative et fourchette prudente si cela a du sens, sinon null. Vise un vrai prix de brocante : pour un objet courant non collector, privilégie la moitié basse des prix plausibles (souvent 0,50-5 € pour de petits objets et 3-10 € pour beaucoup d'objets usuels). Ne dépasse 20-30 € que si un indice visuel concret le justifie ;
- confiance low/medium/high ;
- avertissement court sur l’incertitude principale.

Prépare ensuite trois réponses rapides cohérentes avec cette même analyse :
- good_deal : aide à juger une bonne affaire à partir de la fourchette estimée, sans supposer connaître le prix affiché exact ;
- tell_more : apporte 2 à 3 phrases de contexte supplémentaire utile sans inventer de certitude ;
- negotiate : fournis UNIQUEMENT une justification très courte et positive qui pourra être affichée après une phrase de négociation générée côté application. Une phrase maximum, spécifique à l'objet si possible. Ne critique jamais le vendeur, son prix, son stand, l'état de l'objet ou ses goûts. L'humour doit rester chaleureux et porter sur la situation de brocante, jamais sur une personne.

Contraintes :
- une photo ne permet pas de certifier marque, authenticité, matière, date, provenance ou valeur ;
- les prix sont des repères de brocante / vide-grenier en France, pas une expertise ;
- les trois réponses doivent pouvoir être affichées directement et rester utiles même avant saisie d’un prix affiché ;
- reste bref, chaleureux et concret ;
- si aucune catégorie ne convient clairement, choisis "Autre".

Retourne un seul objet structuré contenant exactement "analysis" et "quick_replies".
""".format(categories=" | ".join(LISTING_CATEGORIES)).strip()

        response = self.client.models.generate_content(
            model=self.model_id,
            contents=[prompt, self._image_part(image_key)],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiAssistantBundleDraft,
                temperature=0.3,
            ),
        )
        if not response.text:
            raise RuntimeError("Gemini n'a renvoyé aucun bundle Assistant exploitable.")

        result = GeminiAssistantBundleDraft.model_validate_json(response.text)
        price_range = None
        if result.analysis.price_min_eur is not None and result.analysis.price_max_eur is not None:
            low, high = sorted((result.analysis.price_min_eur, result.analysis.price_max_eur))
            price_range = PriceRange(min=low, max=high)

        analysis = AssistantObjectAnalysis(
            name=result.analysis.name.strip(),
            category=result.analysis.category,
            description=result.analysis.description.strip(),
            context_note=result.analysis.context_note.strip(),
            estimated_price_eur=result.analysis.estimated_price_eur,
            price_range_eur=price_range,
            confidence=result.analysis.confidence,
            caution=result.analysis.caution.strip(),
            analysis_mode=f"gemini:{self.model_id}",
        )
        return AssistantAnalysisBundle(
            analysis=analysis,
            quick_replies=result.quick_replies,
        )

    def analyze_fun_bundle(self, image_key: str) -> FunAnalysisBundle:
        from google.genai import types

        prompt = """
Tu prépares en UNE seule analyse l’expérience FunLab de BrocAI à partir d’une photo d’objet prise dans une brocante française.

Commence par identifier prudemment l’objet :
- nom probable ;
- UNE catégorie choisie strictement dans cette liste : {categories} ;
- description factuelle courte ;
- contexte d’usage, de style ou d’époque uniquement si c’est raisonnablement inférable ;
- estimation de prix de brocante et fourchette prudente si cela a du sens, sinon null. Pour un objet courant non collector, privilégie la moitié basse des prix plausibles : souvent 0,50-5 € pour de petits objets et 3-10 € pour beaucoup d'objets usuels ;
- confiance low/medium/high ;
- avertissement court sur l’incertitude principale.

Puis prépare immédiatement quatre créations courtes et vraiment différentes, toutes cohérentes avec le même objet :
- bring_to_life : transforme l’objet en personnage avec un vrai tempérament, une mini-réplique et une chute amusante ;
- movie_star : invente une affiche de film avec un titre qui claque, un slogan et un mini-pitch absurde mais cohérent avec l'objet ;
- imaginary_past : invente une mini-biographie surprenante avec un détail précis lié à l'objet et une petite chute ;
- secret_power : invente un super-pouvoir inattendu, une faiblesse ridicule et une punchline.

Écris chaque création comme une mini-carte souvenir qu'un enfant ou une famille aurait envie de garder en capture d'écran : titre court, sous-titre punchy, histoire de 2 à 3 phrases courtes, avec une vraie petite chute.

Contraintes créatives :
- humour familial, bienveillant et compréhensible par des enfants ; pas de moquerie, humiliation, violence, peur appuyée, sexualisation ou humour méchant ;
- exploite les caractéristiques de CET objet : forme, usage probable, détails visibles ou contexte. Évite les histoires interchangeables qui fonctionneraient avec n'importe quel objet ;
- préfère un détail drôle et précis à trois blagues génériques ;
- évite les clichés répétitifs du type « la légende raconte », « star mondiale », « sauver le monde » si rien dans l'objet ne les rend amusants ;
- n’explique jamais la blague et n’annonce jamais « voici une blague » ;
- n’invente jamais une marque, une authenticité, une origine, une matière, une époque ou une valeur comme un fait certain ;
- tout élément biographique, héroïque, historique ou cinématographique doit être clairement imaginaire ;
- chaque création contient title, subtitle, story, badge et le wish_type exact ;
- si aucune catégorie ne convient clairement, choisis "Autre".

Retourne un seul objet structuré contenant exactement "analysis" et "fun".
""".format(categories=" | ".join(LISTING_CATEGORIES)).strip()

        response = self.client.models.generate_content(
            model=self.model_id,
            contents=[prompt, self._image_part(image_key)],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiFunBundleDraft,
                temperature=0.55,
            ),
        )
        if not response.text:
            raise RuntimeError("Gemini n'a renvoyé aucun bundle FunLab exploitable.")

        result = GeminiFunBundleDraft.model_validate_json(response.text)
        price_range = None
        if result.analysis.price_min_eur is not None and result.analysis.price_max_eur is not None:
            low, high = sorted((result.analysis.price_min_eur, result.analysis.price_max_eur))
            price_range = PriceRange(min=low, max=high)

        analysis = AssistantObjectAnalysis(
            name=result.analysis.name.strip(),
            category=result.analysis.category,
            description=result.analysis.description.strip(),
            context_note=result.analysis.context_note.strip(),
            estimated_price_eur=result.analysis.estimated_price_eur,
            price_range_eur=price_range,
            confidence=result.analysis.confidence,
            caution=result.analysis.caution.strip(),
            analysis_mode=f"gemini:{self.model_id}",
        )

        result.fun.bring_to_life.wish_type = "bring_to_life"
        result.fun.movie_star.wish_type = "movie_star"
        result.fun.imaginary_past.wish_type = "imaginary_past"
        result.fun.secret_power.wish_type = "secret_power"
        return FunAnalysisBundle(analysis=analysis, fun=result.fun)

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
            "negotiate": "Donne d'abord EXACTEMENT la phrase que le visiteur peut lire au vendeur, chaleureuse, naturelle et légèrement drôle, sans être offensante. Puis saute une ligne et ajoute une justification très courte. Si un prix affiché est fourni, propose une cible raisonnable sans offre insultante. Ne critique jamais le vendeur, son prix, le stand ou l'objet.",
            "free": "Réponds directement à la question libre à partir de la fiche de l'objet, sans inventer ce qui n'est pas établi.",
        }[question_type]

        prompt = f"""
Tu réponds à une question sur un objet de brocante déjà analysé. Tu n'as plus accès à la photo : base-toi uniquement sur la fiche ci-dessous.
Sois bref, utile, chaleureux et prudent. Une estimation visuelle n'est pas une expertise ni une authentification.
Pour une négociation, la première ligne doit être uniquement la phrase à dire au vendeur, idéalement entre guillemets français. Ajoute ensuite une ligne vide puis une justification d'une phrase maximum. L'humour est léger et complice : jamais de sarcasme, de jugement sur le prix, le vendeur, son stand ou l'état de l'objet.

Fiche objet :
{json.dumps(analysis.model_dump(mode='json'), ensure_ascii=False)}

Prix affiché par le visiteur : {displayed_price_eur if displayed_price_eur is not None else 'non renseigné'} €
Type de demande : {question_type}
Consigne : {intent}
Question libre : {question or 'aucune'}
""".strip()

        response = self.client.models.generate_content(
            model=self.model_id,
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

    def create_fun_wish(
        self,
        analysis: AssistantObjectAnalysis,
        wish_type: FunWishType,
        quest_type: FunQuestType | None,
        image_keys: list[str],
    ) -> FunCreativeDraft:
        from google.genai import types

        intents = {
            "bring_to_life": "Transforme l'objet en personnage : donne-lui un tempérament, une mini-réplique et une micro-histoire amusante.",
            "movie_star": "Imagine une affiche de film centrée sur l'objet : titre marquant, slogan court et mini-pitch. Tout doit être fictif.",
            "imaginary_past": "Écris une biographie très courte, explicitement imaginaire, comme si l'objet avait déjà vécu plusieurs aventures.",
            "secret_power": "Invente un super-pouvoir absurde pour l'objet, une faiblesse ridicule et une punchline.",
            "fairground_quest": "Raconte une mini-aventure à la fête foraine à partir des trois photos fournies.",
        }
        quest_prompts = {
            "grand_tour": "Photo 2 : attraction qui correspond à la personnalité de l'objet. Photo 3 : endroit où l'objet voudrait finir sa soirée.",
            "secret_mission": "Photo 2 : quelque chose de plus bruyant ou agité que l'objet. Photo 3 : sa couleur jumelle.",
            "fair_star": "Photo 2 : décor parfait pour l'affiche de l'objet. Photo 3 : rival ou complice possible.",
        }

        prompt = f"""
Tu écris pour le FunLab de BrocAI, lors d'une brocante française avec fête foraine.
L'expérience doit être immédiatement compréhensible, franchement amusante, bienveillante et courte. Le sujet principal reste l'objet.
Écris comme une mini-carte souvenir pensée pour être gardée en capture d'écran sur un téléphone : un titre court, une accroche nette et une histoire de 2 à 3 phrases courtes avec une vraie petite chute.
L'humour est familial et adapté aux enfants : absurde, tendre ou malicieux, jamais moqueur, humiliant, violent, effrayant ou sexualisé.
Appuie-toi sur les détails propres à CET objet et évite les histoires génériques qui pourraient fonctionner avec n'importe quelle photo. Une bonne idée précise vaut mieux que plusieurs blagues moyennes.
Tout élément historique, biographique, héroïque ou cinématographique doit être clairement présenté comme imaginaire.
N'affirme jamais une marque, une authenticité, une origine ou une valeur à partir de ce contexte.
Si une personne apparaît sur une photo, ne l'identifie pas, ne décris pas son physique et n'infère aucune caractéristique sensible : elle est seulement le compagnon ou la compagne d'aventure de l'objet.

Objet déjà analysé :
{json.dumps(analysis.model_dump(mode='json'), ensure_ascii=False)}

Vœu : {wish_type}
Consigne créative : {intents[wish_type]}
{f'Mini-aventure : {quest_prompts.get(quest_type, "")}' if wish_type == 'fairground_quest' else ''}

Retourne exactement une création courte :
- title : titre mémorable ;
- subtitle : une phrase très courte ;
- story : 2 à 4 phrases maximum ;
- badge : 2 à 4 mots ;
- wish_type : exactement "{wish_type}".
""".strip()

        contents = prompt
        if wish_type == "fairground_quest":
            if len(image_keys) != 3:
                raise ValueError("La quête FunLab attend exactement trois photos.")
            contents = [prompt, self._image_part(image_keys[0]), self._image_part(image_keys[1]), self._image_part(image_keys[2])]

        response = self.client.models.generate_content(
            model=self.model_id,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=FunCreativeDraft,
                temperature=0.8,
            ),
        )
        if not response.text:
            raise RuntimeError("Gemini n'a renvoyé aucune création FunLab exploitable.")
        result = FunCreativeDraft.model_validate_json(response.text)
        if result.wish_type != wish_type:
            result.wish_type = wish_type
        return result


logger = logging.getLogger(__name__)


class ForcedPrimaryFailure(RuntimeError):
    pass


def _should_use_technical_fallback(exc: Exception) -> bool:
    if isinstance(exc, ForcedPrimaryFailure):
        return True
    if isinstance(exc, (TimeoutError, ConnectionError, json.JSONDecodeError, ValidationError)):
        return True

    status_code = getattr(exc, "status_code", None)
    if status_code is None:
        status_code = getattr(exc, "code", None)
    if status_code in {408, 429, 500, 502, 503, 504}:
        return True

    class_name = type(exc).__name__.lower()
    module_name = type(exc).__module__.lower()
    text = str(exc).lower()
    technical_markers = (
        "timeout",
        "deadline",
        "connection",
        "network",
        "temporarily unavailable",
        "service unavailable",
        "resource exhausted",
        "rate limit",
        "too many requests",
    )
    if any(marker in class_name or marker in module_name or marker in text for marker in technical_markers):
        return True

    unusable_markers = (
        "gemini n'a renvoyé aucune",
        "gemini n'a renvoyé aucun",
        "validation error",
        "invalid json",
    )
    return any(marker in text for marker in unusable_markers)


class AiRoutingError(RuntimeError):
    def __init__(
        self,
        error_code: str,
        public_message: str,
        *,
        primary_code: str | None = None,
    ) -> None:
        super().__init__(public_message)
        self.error_code = error_code
        self.public_message = public_message
        self.primary_code = primary_code


def _status_code(exc: Exception) -> int | None:
    value = getattr(exc, "status_code", None)
    if value is None:
        value = getattr(exc, "code", None)
    return value if isinstance(value, int) else None


def _primary_error_code(exc: Exception) -> str:
    status_code = _status_code(exc)
    if status_code == 400:
        return "AI-PRIMARY-400"
    if status_code == 401:
        return "AI-PRIMARY-401"
    if status_code == 403:
        return "AI-PRIMARY-403"
    if status_code == 429:
        return "AI-PRIMARY-429"
    if status_code in {408, 504}:
        return "AI-PRIMARY-TIMEOUT"
    if status_code is not None and 500 <= status_code <= 599:
        return "AI-PRIMARY-5XX"

    text = str(exc).lower()
    if "gemini_api_key" in text or "api key" in text:
        return "AI-PRIMARY-CONFIG"
    if "timeout" in text or "deadline" in text:
        return "AI-PRIMARY-TIMEOUT"
    if "connection" in text or "network" in text or "dns" in text:
        return "AI-PRIMARY-NETWORK"
    if isinstance(exc, (json.JSONDecodeError, ValidationError)) or "validation error" in text or "invalid json" in text:
        return "AI-PRIMARY-INVALID-OUTPUT"
    if "gemini n'a renvoyé aucune" in text or "gemini n'a renvoyé aucun" in text:
        return "AI-PRIMARY-INVALID-OUTPUT"
    if isinstance(exc, ForcedPrimaryFailure):
        return "AI-PRIMARY-FORCED"
    return "AI-PRIMARY-ERROR"


def _quality_error_code(exc: Exception) -> str:
    return _primary_error_code(exc).replace("AI-PRIMARY-", "AI-QUALITY-", 1)


def _fallback_error_code(exc: Exception) -> str:
    text = str(exc).lower()
    for status_code in (400, 401, 402, 403, 408, 429, 500, 502, 503, 504):
        if f"http {status_code}" in text:
            if status_code == 402:
                return "AI-FALLBACK-402"
            if status_code == 429:
                return "AI-FALLBACK-429"
            if status_code in {408, 504}:
                return "AI-FALLBACK-TIMEOUT"
            if 500 <= status_code <= 599:
                return "AI-FALLBACK-5XX"
            return f"AI-FALLBACK-{status_code}"
    if "hf_token absent" in text:
        return "AI-FALLBACK-CONFIG"
    if "timeout" in text:
        return "AI-FALLBACK-TIMEOUT"
    if "réseau" in text or "network" in text or "connection" in text or "dns" in text:
        return "AI-FALLBACK-NETWORK"
    if "réponse inutilisable" in text or "réponse qwen vide" in text or "sans choices" in text:
        return "AI-FALLBACK-INVALID-OUTPUT"
    return "AI-FALLBACK-ERROR"


class RoutedVisionProvider:
    def __init__(self) -> None:
        self._primary: GeminiVisionProvider | None = None
        self._quality: GeminiVisionProvider | None = None
        self._fallback: QwenVisionProvider | None = None

    @property
    def primary(self) -> GeminiVisionProvider:
        if self._primary is None:
            self._primary = GeminiVisionProvider()
        return self._primary

    @property
    def quality(self) -> GeminiVisionProvider:
        if self._quality is None:
            self._quality = GeminiVisionProvider(model_id=settings.gemini_quality_model)
        return self._quality

    @property
    def fallback(self) -> QwenVisionProvider:
        if self._fallback is None:
            self._fallback = QwenVisionProvider()
        return self._fallback

    def _routing_mode(self) -> str:
        mode = settings.ai_routing_mode.strip().lower()
        if mode not in {"auto", "gemini_only", "qwen_only"}:
            raise AiRoutingError(
                "AI-ROUTING-CONFIG",
                "Le routage IA du serveur est mal configuré.",
            )
        return mode

    def _call_primary(self, operation: str, *args: Any) -> Any:
        if settings.ai_force_primary_failure:
            raise ForcedPrimaryFailure("Panne Gemini forcée pour test de routage.")
        return getattr(self.primary, operation)(*args)

    def _call_fallback(self, operation: str, *args: Any, primary_code: str | None = None) -> Any:
        try:
            return getattr(self.fallback, operation)(*args)
        except Exception as exc:
            code = _fallback_error_code(exc)
            logger.error(
                "AI fallback failed operation=%s code=%s primary_code=%s error=%s",
                operation,
                code,
                primary_code,
                type(exc).__name__,
            )
            raise AiRoutingError(
                code,
                "L’analyse IA est momentanément indisponible après le secours automatique.",
                primary_code=primary_code,
            ) from exc

    @staticmethod
    def _analysis_confidence(operation: str, result: Any) -> str | None:
        if operation == "analyze_for_listing" and isinstance(result, SellerAnalysis):
            return result.confidence
        if operation == "analyze_assistant_bundle" and isinstance(result, AssistantAnalysisBundle):
            return result.analysis.confidence
        if operation == "analyze_fun_bundle" and isinstance(result, FunAnalysisBundle):
            return result.analysis.confidence
        return None

    def _should_scale_up_quality(self, operation: str, result: Any) -> bool:
        confidence = self._analysis_confidence(operation, result)
        if confidence is None:
            return False
        return settings.ai_force_quality_scale_up or confidence == "low"

    def _call_quality(self, operation: str, primary_result: Any, *args: Any) -> Any:
        confidence = self._analysis_confidence(operation, primary_result)
        logger.info(
            "AI quality scale-up requested operation=%s primary_confidence=%s forced=%s model=%s",
            operation,
            confidence,
            settings.ai_force_quality_scale_up,
            settings.gemini_quality_model,
        )
        try:
            if operation == "analyze_for_listing":
                quality_result = self.quality.analyze_for_listing(*args)
            elif operation == "analyze_assistant_bundle":
                quality_analysis = self.quality.analyze_object(args[0])
                quality_result = AssistantAnalysisBundle(
                    analysis=quality_analysis,
                    quick_replies=primary_result.quick_replies,
                )
            elif operation == "analyze_fun_bundle":
                quality_analysis = self.quality.analyze_object(args[0])
                quality_result = FunAnalysisBundle(
                    analysis=quality_analysis,
                    fun=primary_result.fun,
                )
            else:
                return primary_result
        except Exception as exc:
            logger.warning(
                "AI quality scale-up failed operation=%s code=%s model=%s error=%s; keeping primary result",
                operation,
                _quality_error_code(exc),
                settings.gemini_quality_model,
                type(exc).__name__,
            )
            return primary_result

        logger.info(
            "AI quality scale-up succeeded operation=%s model=%s",
            operation,
            settings.gemini_quality_model,
        )
        return quality_result

    def _route(self, operation: str, *args: Any) -> Any:
        mode = self._routing_mode()

        if mode == "qwen_only":
            return self._call_fallback(operation, *args)

        try:
            primary_result = self._call_primary(operation, *args)
        except Exception as exc:
            primary_code = _primary_error_code(exc)
            if mode == "gemini_only" or not _should_use_technical_fallback(exc):
                logger.error(
                    "AI primary failed without fallback operation=%s code=%s error=%s",
                    operation,
                    primary_code,
                    type(exc).__name__,
                )
                raise AiRoutingError(
                    primary_code,
                    "Le service IA principal est indisponible ou mal configuré.",
                ) from exc

            logger.warning(
                "AI primary failed; routing to Qwen fallback operation=%s code=%s",
                operation,
                primary_code,
            )
            return self._call_fallback(
                operation,
                *args,
                primary_code=primary_code,
            )

        if self._should_scale_up_quality(operation, primary_result):
            return self._call_quality(operation, primary_result, *args)
        return primary_result

    def analyze_for_listing(self, image_key: str, original_filename: str | None) -> SellerAnalysis:
        return self._route("analyze_for_listing", image_key, original_filename)

    def analyze_object(self, image_key: str) -> AssistantObjectAnalysis:
        return self._route("analyze_object", image_key)

    def analyze_assistant_bundle(self, image_key: str) -> AssistantAnalysisBundle:
        return self._route("analyze_assistant_bundle", image_key)

    def analyze_fun_bundle(self, image_key: str) -> FunAnalysisBundle:
        return self._route("analyze_fun_bundle", image_key)

    def answer_object_question(
        self,
        analysis: AssistantObjectAnalysis,
        question_type: AssistantQuestionType,
        question: str | None,
        displayed_price_eur: float | None,
    ) -> str:
        return self._route(
            "answer_object_question",
            analysis,
            question_type,
            question,
            displayed_price_eur,
        )

    def create_fun_wish(
        self,
        analysis: AssistantObjectAnalysis,
        wish_type: FunWishType,
        quest_type: FunQuestType | None,
        image_keys: list[str],
    ) -> FunCreativeDraft:
        return self._route(
            "create_fun_wish",
            analysis,
            wish_type,
            quest_type,
            image_keys,
        )


def get_vision_provider() -> VisionProvider:
    provider = settings.ai_provider.strip().lower()
    if provider == "mock":
        return MockVisionProvider()
    if provider == "gemini":
        return RoutedVisionProvider()
    raise RuntimeError(f"AI_PROVIDER inconnu : {settings.ai_provider!r}. Utilisez 'mock' ou 'gemini'.")


vision_provider = get_vision_provider()

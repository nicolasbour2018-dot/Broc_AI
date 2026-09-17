import unicodedata
from enum import StrEnum


class ListingCategory(StrEnum):
    FURNITURE_DECOR = "Meubles & décoration"
    KITCHEN = "Vaisselle & cuisine"
    FASHION = "Vêtements & accessoires"
    BOOKS_MEDIA = "Livres & médias"
    TOYS = "Jeux & jouets"
    ELECTRONICS = "Électronique"
    DIY_GARDEN = "Bricolage & jardin"
    SPORTS_LEISURE = "Sport & loisirs"
    COLLECTIBLES = "Collection & vintage"
    CHILDCARE = "Enfant & puériculture"
    JEWELRY_WATCHES = "Bijoux & montres"
    OTHER = "Autre"


LISTING_CATEGORIES = tuple(category.value for category in ListingCategory)
_LISTING_CATEGORY_VALUES = frozenset(LISTING_CATEGORIES)


def _fold(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.casefold())
    return "".join(char for char in normalized if not unicodedata.combining(char))


_LEGACY_CATEGORY_KEYWORDS: tuple[tuple[ListingCategory, tuple[str, ...]], ...] = (
    (ListingCategory.FURNITURE_DECOR, ("meuble", "mobilier", "deco", "decoration", "luminaire")),
    (ListingCategory.KITCHEN, ("vaisselle", "cuisine", "assiette", "verre", "ustensile")),
    (ListingCategory.FASHION, ("vetement", "mode", "chaussure", "sac", "accessoire")),
    (ListingCategory.BOOKS_MEDIA, ("livre", "media", "dvd", "cd", "vinyle", "musique", "film")),
    (ListingCategory.TOYS, ("jeu", "jouet", "puzzle")),
    (ListingCategory.ELECTRONICS, ("electron", "informatique", "telephone", "console", "hifi")),
    (ListingCategory.DIY_GARDEN, ("bricolage", "jardin", "outil")),
    (ListingCategory.SPORTS_LEISURE, ("sport", "loisir", "velo", "camping")),
    (ListingCategory.COLLECTIBLES, ("collection", "vintage", "antiqu", "retro")),
    (ListingCategory.CHILDCARE, ("pueric", "bebe", "enfant")),
    (ListingCategory.JEWELRY_WATCHES, ("bijou", "montre", "joaill")),
)


def normalize_category(value: str | ListingCategory | None) -> ListingCategory:
    if isinstance(value, ListingCategory):
        return value
    cleaned = (value or "").strip()
    if cleaned in _LISTING_CATEGORY_VALUES:
        return ListingCategory(cleaned)

    folded = _fold(cleaned)
    for category, keywords in _LEGACY_CATEGORY_KEYWORDS:
        if any(keyword in folded for keyword in keywords):
            return category
    return ListingCategory.OTHER

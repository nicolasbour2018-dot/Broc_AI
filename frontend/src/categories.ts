export const LISTING_CATEGORIES = [
  'Meubles & décoration',
  'Vaisselle & cuisine',
  'Vêtements & accessoires',
  'Livres & médias',
  'Jeux & jouets',
  'Électronique',
  'Bricolage & jardin',
  'Sport & loisirs',
  'Collection & vintage',
  'Enfant & puériculture',
  'Bijoux & montres',
  'Autre'
] as const

export type ListingCategory = typeof LISTING_CATEGORIES[number]

export const DEFAULT_CATEGORY: ListingCategory = 'Autre'

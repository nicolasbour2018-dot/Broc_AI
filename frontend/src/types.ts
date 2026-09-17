export type Confidence = 'low' | 'medium' | 'high'

export interface SellerAnalysis {
  image_key: string
  title: string
  description: string
  category: string | null
  suggested_price_eur: number
  price_range_eur: { min: number; max: number }
  confidence: Confidence
  fun_line: string | null
  analysis_mode: string
}

export interface Listing {
  id: string
  image_url: string
  title: string
  description: string
  category: string | null
  price_eur: string
  stand_number: string
  seller_alias: string | null
  created_at: string
  sold_at: string | null
}

export interface ListingDraft {
  image_key: string
  title: string
  description: string
  category: string
  price_eur: string
  stand_number: string
  seller_alias: string
}

export interface ListingEditDraft {
  stand_number: string
  title: string
  description: string
  category: string
  price_eur: string
  seller_alias: string
}

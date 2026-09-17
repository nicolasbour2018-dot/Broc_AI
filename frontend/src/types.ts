import type { ListingCategory } from './categories'

export type Confidence = 'low' | 'medium' | 'high'

export interface SellerAnalysis {
  image_key: string
  title: string
  description: string
  category: ListingCategory
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
  fun_line: string | null
  category: ListingCategory
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
  fun_line: string
  category: ListingCategory
  price_eur: string
  stand_number: string
  seller_alias: string
}

export interface ListingEditDraft {
  stand_number: string
  title: string
  description: string
  fun_line: string
  category: ListingCategory
  price_eur: string
  seller_alias: string
}

export type AssistantQuestionType = 'good_deal' | 'tell_more' | 'negotiate' | 'free'

export interface AssistantAnalysis {
  scan_id: string
  name: string
  category: ListingCategory
  description: string
  context_note: string
  estimated_price_eur: number | null
  price_range_eur: { min: number; max: number } | null
  confidence: Confidence
  caution: string
  analysis_mode: string
  questions_remaining: number
}

export interface AssistantQuestionResponse {
  answer: string
  questions_remaining: number
}

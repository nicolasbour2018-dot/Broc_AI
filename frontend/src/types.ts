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

export type FunWishType = 'bring_to_life' | 'movie_star' | 'imaginary_past' | 'secret_power' | 'fairground_quest'
export type FunQuestType = 'grand_tour' | 'secret_mission' | 'fair_star'

export interface FunWishResult {
  wish_type: FunWishType
  title: string
  subtitle: string
  story: string
  badge: string
  wishes_remaining: number
  wish_index: number
}

export type AiJobStatus = 'queued' | 'running' | 'success' | 'error' | 'timeout'

export interface AiJobProgress {
  id: string
  feature: 'seller' | 'assistant' | 'assistant_question' | 'fun_analyze' | 'fun_wish'
  status: AiJobStatus
  queue_position: number | null
  queue_size: number
  in_flight: number
  wait_label: string | null
  error_code: string | null
  error_message: string | null
}

export interface AiJob<T> extends AiJobProgress {
  result: T | null
}

export interface AdminMetrics {
  generated_at: string
  service: { status: string; database: string; routing_mode: string }
  queue: { queued: number; running: number; max_in_flight: number }
  ai: {
    total_calls: number
    last_hour_calls: number
    success: number
    error: number
    timeout: number
    recent_sample_size: number
    average_latency_ms: number | null
    average_queue_wait_ms: number | null
    last_hour_error_rate_percent: number
  }
  product: {
    sessions: number
    publications: number
    listings_total: number
    listings_active: number
    searches: number
    listing_views: number
    assistant_scans: number
    assistant_questions: number
    errors_shown: number
  }
  catalogue: { average_latency_ms: number | null; recent_sample_size: number }
  system: {
    cpu_count: number
    load_1m: number | null
    load_percent_of_capacity: number | null
    memory_used_mb: number | null
    memory_total_mb: number | null
    memory_usage_percent: number | null
    process_rss_mb: number | null
  }
  recent_jobs: Array<{
    id: string
    feature: string
    status: AiJobStatus
    duration_ms: number | null
    queue_wait_ms: number | null
    error_code: string | null
    completed_at: string | null
  }>
}

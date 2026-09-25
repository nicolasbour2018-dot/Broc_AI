import type { ListingCategory } from './categories'
import { readSellerOnboarding } from './sellerOnboarding'
import type { AdminJourneys, AdminMetrics, AiJob, AiJobProgress, AssistantAnalysis, AssistantQuestionResponse, AssistantQuestionType, FunQuestType, FunWishResult, FunWishType, Listing, ListingCategoryCounts, ListingDraft, ListingEditDraft, SellerAnalysis } from './types'

const SESSION_KEY = 'brocai-session-id'
const SESSION_STARTED_KEY = 'brocai-session-started'

export type EntrySource = 'welcome' | 'home' | 'home_listing' | 'marketplace' | 'seller_dashboard' | 'seller_create' | 'direct'

function deviceContext(): { device_context: 'visitor' | 'seller'; seller_stand: string | null } {
  const onboarding = readSellerOnboarding()
  return onboarding
    ? { device_context: 'seller', seller_stand: onboarding.stand }
    : { device_context: 'visitor', seller_stand: null }
}

function journeyHeaders(entrySource: EntrySource): Record<string, string> {
  const context = deviceContext()
  return {
    'X-Session-ID': getSessionId(),
    'X-Device-Context': context.device_context,
    'X-Entry-Source': entrySource,
    ...(context.seller_stand ? { 'X-Seller-Stand': context.seller_stand } : {})
  }
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
  }

  return `brocai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function getSessionId(): string {
  let value = sessionStorage.getItem(SESSION_KEY)
  if (!value) {
    value = createSessionId()
    sessionStorage.setItem(SESSION_KEY, value)
  }
  return value
}

export async function trackEvent(
  eventName:
    | 'session_started'
    | 'onboarding_viewed'
    | 'onboarding_marketplace_clicked'
    | 'marketplace_opened'
    | 'marketplace_category_selected'
    | 'batch_started'
    | 'batch_completed'
    | 'batch_published'
    | 'nav_opened'
    | 'catalogue_loaded'
    | 'error_shown'
    | 'demo_opened'
    | 'feature_clicked'
    | 'chat_started'
    | 'message_count'
    | 'demo_duration_s'
    | 'demo_reset',
  properties: Record<string, string | number | boolean | null> = {}
): Promise<void> {
  try {
    await fetch('/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': getSessionId()
      },
      body: JSON.stringify({ event_name: eventName, properties: { ...properties, ...deviceContext() } })
    })
  } catch {
    // Analytics must never break a product flow.
  }
}

export async function trackSessionStarted(entrySource: EntrySource): Promise<void> {
  if (sessionStorage.getItem(SESSION_STARTED_KEY)) return
  sessionStorage.setItem(SESSION_STARTED_KEY, '1')
  await trackEvent('session_started', { entry_source: entrySource })
}

async function parseError(response: Response): Promise<string> {
  void trackEvent('error_shown', {
    status: response.status,
    path: response.url ? new URL(response.url).pathname : 'unknown'
  })
  try {
    const payload = await response.json() as { detail?: string }
    return payload.detail || 'Une erreur est survenue.'
  } catch {
    return 'Une erreur est survenue.'
  }
}


async function parseAdminError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: string }
    return payload.detail || 'Accès admin impossible.'
  } catch {
    return 'Accès admin impossible.'
  }
}

type ProgressCallback = (progress: AiJobProgress) => void

const POLL_INTERVAL_MS = 1200

async function fetchAiJob<T>(jobId: string): Promise<AiJob<T>> {
  const response = await fetch(`/api/ai/jobs/${encodeURIComponent(jobId)}`, {
    headers: { 'X-Session-ID': getSessionId() }
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<AiJob<T>>
}

async function waitForAiJob<T>(initial: AiJob<T>, onProgress?: ProgressCallback): Promise<T> {
  let job = initial
  onProgress?.(job)

  let transientFailures = 0
  while (job.status === 'queued' || job.status === 'running') {
    await new Promise(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS))
    try {
      job = await fetchAiJob<T>(job.id)
      transientFailures = 0
      onProgress?.(job)
    } catch (error) {
      transientFailures += 1
      if (transientFailures >= 8) throw error
    }
  }

  if (job.status !== 'success' || !job.result) {
    const message = job.error_message || 'L’analyse n’est pas disponible pour le moment.'
    const code = job.error_code ? ` · Code : ${job.error_code}` : ''
    throw new Error(`${message}${code}`)
  }
  return job.result
}

export async function submitSellerPhoto(file: File): Promise<AiJob<SellerAnalysis>> {
  const body = new FormData()
  body.append('photo', file)
  const response = await fetch('/api/seller/analyze', {
    method: 'POST',
    headers: { 'X-Session-ID': getSessionId() },
    body
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<AiJob<SellerAnalysis>>
}

export async function followSellerJob(jobId: string, onProgress?: ProgressCallback): Promise<AiJob<SellerAnalysis>> {
  let job = await fetchAiJob<SellerAnalysis>(jobId)
  onProgress?.(job)
  let transientFailures = 0
  while (job.status === 'queued' || job.status === 'running') {
    await new Promise(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS))
    try {
      job = await fetchAiJob<SellerAnalysis>(jobId)
      transientFailures = 0
      onProgress?.(job)
    } catch (error) {
      transientFailures += 1
      if (transientFailures >= 8) throw error
    }
  }
  return job
}

export async function publishListing(draft: ListingDraft): Promise<Listing> {
  const response = await fetch('/api/listings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': getSessionId()
    },
    body: JSON.stringify({
      ...draft,
      category: draft.category,
      seller_alias: draft.seller_alias || null,
      price_eur: Number(draft.price_eur)
    })
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<Listing>
}

export async function updateListing(listingId: string, draft: ListingEditDraft): Promise<Listing> {
  const response = await fetch(`/api/seller/listings/${encodeURIComponent(listingId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': getSessionId()
    },
    body: JSON.stringify({
      ...draft,
      category: draft.category,
      seller_alias: draft.seller_alias || null,
      price_eur: Number(draft.price_eur)
    })
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<Listing>
}

export async function fetchListings(query = '', category?: ListingCategory, limit?: number, offset = 0, entrySource: EntrySource = 'marketplace'): Promise<Listing[]> {
  const started = performance.now()
  const url = new URL('/api/listings', window.location.origin)
  if (query.trim()) url.searchParams.set('q', query.trim())
  if (category) url.searchParams.set('category', category)
  if (limit) url.searchParams.set('limit', String(limit))
  if (offset) url.searchParams.set('offset', String(offset))
  const response = await fetch(url, { headers: journeyHeaders(entrySource) })
  if (!response.ok) throw new Error(await parseError(response))
  const rows = await response.json() as Listing[]
  void trackEvent('catalogue_loaded', {
    latency_ms: Math.round(performance.now() - started),
    filtered: Boolean(query.trim() || category),
    results: rows.length
  })
  return rows
}

export async function fetchListingCategoryCounts(): Promise<ListingCategoryCounts> {
  const response = await fetch('/api/listings/category-counts')
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<ListingCategoryCounts>
}

// Home preview of the newest active listings. Deliberately not tracked as `catalogue_loaded`,
// which measures the mini-market catalogue itself.
export async function fetchLatestListings(limit: number): Promise<Listing[]> {
  const url = new URL('/api/listings', window.location.origin)
  url.searchParams.set('limit', String(limit))
  const response = await fetch(url, { headers: { 'X-Session-ID': getSessionId() } })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<Listing[]>
}

export async function fetchListing(listingId: string, entrySource: EntrySource = 'marketplace'): Promise<Listing> {
  const response = await fetch(`/api/listings/${encodeURIComponent(listingId)}`, {
    headers: journeyHeaders(entrySource)
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<Listing>
}

export async function fetchSellerListings(standNumber: string): Promise<Listing[]> {
  const url = new URL('/api/seller/listings', window.location.origin)
  url.searchParams.set('stand_number', standNumber.trim())
  const response = await fetch(url, { headers: { 'X-Session-ID': getSessionId() } })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<Listing[]>
}

export async function downloadSellerReport(standNumber: string): Promise<void> {
  const url = new URL('/api/seller/report', window.location.origin)
  url.searchParams.set('stand_number', standNumber.trim())
  const response = await fetch(url, { headers: { 'X-Session-ID': getSessionId() } })
  if (!response.ok) throw new Error(await parseError(response))

  const blob = await response.blob()
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const safeStand = standNumber.trim().replace(/[^a-zA-Z0-9_-]+/g, '-') || 'stand'
  anchor.href = href
  anchor.download = `brocai-${safeStand}-bilan.pdf`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}

export async function setListingSold(listingId: string, standNumber: string, sold: boolean): Promise<Listing> {
  const response = await fetch(`/api/seller/listings/${encodeURIComponent(listingId)}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': getSessionId()
    },
    body: JSON.stringify({ stand_number: standNumber.trim(), sold })
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<Listing>
}

export async function analyzeAssistantPhoto(file: File, onProgress?: ProgressCallback): Promise<AssistantAnalysis> {
  const body = new FormData()
  body.append('photo', file)
  const response = await fetch('/api/assistant/analyze', {
    method: 'POST',
    headers: { 'X-Session-ID': getSessionId() },
    body
  })
  if (!response.ok) throw new Error(await parseError(response))
  const job = await response.json() as AiJob<AssistantAnalysis>
  return waitForAiJob(job, onProgress)
}

export async function askAssistantQuestion(
  scanId: string,
  questionType: AssistantQuestionType,
  question?: string,
  displayedPriceEur?: number,
  onProgress?: ProgressCallback
): Promise<AssistantQuestionResponse> {
  const response = await fetch(`/api/assistant/scans/${encodeURIComponent(scanId)}/questions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': getSessionId()
    },
    body: JSON.stringify({
      question_type: questionType,
      question: question?.trim() || null,
      displayed_price_eur: Number.isFinite(displayedPriceEur) ? displayedPriceEur : null
    })
  })
  if (!response.ok) throw new Error(await parseError(response))
  const payload = await response.json() as AiJob<AssistantQuestionResponse> | AssistantQuestionResponse
  if ('answer' in payload) {
    return payload
  }
  return waitForAiJob(payload, onProgress)
}


export async function analyzeFunPhoto(file: File, onProgress?: ProgressCallback): Promise<AssistantAnalysis> {
  const body = new FormData()
  body.append('photo', file)
  const response = await fetch('/api/fun/analyze', {
    method: 'POST',
    headers: { 'X-Session-ID': getSessionId() },
    body
  })
  if (!response.ok) throw new Error(await parseError(response))
  const job = await response.json() as AiJob<AssistantAnalysis>
  return waitForAiJob(job, onProgress)
}

export async function requestFunWish(
  scanId: string,
  wishType: Exclude<FunWishType, 'fairground_quest'>,
  _onProgress?: ProgressCallback
): Promise<FunWishResult> {
  const response = await fetch(`/api/fun/scans/${encodeURIComponent(scanId)}/wishes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-ID': getSessionId() },
    body: JSON.stringify({ wish_type: wishType })
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<FunWishResult>
}

export async function requestFunQuest(
  scanId: string,
  questType: FunQuestType,
  selfie: File,
  missionOne: File,
  missionTwo: File,
  onProgress?: ProgressCallback
): Promise<FunWishResult> {
  const body = new FormData()
  body.append('quest_type', questType)
  body.append('selfie', selfie)
  body.append('mission_one', missionOne)
  body.append('mission_two', missionTwo)
  const response = await fetch(`/api/fun/scans/${encodeURIComponent(scanId)}/quest`, {
    method: 'POST',
    headers: { 'X-Session-ID': getSessionId() },
    body
  })
  if (!response.ok) throw new Error(await parseError(response))
  const job = await response.json() as AiJob<FunWishResult>
  return waitForAiJob(job, onProgress)
}


export async function fetchAdminMetrics(token: string): Promise<AdminMetrics> {
  const response = await fetch('/api/admin/metrics', {
    headers: { 'X-Admin-Token': token }
  })
  if (!response.ok) throw new Error(await parseAdminError(response))
  return response.json() as Promise<AdminMetrics>
}

export async function fetchAdminJourneys(token: string): Promise<AdminJourneys> {
  const response = await fetch('/api/admin/journeys', {
    headers: { 'X-Admin-Token': token }
  })
  if (!response.ok) throw new Error(await parseAdminError(response))
  return response.json() as Promise<AdminJourneys>
}

export async function updateAdminRouting(
  token: string,
  mode: 'auto' | 'gemini_only' | 'qwen_only'
): Promise<void> {
  const response = await fetch('/api/admin/routing', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': token
    },
    body: JSON.stringify({ mode, reason: 'Changement manuel depuis Console Ops' })
  })
  if (!response.ok) throw new Error(await parseAdminError(response))
}

export async function downloadAdminExport(
  token: string,
  dataset: 'events' | 'ai_jobs' | 'listings',
  format: 'csv' | 'json'
): Promise<void> {
  const url = new URL('/api/admin/export', window.location.origin)
  url.searchParams.set('dataset', dataset)
  url.searchParams.set('format', format)
  const response = await fetch(url, { headers: { 'X-Admin-Token': token } })
  if (!response.ok) throw new Error(await parseAdminError(response))

  const blob = await response.blob()
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `brocai-${dataset}-${new Date().toISOString().slice(0, 10)}.${format}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(href)
}

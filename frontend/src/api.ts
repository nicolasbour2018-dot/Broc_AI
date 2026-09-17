import type { Listing, ListingDraft, ListingEditDraft, SellerAnalysis } from './types'

const SESSION_KEY = 'brocai-session-id'

function getSessionId(): string {
  let value = localStorage.getItem(SESSION_KEY)
  if (!value) {
    value = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, value)
  }
  return value
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: string }
    return payload.detail || 'Une erreur est survenue.'
  } catch {
    return 'Une erreur est survenue.'
  }
}

export async function analyzeSellerPhoto(file: File): Promise<SellerAnalysis> {
  const body = new FormData()
  body.append('photo', file)
  const response = await fetch('/api/seller/analyze', {
    method: 'POST',
    headers: { 'X-Session-ID': getSessionId() },
    body
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<SellerAnalysis>
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
      category: draft.category || null,
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
      category: draft.category || null,
      seller_alias: draft.seller_alias || null,
      price_eur: Number(draft.price_eur)
    })
  })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<Listing>
}

export async function fetchListings(query = ''): Promise<Listing[]> {
  const url = new URL('/api/listings', window.location.origin)
  if (query.trim()) url.searchParams.set('q', query.trim())
  const response = await fetch(url, { headers: { 'X-Session-ID': getSessionId() } })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<Listing[]>
}

export async function fetchSellerListings(standNumber: string): Promise<Listing[]> {
  const url = new URL('/api/seller/listings', window.location.origin)
  url.searchParams.set('stand_number', standNumber.trim())
  const response = await fetch(url, { headers: { 'X-Session-ID': getSessionId() } })
  if (!response.ok) throw new Error(await parseError(response))
  return response.json() as Promise<Listing[]>
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

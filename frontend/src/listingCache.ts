import type { Listing } from './types'

// Listings already on screen, so a tapped card opens its detail instantly while the fresh copy loads.
const cache = new Map<string, Listing>()

export function rememberListings(items: Listing[]): void {
  for (const item of items) cache.set(item.id, item)
}

export function cachedListing(id: string): Listing | null {
  return cache.get(id) ?? null
}

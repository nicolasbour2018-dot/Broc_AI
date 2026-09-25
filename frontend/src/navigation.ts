import { useSyncExternalStore } from 'react'
import { LISTING_CATEGORIES } from './categories'
import type { ListingCategory } from './categories'

// Screens live in the URL so the phone's back button walks back through the app instead of leaving it,
// market filters survive a back/forward, and a listing has a link of its own. nginx already serves
// index.html for every path (`try_files $uri /index.html`).
export type Route =
  | { name: 'home' }
  | { name: 'market'; q: string; category: ListingCategory | ''; all: boolean }
  | { name: 'listing'; id: string }
  | { name: 'assistant' }
  | { name: 'seller' }
  | { name: 'series'; camera: boolean }
  | { name: 'editListing'; id: string }
  | { name: 'funlab' }
  | { name: 'admin' }
  | { name: 'showroom' }

// The screen name used by analytics (`nav_opened`, `session_started`), unchanged from the view-based app.
export type ViewName = 'home' | 'market' | 'assistant' | 'seller' | 'funlab' | 'admin' | 'showroom'

export function routeView(route: Route): ViewName {
  switch (route.name) {
    case 'market': case 'listing': return 'market'
    case 'seller': case 'series': case 'editListing': return 'seller'
    default: return route.name
  }
}

function asCategory(value: string | null): ListingCategory | '' {
  return value && (LISTING_CATEGORIES as readonly string[]).includes(value) ? value as ListingCategory : ''
}

export function parseLocation(location: Pick<Location, 'pathname' | 'search'>): Route {
  const path = location.pathname.replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(location.search)
  if (path === '/admin') return { name: 'admin' }
  if (path === '/showroom') return { name: 'showroom' }
  if (path === '/fun') return { name: 'funlab' }
  if (path === '/analyser') return { name: 'assistant' }
  if (path === '/stand') return { name: 'seller' }
  if (path === '/stand/serie') return { name: 'series', camera: params.get('camera') === '1' }
  const edit = path.match(/^\/stand\/annonce\/([^/]+)$/)
  if (edit) return { name: 'editListing', id: decodeURIComponent(edit[1]) }
  if (path === '/objets') {
    const q = (params.get('q') || '').trim()
    const category = asCategory(params.get('rayon'))
    return { name: 'market', q, category, all: Boolean(q || category || params.get('tout')) }
  }
  const listing = path.match(/^\/objets\/([^/]+)$/)
  if (listing) return { name: 'listing', id: decodeURIComponent(listing[1]) }
  return { name: 'home' }
}

export function routePath(route: Route): string {
  switch (route.name) {
    case 'home': return '/'
    case 'market': {
      const params = new URLSearchParams()
      if (route.q) params.set('q', route.q)
      if (route.category) params.set('rayon', route.category)
      if (route.all && !route.q && !route.category) params.set('tout', '1')
      const search = params.toString()
      return search ? `/objets?${search}` : '/objets'
    }
    case 'listing': return `/objets/${encodeURIComponent(route.id)}`
    case 'assistant': return '/analyser'
    case 'seller': return '/stand'
    case 'series': return route.camera ? '/stand/serie?camera=1' : '/stand/serie'
    case 'editListing': return `/stand/annonce/${encodeURIComponent(route.id)}`
    case 'funlab': return '/fun'
    case 'admin': return '/admin'
    case 'showroom': return '/showroom'
  }
}

export function marketRoute(options: Partial<{ q: string; category: ListingCategory | ''; all: boolean }> = {}): Extract<Route, { name: 'market' }> {
  const q = (options.q || '').trim()
  const category = options.category || ''
  return { name: 'market', q, category, all: Boolean(options.all || q || category) }
}

const CHANGE_EVENT = 'brocai:navigate'
let cachedKey = ''
let cachedRoute: Route = { name: 'home' }

function currentRoute(): Route {
  const key = window.location.pathname + window.location.search
  if (key !== cachedKey) {
    cachedKey = key
    cachedRoute = parseLocation(window.location)
  }
  return cachedRoute
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute)
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const path = routePath(route)
  if (path === window.location.pathname + window.location.search) return
  // Entries pushed by the app are marked so goBack knows history.back() stays inside BrocAI.
  const state = options.replace ? window.history.state : { brocai: true }
  if (options.replace) window.history.replaceState(state, '', path)
  else window.history.pushState(state, '', path)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

// Opens the series camera with the series screen underneath it in history, so closing the camera
// (one step back) lands on the photos just taken instead of the screen the camera was opened from.
export function openSeriesCamera(): void {
  if (currentRoute().name !== 'series') navigate({ name: 'series', camera: false })
  navigate({ name: 'series', camera: true })
}

// Back inside the app when this entry was pushed by it, otherwise to a sensible parent screen
// (a listing opened from a shared link has no in-app history to return to).
export function goBack(fallback: Route): void {
  const state: unknown = window.history.state
  if (state && typeof state === 'object' && 'brocai' in state) {
    window.history.back()
    return
  }
  navigate(fallback, { replace: true })
}

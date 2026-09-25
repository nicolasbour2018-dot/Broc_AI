import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchListing, fetchListingCategoryCounts, fetchListings, trackEvent } from '../api'
import type { EntrySource } from '../api'
import type { ListingCategory } from '../categories'
import { formatRelative, plural, useNow } from '../format'
import { cachedListing, rememberListings } from '../listingCache'
import { goBack, marketRoute, navigate } from '../navigation'
import type { Route } from '../navigation'
import type { Listing, ListingCategoryCounts } from '../types'
import { CategoryGrid } from '../ui/CategoryGrid'
import { CATEGORY_DISPLAY, Icon } from '../ui/icons'
import { ListingCard, ListingSkeletons } from '../ui/ListingCard'
import { Alert, Page, TopBar } from '../ui/Page'
import { PriceTag, StandBadge } from '../ui/Tags'
import { Tip } from '../ui/Tip'

const MARKET_RECENT_COUNT = 12
const MARKET_PAGE_SIZE = 24

type MarketRoute = Extract<Route, { name: 'market' }>
type ListingRoute = Extract<Route, { name: 'listing' }>

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message !== 'Une erreur est survenue.' ? err.message : fallback
}

// The list stays mounted under an open listing, so returning keeps its results and scroll position.
export default function Market({ route, entrySource }: { route: MarketRoute | ListingRoute; entrySource: EntrySource }) {
  const listRoute = useRef<MarketRoute>(route.name === 'market' ? route : marketRoute())
  if (route.name === 'market') listRoute.current = route
  const list = listRoute.current
  const scrollY = useRef(0)
  // A listing opened from this list is a marketplace view; one reached directly keeps the entry source.
  const detailSource = useRef<EntrySource>(entrySource)
  const wasDetail = useRef(route.name === 'listing')

  useLayoutEffect(() => {
    if (route.name === 'listing' && !wasDetail.current) window.scrollTo(0, 0)
    if (route.name === 'market' && wasDetail.current) window.scrollTo(0, scrollY.current)
    wasDetail.current = route.name === 'listing'
  }, [route.name])

  function open(item: Listing) {
    scrollY.current = window.scrollY
    detailSource.current = 'marketplace'
    rememberListings([item])
    navigate({ name: 'listing', id: item.id })
  }

  return (
    <>
      <div hidden={route.name === 'listing'}>
        <MarketList route={list} entrySource={entrySource} onOpen={open} />
      </div>
      {route.name === 'listing' && <ListingDetail key={route.id} id={route.id} entrySource={detailSource.current} />}
    </>
  )
}

function MarketList({ route, entrySource, onOpen }: { route: MarketRoute; entrySource: EntrySource; onOpen: (item: Listing) => void }) {
  const now = useNow()
  const [query, setQuery] = useState(route.q)
  const [items, setItems] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [counts, setCounts] = useState<ListingCategoryCounts | null>(null)
  const [countsError, setCountsError] = useState('')
  const requestVersion = useRef(0)
  const firstLoad = useRef(true)

  const { q, category, all } = route
  const filtered = Boolean(q || category)

  async function load() {
    const version = ++requestVersion.current
    setLoading(true)
    setError('')
    setMoreError('')
    setItems([])
    setHasMore(false)
    // The first request carries how the visitor arrived; later ones are browsing inside the market.
    const source = firstLoad.current ? entrySource : 'marketplace'
    firstLoad.current = false
    try {
      const rows = await fetchListings(q, category || undefined, all ? MARKET_PAGE_SIZE + 1 : MARKET_RECENT_COUNT, 0, source)
      if (version !== requestVersion.current) return
      const shown = all ? rows.slice(0, MARKET_PAGE_SIZE) : rows
      rememberListings(shown)
      setItems(shown)
      setHasMore(all && rows.length > MARKET_PAGE_SIZE)
    } catch (err) {
      if (version === requestVersion.current) setError(errorText(err, 'Les annonces ne s’affichent pas pour le moment.'))
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }

  async function loadMore() {
    if (loading || loadingMore || !hasMore) return
    const version = requestVersion.current
    setLoadingMore(true)
    setMoreError('')
    try {
      const rows = await fetchListings(q, category || undefined, MARKET_PAGE_SIZE + 1, items.length)
      if (version !== requestVersion.current) return
      const next = rows.slice(0, MARKET_PAGE_SIZE)
      rememberListings(next)
      setItems(previous => {
        const seen = new Set(previous.map(item => item.id))
        return [...previous, ...next.filter(item => !seen.has(item.id))]
      })
      setHasMore(rows.length > MARKET_PAGE_SIZE)
    } catch (err) {
      if (version === requestVersion.current) setMoreError(errorText(err, 'Impossible d’afficher plus d’objets.'))
    } finally {
      if (version === requestVersion.current) setLoadingMore(false)
    }
  }

  async function loadCounts() {
    setCountsError('')
    try {
      setCounts(await fetchListingCategoryCounts())
    } catch (err) {
      setCountsError(errorText(err, 'Rayons indisponibles pour le moment.'))
    }
  }

  useEffect(() => { void loadCounts() }, [])
  useEffect(() => {
    setQuery(q)
    void load()
    return () => { requestVersion.current += 1 }
  }, [q, category, all])

  function submit(e: FormEvent) {
    e.preventDefault()
    navigate(marketRoute({ q: query, category }))
  }

  function pickCategory(value: ListingCategory) {
    void trackEvent('marketplace_category_selected', { category: value, entry_source: 'marketplace' })
    navigate(marketRoute({ q, category: value }))
  }

  const categoryCount = category ? counts?.categories.find(item => item.category === category)?.count : undefined
  const shownCount = hasMore ? `${items.length} premiers objets` : plural(items.length, 'objet')
  const heading = q ? `Résultats pour « ${q} »` : category ? category : all ? 'Tous les objets' : 'Tout juste déballé'
  const hint = q
    ? `${shownCount} dont le titre, la description ou le rayon contient « ${q} »${category ? `, dans le rayon ${CATEGORY_DISPLAY[category].short}` : ''}. Les plus récents d’abord.`
    : category
      ? `${plural(categoryCount ?? items.length, 'objet')} en vente dans ce rayon, les plus récents d’abord.`
      : all
        ? `${plural(counts?.total ?? items.length, 'objet')} en vente, du plus récent au plus ancien.`
        : `Les ${MARKET_RECENT_COUNT} dernières annonces publiées, les plus récentes d’abord.`

  return (
    <Page wide className="market">
      <TopBar onBack={() => goBack({ name: 'home' })} />
      <h1 className="page-title">Trouver un objet</h1>
      <form className="search-box" role="search" onSubmit={submit}>
        <label htmlFor="market-search" className="sr-only">Rechercher un objet</label>
        <div className="search-box__row">
          <Icon name="search" className="search-box__icon" />
          <input id="market-search" type="search" enterKeyHint="search" placeholder="lampe, vinyle, jouet…" value={query} onChange={e => setQuery(e.target.value)} />
          <button type="submit" className="btn btn--primary">Chercher</button>
        </div>
      </form>

      <Tip id="market-stand">Chaque annonce indique son <strong>numéro de stand</strong> : c’est là que vous trouverez l’objet et son vendeur.</Tip>

      {filtered && (
        <div className="filter-chips" aria-label="Filtres actifs">
          {q && <button type="button" className="filter-chip" onClick={() => navigate(marketRoute({ category }))} aria-label={`Retirer la recherche ${q}`}>« {q} » <Icon name="close" size={18} /></button>}
          {category && <button type="button" className="filter-chip" onClick={() => navigate(marketRoute({ q }))} aria-label={`Retirer le rayon ${category}`}><Icon name={CATEGORY_DISPLAY[category].icon} size={18} /> {CATEGORY_DISPLAY[category].short} <Icon name="close" size={18} /></button>}
        </div>
      )}

      {!filtered && (
        <section className="section" aria-labelledby="market-rayons">
          <div className="section__head"><h2 id="market-rayons">Parcourir par rayon</h2></div>
          <CategoryGrid counts={counts} error={countsError} onRetry={() => void loadCounts()} onPick={pickCategory} />
        </section>
      )}

      <section className="section" aria-labelledby="market-results" aria-busy={loading}>
        <div className="section__head">
          <div>
            <h2 id="market-results">{heading}</h2>
            {!loading && !error && items.length > 0 && <p className="section__hint">{hint}</p>}
          </div>
          {!all && !loading && items.length > 0 && <button type="button" className="btn-link" onClick={() => navigate(marketRoute({ all: true }))}>Voir tout</button>}
        </div>

        {error ? (
          <Alert tone="error" title="Annonces indisponibles" action={<button type="button" className="btn btn--secondary btn--inline" onClick={() => void load()}><Icon name="refresh" size={20} /> Réessayer</button>}>{error}</Alert>
        ) : loading ? (
          <div className="listing-grid"><ListingSkeletons count={6} /></div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <strong>{filtered ? 'Aucun objet ne correspond.' : 'Aucune annonce pour le moment.'}</strong>
            <span>{filtered ? 'Essayez un autre mot ou un autre rayon.' : 'Les objets en vente apparaîtront ici dès leur publication.'}</span>
            {filtered && <button type="button" className="btn btn--secondary btn--inline" onClick={() => navigate(marketRoute({ all: true }))}>Voir tous les objets</button>}
          </div>
        ) : (
          <>
            <div className="listing-grid">{items.map(item => <ListingCard key={item.id} item={item} now={now} onOpen={() => onOpen(item)} />)}</div>
            {moreError && <p className="inline-error" role="status">{moreError}</p>}
            {hasMore && <button type="button" className="btn btn--secondary load-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Chargement…' : moreError ? 'Réessayer' : 'Voir plus d’objets'}</button>}
          </>
        )}
      </section>
    </Page>
  )
}

function ListingDetail({ id, entrySource }: { id: string; entrySource: EntrySource }) {
  const now = useNow()
  const [listing, setListing] = useState<Listing | null>(() => cachedListing(id))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      setListing(await fetchListing(id, entrySource))
    } catch (err) {
      setError(errorText(err, 'Cette annonce n’est plus disponible.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [id])

  const back = () => goBack(marketRoute())

  if (error && !listing) return (
    <Page>
      <TopBar onBack={back} />
      <Alert tone="error" title="Annonce indisponible" action={<button type="button" className="btn btn--primary btn--inline" onClick={() => navigate(marketRoute({ all: true }), { replace: true })}>Voir les autres objets</button>}>
        Elle a peut-être été vendue ou retirée par son vendeur.
      </Alert>
    </Page>
  )

  if (!listing) return (
    <Page>
      <TopBar onBack={back} />
      <div className="detail-photo skeleton" aria-hidden="true" />
      <p className="muted-line" role="status">Chargement de l’annonce…</p>
    </Page>
  )

  const sold = listing.sold_at !== null
  return (
    <Page className="detail">
      <TopBar onBack={back} />
      <div className={`detail-photo${loading ? ' is-refreshing' : ''}`}>
        <img src={listing.image_url} alt={listing.title} />
      </div>
      <div className="detail__price-row">
        <PriceTag price={listing.price_eur} size="lg" />
        <span className="category-label"><Icon name={CATEGORY_DISPLAY[listing.category].icon} size={20} /> {listing.category}</span>
      </div>
      <h1 className="detail__title">{listing.title}</h1>
      {sold ? (
        <Alert title="Cet objet a été vendu">Il n’est plus disponible sur son stand.</Alert>
      ) : (
        <div className="stand-destination">
          <span>Rendez-vous au</span>
          <StandBadge stand={listing.stand_number} size="xl" />
          {listing.seller_alias && <small>Vendeur : {listing.seller_alias}</small>}
        </div>
      )}
      <p className="detail__description">{listing.description}</p>
      {listing.fun_line && <p className="fun-line"><Icon name="sparkle" size={18} /> {listing.fun_line}</p>}
      <p className="muted-line"><Icon name="clock" size={18} /> Publiée {formatRelative(listing.created_at, now)}</p>
      {error && <p className="inline-error" role="status">{error}</p>}
    </Page>
  )
}

import { FormEvent, useEffect, useState } from 'react'
import { fetchLatestListings, fetchListingCategoryCounts, fetchSellerListings } from '../api'
import type { ListingCategory } from '../categories'
import { formatPrice, plural, useNow } from '../format'
import { rememberListings } from '../listingCache'
import type { SellerOnboarding } from '../sellerOnboarding'
import type { Listing, ListingCategoryCounts } from '../types'
import { CategoryGrid } from '../ui/CategoryGrid'
import { Icon } from '../ui/icons'
import type { IconName } from '../ui/icons'
import { ListingCard, ListingSkeletons } from '../ui/ListingCard'
import { Alert, Brand, EventLine, Page } from '../ui/Page'
import { StandBadge } from '../ui/Tags'

const HOME_LISTING_COUNT = 5

export type HomeActions = {
  search: (q: string) => void
  pickCategory: (category: ListingCategory) => void
  openMarket: (all: boolean) => void
  openListing: (item: Listing) => void
  openAssistant: () => void
  openFunLab: () => void
  openSeller: () => void
  addObjects: () => void
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message !== 'Une erreur est survenue.' ? err.message : fallback
}

// Seller home order: active listings first, then most viewed, then newest.
function sortSellerListings(items: Listing[]): Listing[] {
  return [...items].sort((a, b) =>
    Number(a.sold_at !== null) - Number(b.sold_at !== null)
    || (b.view_count ?? 0) - (a.view_count ?? 0)
    || b.created_at.localeCompare(a.created_at))
}

function FeatureCard({ image, title, text, cta, onClick, icon }: { image: string; title: string; text: string; cta: string; onClick: () => void; icon: IconName }) {
  return (
    <button type="button" className="feature-card" onClick={onClick}>
      <span className="feature-card__copy">
        <strong>{title}</strong>
        <span>{text}</span>
        <span className="feature-card__cta"><Icon name={icon} size={20} /> {cta}</span>
      </span>
      <img src={image} alt="" />
    </button>
  )
}

export default function Home({ onboarding, actions }: { onboarding: SellerOnboarding | null; actions: HomeActions }) {
  return onboarding ? <SellerHome stand={onboarding.stand} actions={actions} /> : <VisitorHome actions={actions} />
}

function VisitorHome({ actions }: { actions: HomeActions }) {
  const now = useNow()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Listing[] | null>(null)
  const [itemsError, setItemsError] = useState('')
  const [counts, setCounts] = useState<ListingCategoryCounts | null>(null)
  const [countsError, setCountsError] = useState('')

  async function loadItems() {
    setItemsError('')
    try {
      const rows = await fetchLatestListings(HOME_LISTING_COUNT)
      rememberListings(rows)
      setItems(rows)
    } catch (err) {
      setItemsError(errorText(err, 'Impossible d’afficher les dernières annonces.'))
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

  useEffect(() => {
    void loadItems()
    void loadCounts()
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    actions.search(query)
  }

  const empty = items !== null && items.length === 0 && !itemsError

  return (
    <Page className="home">
      <header className="home__head">
        <Brand size="lg" />
        <EventLine />
      </header>

      <form className="search-box" role="search" onSubmit={submit}>
        <label htmlFor="home-search" className="search-box__label">Que cherchez-vous ?</label>
        <div className="search-box__row">
          <Icon name="search" className="search-box__icon" />
          <input id="home-search" type="search" enterKeyHint="search" placeholder="lampe, vinyle, jouet…" value={query} onChange={e => setQuery(e.target.value)} />
          <button type="submit" className="btn btn--primary">Chercher</button>
        </div>
      </form>

      {empty ? (
        <Alert title="Les vendeurs installent leurs stands">Les premiers objets apparaîtront ici dès qu’ils seront en ligne.</Alert>
      ) : (
        <>
          <section className="section" aria-labelledby="home-rayons">
            <div className="section__head"><h2 id="home-rayons">Parcourir par rayon</h2></div>
            <CategoryGrid counts={counts} error={countsError} onRetry={() => void loadCounts()} onPick={actions.pickCategory} limit={5} onShowAll={() => actions.openMarket(false)} />
          </section>

          <section className="section" aria-labelledby="home-latest">
            <div className="section__head">
              <div>
                <h2 id="home-latest">Tout juste déballé</h2>
                <p className="section__hint">Les dernières annonces publiées, les plus récentes d’abord.</p>
              </div>
              <button type="button" className="btn-link" onClick={() => actions.openMarket(false)}>Voir tout</button>
            </div>
            {itemsError ? (
              <div className="inline-error" role="status"><span>{itemsError}</span><button type="button" className="btn-link" onClick={() => void loadItems()}>Réessayer</button></div>
            ) : (
              <div className="rail">
                {items === null ? <ListingSkeletons count={3} variant="rail" /> : items.map(item => <ListingCard key={item.id} item={item} now={now} variant="rail" onOpen={() => actions.openListing(item)} />)}
              </div>
            )}
          </section>
        </>
      )}

      <section className="section feature-stack" aria-label="Autres possibilités">
        <FeatureCard image="/images/home/vase.webp" icon="camera" title="Un objet vous plaît sur un stand ?" text="Photographiez-le : BrocAI l’identifie, estime son prix et vous aide à négocier." cta="Analyser un objet" onClick={actions.openAssistant} />
        <FeatureCard image="/images/home/frame.webp" icon="sparkle" title="FunLab, le jeu de la brocante" text="Votre objet prend vie : une photo, trois vœux, une carte souvenir à garder." cta="Jouer avec un objet" onClick={actions.openFunLab} />
      </section>

      <button type="button" className="seller-entry" onClick={actions.openSeller}>
        <Icon name="stand" />
        <span><strong>Vous vendez ?</strong> Mettez vos objets en ligne depuis votre stand.</span>
        <Icon name="chevron" />
      </button>
    </Page>
  )
}

function SellerHome({ stand, actions }: { stand: string; actions: HomeActions }) {
  const [items, setItems] = useState<Listing[] | null>(null)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    try {
      setItems(sortSellerListings(await fetchSellerListings(stand)).slice(0, HOME_LISTING_COUNT))
    } catch (err) {
      setError(errorText(err, 'Impossible de charger vos annonces.'))
    }
  }

  useEffect(() => { void load() }, [stand])

  return (
    <Page className="home">
      <header className="home__head home__head--seller">
        <div>
          <Brand size="lg" />
          <EventLine />
        </div>
        <button type="button" className="stand-chip" onClick={actions.openSeller} aria-label={`Ouvrir mon stand ${stand}`}>
          <StandBadge stand={stand} />
        </button>
      </header>

      <button type="button" className="hero-action" onClick={actions.addObjects}>
        <span className="hero-action__icon"><Icon name="camera" size={32} /></span>
        <span><strong>Ajouter des objets</strong><small>Photographiez-les à la suite, BrocAI prépare les annonces.</small></span>
      </button>

      <section className="section card-list" aria-labelledby="home-mine">
        <div className="section__head">
          <h2 id="home-mine">Mes annonces</h2>
          <button type="button" className="btn-link" onClick={actions.openSeller}>Gérer</button>
        </div>
        {error ? (
          <div className="inline-error" role="status"><span>{error}</span><button type="button" className="btn-link" onClick={() => void load()}>Réessayer</button></div>
        ) : items === null ? (
          <p className="muted-line">Chargement de vos annonces…</p>
        ) : items.length === 0 ? (
          <p className="muted-line">Aucune annonce pour l’instant. Commencez par « Ajouter des objets ».</p>
        ) : (
          <ul className="row-list">
            {items.map(item => {
              const sold = item.sold_at !== null
              return (
                <li key={item.id}>
                  <button type="button" className="row-item" onClick={actions.openSeller}>
                    <img src={item.image_url} alt="" loading="lazy" />
                    <span className="row-item__copy">
                      <strong>{item.title}</strong>
                      <span>{formatPrice(item.price_eur)} · <Icon name="eye" size={16} /> {plural(item.view_count ?? 0, 'vue')}</span>
                    </span>
                    <span className={`status-pill${sold ? ' status-pill--sold' : ''}`}>{sold ? 'Vendu' : 'En vente'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="section quick-links" aria-label="Autres possibilités">
        <button type="button" className="quick-link" onClick={() => actions.openMarket(false)}><Icon name="search" /><span>Voir les objets de la brocante</span><Icon name="chevron" /></button>
        <button type="button" className="quick-link" onClick={actions.openAssistant}><Icon name="scan" /><span>Analyser un objet</span><Icon name="chevron" /></button>
        <button type="button" className="quick-link" onClick={actions.openFunLab}><Icon name="sparkle" /><span>FunLab, le jeu de la brocante</span><Icon name="chevron" /></button>
      </section>
    </Page>
  )
}

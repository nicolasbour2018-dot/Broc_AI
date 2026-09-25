import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeAssistantPhoto, analyzeSellerPhoto, askAssistantQuestion, downloadSellerReport, fetchLatestListings, fetchListing, fetchListings, fetchSellerListings, publishListing, setListingSold, trackEvent, trackSessionStarted, updateListing } from './api'
import Admin from './Admin'
import Showroom from './Showroom'
import FunLab from './FunLab'
import { DEFAULT_CATEGORY, LISTING_CATEGORIES } from './categories'
import { clearSellerOnboarding, readSellerOnboarding, saveSellerOnboarding } from './sellerOnboarding'
import type { SellerOnboarding } from './sellerOnboarding'
import type { ListingCategory } from './categories'
import type { AiJobProgress, AssistantAnalysis, AssistantQuestionType, Listing, ListingDraft, ListingEditDraft, SellerAnalysis } from './types'

type View = 'welcome' | 'home' | 'seller' | 'market' | 'assistant' | 'admin' | 'showroom' | 'funlab'
type SellerMode = 'dashboard' | 'create' | 'edit'
type SellerEntry = 'dashboard' | 'create'
const APP_ONBOARDING_KEY = 'brocai-app-onboarding-v1'

function initialView(): View {
  if (window.location.pathname === '/admin') return 'admin'
  if (window.location.pathname === '/showroom') return 'showroom'
  if (window.location.pathname === '/fun') return 'funlab'
  if (window.location.pathname !== '/') return 'home'
  try {
    return localStorage.getItem(APP_ONBOARDING_KEY) === 'complete' ? 'home' : 'welcome'
  } catch {
    return 'welcome'
  }
}

function Welcome({ enter }: { enter: (view: 'market' | 'seller') => void }) {
  return (
    <main className="screen welcome" aria-labelledby="welcome-title">
      <span className="welcome-brand">Broc<span>AI</span></span>
      <div className="welcome-content">
        <p className="eyebrow">Bienvenue à la brocante</p>
        <h1 id="welcome-title">Chinez avec BrocAI</h1>
        <ul className="welcome-features">
          <li><strong>Découvrez les objets</strong><span>Parcourez les annonces de la brocante.</span></li>
          <li><strong>Retrouvez le stand</strong><span>Chaque objet indique où trouver le vendeur.</span></li>
          <li><strong>Analysez une photo</strong><span>Obtenez des repères sur un objet qui vous plaît.</span></li>
        </ul>
        <div className="welcome-actions">
          <button className="primary" type="button" onClick={() => enter('market')}>Voir les objets</button>
          <button className="welcome-seller" type="button" onClick={() => enter('seller')}>Je vends</button>
        </div>
      </div>
    </main>
  )
}

const EMPTY_DRAFT: ListingDraft = {
  image_key: '',
  title: '',
  description: '',
  fun_line: '',
  category: DEFAULT_CATEGORY,
  price_eur: '',
  stand_number: '',
  seller_alias: ''
}

const CONFIDENCE_LABELS: Record<SellerAnalysis['confidence'], string> = {
  low: 'faible',
  medium: 'moyenne',
  high: 'forte'
}

// French display price: "8 €" for whole euros, "8,50 €" otherwise (API sends decimal strings like "8.00").
const PRICE_FORMAT_WHOLE = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const PRICE_FORMAT_CENTS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

function formatPrice(value: string | number): string {
  const amount = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  if (!Number.isFinite(amount) || String(value).trim() === '') return `${value} €`
  return (Number.isInteger(amount) ? PRICE_FORMAT_WHOLE : PRICE_FORMAT_CENTS).format(amount)
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="screen-nav">
      <button className="back" onClick={onClick} type="button">← Accueil</button>
      <span className="screen-nav-brand" aria-label="BrocAI">BrocAI</span>
    </div>
  )
}

function queueMessage(progress: AiJobProgress | null, action = 'Analyse'): string {
  if (!progress) return `${action} en cours…`
  if (progress.status === 'queued') {
    const position = progress.queue_position && progress.queue_position > 0 ? `Position ${progress.queue_position} dans la file` : 'En attente'
    return `${position}${progress.wait_label ? ` · ${progress.wait_label}` : ''}`
  }
  if (progress.status === 'running') return `${action} en cours…`
  return `${action} terminée`
}

const HOME_ILLUSTRATIONS = {
  seller: '/images/home/lamp.webp',
  market: '/images/home/chair.webp',
  assistant: '/images/home/vase.webp'
} as const

function HomeIllustration({ kind }: { kind: keyof typeof HOME_ILLUSTRATIONS }) {
  return <img className={`journey-illustration ${kind}-illustration`} src={HOME_ILLUSTRATIONS[kind]} alt="" aria-hidden="true" />
}

function HomeJourneyCard({ kind, title, description, onClick, featured = false }: { kind: 'seller' | 'market' | 'assistant'; title: string; description: string; onClick: () => void; featured?: boolean }) {
  const icon = kind === 'seller'
    ? <svg viewBox="0 0 32 32" focusable="false"><path d="M12 4h12l5 5v12L17 31 2 16z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"/><circle cx="21" cy="10" r="1.8" fill="currentColor"/></svg>
    : kind === 'market'
      ? <svg viewBox="0 0 32 32" focusable="false"><circle cx="13.5" cy="13.5" r="9.5" fill="none" stroke="currentColor" strokeWidth="2.6"/><path d="m21 21 7 7" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"/></svg>
      : <svg viewBox="0 0 32 32" focusable="false"><rect x="5" y="19" width="5" height="9" rx="2.5" fill="currentColor" /><rect x="13.5" y="11" width="5" height="17" rx="2.5" fill="currentColor" /><rect x="22" y="4" width="5" height="24" rx="2.5" fill="currentColor" /></svg>

  return (
    <button className={`journey-card journey-${kind}${featured ? ' home-featured-card' : ''}`} type="button" onClick={onClick}>
      <span className="journey-icon" aria-hidden="true">{icon}</span>
      <span className="journey-copy"><strong>{title}</strong><small>{description}</small></span>
      <span className="journey-arrow" aria-hidden="true"><HomeChevron /></span>
      <HomeIllustration kind={kind} />
    </button>
  )
}

function HomeChevron() {
  return <svg className="home-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

const HOME_LISTING_COUNT = 5

function HomeStandIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M5 13h22v15H5zM3 12l3-8h20l3 8c0 2-2 3-4 2-2 1-4 1-5 0-2 1-4 1-5 0-2 1-4 1-5 0-2 1-4 0-4-2z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M12 19h8v9h-8z" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>
}

function HomeViewsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" fill="none" stroke="currentColor" strokeWidth="1.6"/><circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>
}

function formatViews(count: number): string {
  return `${count} ${count >= 2 ? 'vues' : 'vue'}`
}

// Seller home order: active listings first, then most viewed, then newest.
function sortSellerListings(items: Listing[]): Listing[] {
  return [...items].sort((a, b) =>
    Number(a.sold_at !== null) - Number(b.sold_at !== null)
    || (b.view_count ?? 0) - (a.view_count ?? 0)
    || b.created_at.localeCompare(a.created_at))
}

function HomeListingRow({ item, onOpen, showStatus }: { item: Listing; onOpen: () => void; showStatus: boolean }) {
  const sold = item.sold_at !== null
  const views = typeof item.view_count === 'number' ? formatViews(item.view_count) : null
  const label = `Ouvrir ${item.title}, ${formatPrice(item.price_eur)}, ${views ?? `stand ${item.stand_number}`}${showStatus ? `, ${sold ? 'vendu' : 'en ligne'}` : ''}`
  return (
    <button className={`home-listing-row ${showStatus ? '' : 'no-status'}`} type="button" onClick={onOpen} aria-label={label}>
      <img src={item.image_url} alt="" loading="lazy" />
      <span className="home-listing-copy"><strong>{item.title}</strong><b>{formatPrice(item.price_eur)}</b><span className="home-listing-stats">{views ? <><HomeViewsIcon /> {views}</> : <><HomeStandIcon /> Stand {item.stand_number}</>}</span></span>
      {showStatus && <span className={`home-listing-status ${sold ? 'is-sold' : ''}`}>{sold ? 'Vendu' : 'En ligne'}</span>}
      <span className="home-listing-chevron" aria-hidden="true"><HomeChevron /></span>
    </button>
  )
}

function Home({ navigate, openSeller, openListing }: { navigate: (view: View) => void; openSeller: (entry: SellerEntry) => void; openListing: (item: Listing) => void }) {
  // Only a confirmed onboarding makes this device a seller; everyone else gets the visitor home.
  const [onboarding] = useState(readSellerOnboarding)
  const sellerStand = onboarding?.stand ?? ''
  const [items, setItems] = useState<Listing[]>([])
  const [loadingListings, setLoadingListings] = useState(true)
  const [listingsError, setListingsError] = useState('')

  async function loadItems() {
    setLoadingListings(true)
    setListingsError('')
    try {
      setItems(sellerStand ? sortSellerListings(await fetchSellerListings(sellerStand)).slice(0, HOME_LISTING_COUNT) : await fetchLatestListings(HOME_LISTING_COUNT))
    } catch (err) {
      setListingsError(err instanceof Error ? err.message : 'Impossible de charger les annonces.')
    } finally {
      setLoadingListings(false)
    }
  }

  useEffect(() => { void loadItems() }, [sellerStand])

  const title = sellerStand ? 'Mes annonces' : 'Dernières annonces'
  // An empty visitor list would be a hollow block on the home: hide it until the first listing exists.
  const hideListings = !sellerStand && !loadingListings && !listingsError && items.length === 0

  return (
    <main className="screen home">
      <header className="home-hero home-header">
        <div className="brand-lockup" aria-label="BrocAI, la brocante plus intelligente">
          <strong><span>Broc</span><span>AI</span><svg className="brand-sparkle" viewBox="0 0 36 36" aria-hidden="true" focusable="false"><path d="M18 0c2.5 10 6 13.5 18 18-12 4.5-15.5 8-18 18C15.5 26 12 22.5 0 18 12 13.5 15.5 10 18 0Z" fill="currentColor" /><path d="M7 1c1.1 4.4 2.6 5.9 7 8-4.4 1.6-5.9 2.9-7 7-1.1-4.1-2.6-5.4-7-7 4.4-2.1 5.9-3.6 7-8Z" fill="currentColor" transform="translate(21 20) scale(.65)" /></svg></strong>
          <small>La brocante, plus intelligente</small>
        </div>
        {sellerStand && (
          <button className="stand-entry" type="button" onClick={() => openSeller('dashboard')} aria-label={`Ouvrir le stand ${sellerStand}`}>
            <HomeStandIcon />
            <span>Stand {sellerStand}</span>
          </button>
        )}
      </header>

      <section className="journey-section" aria-label={sellerStand ? 'Gérer mon stand' : 'Découvrir la brocante'}>
        <div className="journey-grid home-primary-grid">
          {sellerStand
            ? <HomeJourneyCard kind="seller" title="Ajouter un objet" description="Photographiez et publiez depuis votre stand" onClick={() => openSeller('create')} featured />
            : <HomeJourneyCard kind="market" title="Voir les objets" description="Trouvez un objet et retrouvez son stand" onClick={() => navigate('market')} featured />}
        </div>
      </section>

      {!hideListings && (
        <section className="home-listings" aria-labelledby="home-listings-title" aria-live="polite">
          <div className="home-listings-heading">
            <div><svg className="home-listings-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false"><path d="M7 3.5h10l5 5V24H7z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M17 4v5h5M10 14h9M10 18h9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg><h2 id="home-listings-title">{title}</h2></div>
            <button type="button" onClick={sellerStand ? () => openSeller('dashboard') : () => navigate('market')} aria-label={sellerStand ? 'Voir toutes mes annonces' : 'Voir toutes les annonces'}>Voir tout <HomeChevron /></button>
          </div>
          {loadingListings ? (
            <p className="home-listings-state">Chargement des annonces…</p>
          ) : listingsError ? (
            <div className="home-listings-error"><span>{listingsError}</span><button type="button" onClick={() => void loadItems()}>Réessayer</button></div>
          ) : items.length === 0 ? (
            <button className="home-listings-empty" type="button" onClick={() => openSeller('create')}>Aucune annonce pour le moment. Ajoutez votre premier objet <HomeChevron /></button>
          ) : (
            <div className="home-listing-list">
              {items.map(item => <HomeListingRow key={item.id} item={item} showStatus={Boolean(sellerStand)} onOpen={sellerStand ? () => openSeller('dashboard') : () => openListing(item)} />)}
            </div>
          )}
        </section>
      )}

      <section className="journey-section home-followup" aria-label="Autres parcours BrocAI">
        <div className={`journey-grid home-followup-grid${sellerStand ? '' : ' single'}`}>
          {sellerStand && <HomeJourneyCard kind="market" title="Voir les objets" description="Explorez les annonces de la brocante" onClick={() => navigate('market')} />}
          <HomeJourneyCard kind="assistant" title="J’analyse" description="Comparer, estimer et mieux négocier" onClick={() => navigate('assistant')} />
        </div>
        <div className="home-secondary-actions">
          <button type="button" onClick={() => { window.history.pushState({}, '', '/fun'); navigate('funlab') }}>FunLab <HomeChevron /></button>
          {!sellerStand && <button type="button" onClick={() => openSeller('dashboard')}>Je vends <HomeChevron /></button>}
        </div>
      </section>
    </main>
  )
}

type OnboardingStep = 'details' | 'guide' | 'confirm'

function trackOnboarding(action: string) {
  void trackEvent('feature_clicked', { feature: 'seller_onboarding', action })
}

const ONBOARDING_GUIDE = [
  {
    title: 'Photographiez l’objet',
    text: 'Depuis votre téléphone, directement sur votre stand.',
    icon: <svg viewBox="0 0 32 32" focusable="false"><path d="M4 11.5A2.5 2.5 0 0 1 6.5 9h3.2l2-3h8.6l2 3h3.2a2.5 2.5 0 0 1 2.5 2.5v13A2.5 2.5 0 0 1 25.5 27h-19A2.5 2.5 0 0 1 4 24.5z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/><circle cx="16" cy="17.5" r="5" fill="none" stroke="currentColor" strokeWidth="2.2"/></svg>
  },
  {
    title: 'BrocAI prépare l’annonce',
    text: 'Titre, description et prix suggérés : vous gardez la main sur tout.',
    icon: <svg viewBox="0 0 32 32" focusable="false"><path d="M16 2c2.4 8.2 5.8 11.6 14 14-8.2 2.4-11.6 5.8-14 14C13.6 21.8 10.2 18.4 2 16 10.2 13.6 13.6 10.2 16 2z" fill="currentColor"/></svg>
  },
  {
    title: 'Publiez, puis marquez vendu',
    text: 'L’objet apparaît sur le marché BrocAI ; un geste suffit quand il part.',
    icon: <svg viewBox="0 0 32 32" focusable="false"><path d="m6 16.5 6.5 6.5L26 9.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
  }
]

// Seller onboarding: stand number and optional alias, a one-screen guide, `Valider`, then an explicit
// confirmation of the stand number. Only the confirmation stores the onboarding on this device.
function SellerOnboardingFlow({ goHome, onConfirmed }: { goHome: () => void; onConfirmed: (value: SellerOnboarding) => void }) {
  const [step, setStep] = useState<OnboardingStep>('details')
  const [stand, setStand] = useState('')
  const [alias, setAlias] = useState('')

  function submitDetails(e: FormEvent) {
    e.preventDefault()
    if (!stand.trim()) return
    setStand(stand.trim())
    trackOnboarding('details_submitted')
    setStep('guide')
  }

  function validate() {
    trackOnboarding('validated')
    setStep('confirm')
  }

  function changeNumber() {
    trackOnboarding('number_changed')
    setStep('details')
  }

  function confirm() {
    trackOnboarding('confirmed')
    onConfirmed(saveSellerOnboarding(stand, alias))
  }

  if (step === 'guide') return (
    <main className="screen onboarding"><BackButton onClick={goHome} />
      <p className="eyebrow">Ouverture du stand · 2 sur 3</p><h2>Comment ça marche</h2>
      <ol className="onboarding-guide">
        {ONBOARDING_GUIDE.map(item => (
          <li key={item.title}>
            <span className="onboarding-guide-icon" aria-hidden="true">{item.icon}</span>
            <span><strong>{item.title}</strong><small>{item.text}</small></span>
          </li>
        ))}
      </ol>
      <button className="primary" type="button" onClick={validate}>Valider</button>
      <button className="text-action onboarding-back" type="button" onClick={() => setStep('details')}>← Modifier le stand ou le pseudo</button>
    </main>
  )

  if (step === 'confirm') return (
    <main className="screen onboarding"><BackButton onClick={goHome} />
      <p className="eyebrow">Ouverture du stand · 3 sur 3</p><h2>Confirmez votre stand</h2>
      <div className="onboarding-confirm">
        <span>Numéro de stand</span>
        <strong>Stand {stand}</strong>
        {alias.trim() && <small>Pseudo : {alias.trim()}</small>}
      </div>
      <p className="lead small">Vérifiez le numéro affiché sur votre emplacement : ce téléphone gérera ce stand et ses annonces.</p>
      <button className="primary" type="button" onClick={confirm}>Confirmer le stand {stand}</button>
      <button className="secondary" type="button" onClick={changeNumber}>Changer de numéro</button>
    </main>
  )

  return (
    <main className="screen onboarding"><BackButton onClick={goHome} />
      <p className="eyebrow">Ouverture du stand · 1 sur 3</p><h2>Commencez par votre stand</h2>
      <p className="lead small">Indiquez le numéro de votre emplacement pour publier vos objets et les retrouver ensuite.</p>
      <form className="form-stack stand-login" onSubmit={submitDetails}>
        <label>Numéro de stand<input autoFocus required maxLength={40} inputMode="text" placeholder="Ex. 42" value={stand} onChange={e => setStand(e.target.value)} /></label>
        <label><span>Pseudo vendeur <span className="muted">(facultatif)</span></span><input maxLength={80} placeholder="Ex. Chez Martine" value={alias} onChange={e => setAlias(e.target.value)} /><small>Affiché sur vos annonces ; modifiable pour chaque objet.</small></label>
        <button className="primary" type="submit">Continuer</button>
      </form>
      <p className="seller-access-note">Pas de compte à créer : le numéro de stand sert d’accès rapide à l’espace vendeur.</p>
    </main>
  )
}

function Seller({ goHome, openMarket, entry }: { goHome: () => void; openMarket: () => void; entry: SellerEntry }) {
  const [onboarding, setOnboarding] = useState(readSellerOnboarding)
  const standNumber = onboarding?.stand ?? ''
  const sellerAlias = onboarding?.alias ?? ''
  const [confirmingStandChange, setConfirmingStandChange] = useState(false)
  const [sellerMode, setSellerMode] = useState<SellerMode>(entry)
  const [sellerItems, setSellerItems] = useState<Listing[]>([])
  const [analysis, setAnalysis] = useState<SellerAnalysis | null>(null)
  const [draft, setDraft] = useState<ListingDraft>(EMPTY_DRAFT)
  const [editing, setEditing] = useState<Listing | null>(null)
  const [editDraft, setEditDraft] = useState<ListingEditDraft | null>(null)
  const [preview, setPreview] = useState(false)
  const [published, setPublished] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(false)
  const [reportLoading, setReportLoading] = useState(false)
  const [aiProgress, setAiProgress] = useState<AiJobProgress | null>(null)
  const [error, setError] = useState('')

  async function loadSellerItems(stand: string) {
    setLoading(true); setError('')
    try {
      setSellerItems(await fetchSellerListings(stand))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les annonces du stand.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (standNumber) void loadSellerItems(standNumber)
  }, [standNumber])

  // Restarts the full onboarding; the stand's listings stay published.
  function changeStand() {
    trackOnboarding('stand_reset')
    clearSellerOnboarding()
    setOnboarding(null)
    setConfirmingStandChange(false)
    setSellerItems([])
    setAnalysis(null)
    setEditing(null)
    setEditDraft(null)
    setPublished(null)
    setPreview(false)
    setAiProgress(null)
    setSellerMode('dashboard')
  }

  function startCreate() {
    setAnalysis(null)
    setEditing(null)
    setEditDraft(null)
    setPublished(null)
    setPreview(false)
    setError('')
    setAiProgress(null)
    setDraft({ ...EMPTY_DRAFT, stand_number: standNumber, seller_alias: sellerAlias })
    setSellerMode('create')
  }

  function startEdit(item: Listing) {
    setError('')
    setEditing(item)
    setEditDraft({
      stand_number: standNumber,
      title: item.title,
      description: item.description,
      fun_line: item.fun_line || '',
      category: item.category,
      price_eur: item.price_eur,
      seller_alias: item.seller_alias || ''
    })
    setSellerMode('edit')
  }

  async function backToDashboard() {
    setAnalysis(null)
    setEditing(null)
    setEditDraft(null)
    setPublished(null)
    setPreview(false)
    setAiProgress(null)
    setSellerMode('dashboard')
    await loadSellerItems(standNumber)
  }

  async function choosePhoto(file?: File) {
    if (!file) return
    setLoading(true); setError(''); setAiProgress(null)
    try {
      const result = await analyzeSellerPhoto(file, setAiProgress)
      setAnalysis(result)
      setDraft({
        image_key: result.image_key,
        title: result.title,
        description: result.description,
        fun_line: result.fun_line || '',
        category: result.category,
        price_eur: String(result.suggested_price_eur),
        stand_number: standNumber,
        seller_alias: sellerAlias
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analyse impossible.')
    } finally {
      setLoading(false)
      setAiProgress(null)
    }
  }

  async function publish() {
    setLoading(true); setError('')
    try {
      setPublished(await publishListing({ ...draft, stand_number: standNumber }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publication impossible.')
    } finally {
      setLoading(false)
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing || !editDraft) return
    setLoading(true); setError('')
    try {
      await updateListing(editing.id, { ...editDraft, stand_number: standNumber })
      await backToDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Modification impossible.')
      setLoading(false)
    }
  }

  async function toggleSold(item: Listing) {
    setLoading(true); setError('')
    try {
      await setListingSold(item.id, standNumber, item.sold_at === null)
      await loadSellerItems(standNumber)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mise à jour impossible.')
      setLoading(false)
    }
  }

  async function exportSellerReport() {
    setReportLoading(true); setError('')
    try {
      await downloadSellerReport(standNumber)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export PDF impossible.')
    } finally {
      setReportLoading(false)
    }
  }

  if (!standNumber) return <SellerOnboardingFlow goHome={goHome} onConfirmed={setOnboarding} />

  if (published) return (
    <main className="screen"><button className="back" onClick={() => void backToDashboard()}>← Mes annonces</button>
      <div className="success-mark">✓</div><h2>Annonce publiée</h2>
      <p className="muted">Elle est maintenant visible sur le marché BrocAI tant qu’elle n’est pas marquée comme vendue.</p>
      <article className="listing-card featured"><img src={published.image_url} alt="" /><div><span className="pill">Stand {published.stand_number}</span><h3>{published.title}</h3><strong>{formatPrice(published.price_eur)}</strong>{published.fun_line && <p className="fun-line final-fun-line">✦ {published.fun_line}</p>}</div></article>
      <button className="primary" onClick={() => void backToDashboard()}>Voir mes annonces</button>
      <button className="secondary" onClick={openMarket}>Voir le marché BrocAI</button>
    </main>
  )

  if (sellerMode === 'dashboard') return (
    <main className="screen wide"><BackButton onClick={goHome} />
      <div className="seller-heading"><div><p className="eyebrow">Je vends un objet</p><h2>Stand {standNumber}</h2></div>{!confirmingStandChange && <button className="text-action" type="button" onClick={() => setConfirmingStandChange(true)}>Changer de stand</button>}</div>
      {confirmingStandChange && (
        <div className="stand-change-confirm" role="group" aria-label="Changer de stand">
          <p><strong>Changer de stand ?</strong> Ce téléphone ne gérera plus le stand {standNumber}. Ses annonces restent publiées.</p>
          <div><button className="secondary compact" type="button" onClick={changeStand}>Changer de stand</button><button className="text-action" type="button" onClick={() => setConfirmingStandChange(false)}>Annuler</button></div>
        </div>
      )}
      <button className="primary" type="button" onClick={startCreate}>＋ Ajouter un objet</button>
      <div className="seller-section-title"><h3>Mes annonces</h3><span>{sellerItems.filter(item => item.sold_at === null).length} en vente · {sellerItems.filter(item => item.sold_at !== null).length} vendue(s)</span></div>
      {error && <p className="error">{error}</p>}
      {loading ? <p className="muted">Chargement…</p> : sellerItems.length === 0 ? <div className="empty"><strong>Aucune annonce sur ce stand.</strong><span>Ajoutez votre premier objet pour le faire apparaître sur le marché BrocAI.</span></div> :
        <div className="seller-list">{sellerItems.map(item => {
          const sold = item.sold_at !== null
          return <article key={item.id} className={`seller-listing ${sold ? 'is-sold' : ''}`}>
            <img src={item.image_url} alt="" />
            <div className="seller-listing-body">
              <div className="seller-listing-top"><span className={`pill ${sold ? 'pill-sold' : ''}`}>{sold ? 'Vendu' : 'En vente'}</span><strong>{formatPrice(item.price_eur)}</strong></div>
              <h3>{item.title}</h3><p>{item.description}</p>
              <div className="seller-actions">
                <button className="secondary compact edit-button" disabled={loading} type="button" onClick={() => startEdit(item)}>Modifier</button>
                <button className={sold ? 'secondary compact' : 'sold-button'} disabled={loading} type="button" onClick={() => void toggleSold(item)}>{sold ? 'Remettre en vente' : '✓ Marquer comme vendu'}</button>
              </div>
            </div>
          </article>
        })}</div>}
      <section className="seller-report-card">
        <div><span className="eyebrow">Fin de journée</span><h3>Mon bilan vendeur</h3><p>Ventes, chiffre d’affaires déclaré, taux de vente, vues et récapitulatif des objets vendus.</p></div>
        <button className="secondary" disabled={reportLoading} type="button" onClick={() => void exportSellerReport()}>{reportLoading ? 'Création du PDF…' : '↓ Clôturer ma journée · PDF'}</button>
      </section>
      <button className="secondary" type="button" onClick={openMarket}>Voir le marché BrocAI</button>
    </main>
  )

  if (sellerMode === 'edit' && editing && editDraft) return (
    <main className="screen"><button className="back" onClick={() => void backToDashboard()}>← Mes annonces</button>
      <p className="eyebrow">Stand {standNumber} · Modification</p><h2>Modifier l’annonce</h2>
      <div className="preview-photo edit-photo"><img src={editing.image_url} alt={editing.title} /></div>
      <form className="form-stack" onSubmit={saveEdit}>
        <label>Titre<input required value={editDraft.title} onChange={e => setEditDraft({ ...editDraft, title: e.target.value })} /></label>
        <label>Description<textarea required rows={4} value={editDraft.description} onChange={e => setEditDraft({ ...editDraft, description: e.target.value })} /></label>
        <label>Petite phrase sympa <span className="muted">(facultatif)</span><input maxLength={180} value={editDraft.fun_line} onChange={e => setEditDraft({ ...editDraft, fun_line: e.target.value })} /></label>
        <label>Catégorie<select value={editDraft.category} onChange={e => setEditDraft({ ...editDraft, category: e.target.value as ListingCategory })}>{LISTING_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
        <label>Prix (€)<input required min="0" step="0.5" inputMode="decimal" type="number" value={editDraft.price_eur} onChange={e => setEditDraft({ ...editDraft, price_eur: e.target.value })} /></label>
        <label><span>Pseudo vendeur <span className="muted">(facultatif)</span></span><input value={editDraft.seller_alias} onChange={e => setEditDraft({ ...editDraft, seller_alias: e.target.value })} /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={loading} type="submit">{loading ? 'Enregistrement…' : 'Enregistrer les modifications'}</button>
        <button className="secondary" disabled={loading} type="button" onClick={() => void backToDashboard()}>Annuler</button>
      </form>
    </main>
  )

  if (preview && analysis) return (
    <main className="screen"><button className="back" onClick={() => setPreview(false)}>← Modifier</button><p className="eyebrow">Aperçu avant publication</p><h2>{draft.title}</h2>
      <div className="preview-photo"><img src={`/media/${draft.image_key}`} alt="Objet à vendre" /></div>
      <div className="price-row"><strong>{formatPrice(draft.price_eur)}</strong><span className="pill">Stand {standNumber}</span></div>
      <p>{draft.description}</p>{draft.fun_line && <p className="fun-line final-fun-line">✦ {draft.fun_line}</p>}{draft.category && <p className="muted">{draft.category}</p>}
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={loading} onClick={publish}>{loading ? 'Publication…' : 'Publier l’annonce'}</button>
      <button className="secondary" onClick={() => setPreview(false)}>Modifier</button>
    </main>
  )

  if (analysis) return (
    <main className="screen"><button className="back" onClick={() => setSellerMode('dashboard')}>← Mes annonces</button><p className="eyebrow">Brouillon éditable</p><h2>Vérifiez avant de publier</h2>
      <div className="stand-summary"><span>Publication sur</span><strong>Stand {standNumber}</strong></div>
      {analysis.analysis_mode === 'mock-fallback' ? <div className="notice"><strong>Analyse assistée indisponible pour cette photo.</strong><span> Un brouillon de secours a été préparé : vérifiez simplement les informations avant de publier.</span></div> : <div className="analysis-meta"><span>Analyse assistée</span><strong>Confiance {CONFIDENCE_LABELS[analysis.confidence]}</strong></div>}
      {analysis.fun_line && analysis.analysis_mode !== 'mock-fallback' && <p className="fun-line">✦ {analysis.fun_line}</p>}
      <form onSubmit={(e) => { e.preventDefault(); setPreview(true) }} className="form-stack">
        <label>Titre<input required value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>Description<textarea required rows={4} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <label>Petite phrase sympa <span className="muted">(facultatif)</span><input maxLength={180} value={draft.fun_line} onChange={e => setDraft({ ...draft, fun_line: e.target.value })} /></label>
        <label>Catégorie<select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value as ListingCategory })}>{LISTING_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
        <label>Prix final (€)<input required min="0" step="0.5" inputMode="decimal" type="number" value={draft.price_eur} onChange={e => setDraft({ ...draft, price_eur: e.target.value })} /><small>Suggestion initiale : {analysis.suggested_price_eur} € · fourchette {analysis.price_range_eur.min}–{analysis.price_range_eur.max} €</small></label>
        <label><span>Pseudo vendeur <span className="muted">(facultatif)</span></span><input value={draft.seller_alias} onChange={e => setDraft({ ...draft, seller_alias: e.target.value })} /></label>
        <button className="primary" type="submit">Prévisualiser l’annonce</button>
      </form>
    </main>
  )

  return (
    <main className="screen"><button className="back" onClick={() => setSellerMode('dashboard')}>← Mes annonces</button><p className="eyebrow">Je vends · Stand {standNumber}</p><h2>Photographiez votre objet</h2><p className="lead small">Une photo suffit pour préparer le brouillon de l’annonce.</p>
      <label className="photo-drop"><span>📷</span><strong>{loading ? queueMessage(aiProgress) : 'Prendre une photo'}</strong><small>ou choisir une image dans la galerie</small><input disabled={loading} type="file" accept="image/*" capture="environment" onChange={e => choosePhoto(e.target.files?.[0])} /></label>
      {loading && <div className="notice ai-queue-notice"><strong>{queueMessage(aiProgress)}</strong><span>Le marché BrocAI reste accessible pendant l’attente.</span>{aiProgress?.status === 'queued' && aiProgress.queue_size > 0 && <small>{aiProgress.queue_size} demande{aiProgress.queue_size > 1 ? 's' : ''} actuellement en attente.</small>}</div>}
      {error && <p className="error">{error}</p>}
      <button className="secondary" onClick={openMarket}>Voir le marché BrocAI</button>
    </main>
  )
}

function Market({ goHome, initialListing }: { goHome: () => void; initialListing: Listing | null }) {
  const [items, setItems] = useState<Listing[]>([])
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [category, setCategory] = useState<ListingCategory | ''>('')
  const [selected, setSelected] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')

  async function load(q = '', selectedCategory: ListingCategory | '' = category) {
    setLoading(true)
    setError('')
    try {
      const rows = await fetchListings(q, selectedCategory || undefined)
      setItems(selectedCategory ? rows.filter(item => item.category === selectedCategory) : rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Catalogue indisponible.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    if (initialListing) void openListing(initialListing)
  }, [])

  async function openListing(item: Listing) {
    setSelected(item)
    setDetailLoading(true)
    setDetailError('')
    try {
      setSelected(await fetchListing(item.id))
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Cette annonce n’est plus disponible.')
    } finally {
      setDetailLoading(false)
    }
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    const cleaned = query.trim()
    setAppliedQuery(cleaned)
    void load(cleaned, category)
  }

  function clearFilters() {
    setQuery('')
    setAppliedQuery('')
    setCategory('')
    void load('', '')
  }

  function changeCategory(value: ListingCategory | '') {
    setCategory(value)
    void load(appliedQuery, value)
  }

  function closeDetail() {
    setSelected(null)
    setDetailError('')
  }

  if (selected) return (
    <main className="screen">
      <button className="back" onClick={closeDetail}>← Tous les objets</button>
      {detailError ? (
        <div className="market-detail-error">
          <div className="notice"><strong>Annonce indisponible</strong><br />{detailError}</div>
          <button className="primary" type="button" onClick={() => { closeDetail(); void load(appliedQuery, category) }}>Actualiser le marché</button>
        </div>
      ) : (
        <>
          <div className={`detail-photo ${detailLoading ? 'is-loading' : ''}`}><img src={selected.image_url} alt={selected.title} /></div>
          <div className="stand-destination"><span>Retrouvez cet objet au</span><strong>Stand {selected.stand_number}</strong></div>
          {selected.category && <div className="market-detail-meta"><span className="category-label">{selected.category}</span></div>}
          <h2>{selected.title}</h2>
          <div className="detail-price">{formatPrice(selected.price_eur)}</div>
          <p className="market-description">{selected.description}</p>
          {selected.fun_line && <p className="fun-line market-fun-line">✦ {selected.fun_line}</p>}
          {selected.seller_alias && <p className="muted">Vendeur · {selected.seller_alias}</p>}
          {detailLoading && <p className="muted market-loading-note">Mise à jour de l’annonce…</p>}
        </>
      )}
    </main>
  )

  return (
    <main className="screen wide">
      <BackButton onClick={goHome} />
      <p className="eyebrow">Marché BrocAI · Chineur</p>
      <h2>Je cherche un objet</h2>
      <p className="lead small">Repérez un objet ici, puis retrouvez-le au stand indiqué.</p>

      <form className="search" onSubmit={submitSearch}>
        <input aria-label="Rechercher dans le marché BrocAI" placeholder="vinyle, lampe, jouet…" value={query} onChange={e => setQuery(e.target.value)} />
        <button type="submit" disabled={loading}>{loading ? 'Recherche…' : 'Rechercher'}</button>
      </form>

      <label className="category-filter">
        <span>Catégorie</span>
        <select aria-label="Filtrer par catégorie" value={category} onChange={e => changeCategory(e.target.value as ListingCategory | '')}>
          <option value="">Toutes les catégories</option>
          {LISTING_CATEGORIES.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>

      <div className="market-toolbar">
        <span>{loading ? 'Mise à jour…' : `${items.length} objet${items.length > 1 ? 's' : ''}${appliedQuery || category ? ' trouvé' + (items.length > 1 ? 's' : '') : ' en vente'}`}</span>
        {(appliedQuery || category) && <button className="text-action" type="button" onClick={clearFilters}>Effacer les filtres</button>}
      </div>

      {error && <div className="market-error"><p className="error">{error}</p><button className="secondary" type="button" onClick={() => void load(appliedQuery, category)}>Réessayer</button></div>}

      {!error && (loading ? (
        <div className="market-loading" aria-live="polite"><span className="market-spinner" /><span>Chargement des objets…</span></div>
      ) : items.length === 0 ? (
        <div className="empty">
          <strong>{appliedQuery || category ? 'Aucun objet ne correspond à ces filtres.' : 'Aucune annonce pour le moment.'}</strong>
          <span>{appliedQuery || category ? 'Essayez un autre mot-clé, une autre catégorie ou affichez de nouveau tout le marché.' : 'Les objets en vente apparaîtront ici.'}</span>
          {(appliedQuery || category) && <button className="secondary empty-action" type="button" onClick={clearFilters}>Voir toutes les annonces</button>}
        </div>
      ) : (
        <div className="listing-grid">{items.map(item => (
          <button key={item.id} type="button" className="listing-card" onClick={() => void openListing(item)} aria-label={`Voir ${item.title}, ${formatPrice(item.price_eur)}, stand ${item.stand_number}`}>
            <img src={item.image_url} alt={item.title} loading="lazy" />
            <div className="market-listing-info">
              <div className="market-listing-stand"><span>À retrouver au</span><strong>Stand {item.stand_number}</strong></div>
              <h3>{item.title}</h3>
              <div className="market-listing-bottom"><strong>{formatPrice(item.price_eur)}</strong>{item.category && <span className="category-label compact-category">{item.category}</span>}</div>
            </div>
          </button>
        ))}</div>
      ))}
    </main>
  )
}

function Assistant({ goHome }: { goHome: () => void }) {
  const [analysis, setAnalysis] = useState<AssistantAnalysis | null>(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [displayedPrice, setDisplayedPrice] = useState('')
  const [freeQuestion, setFreeQuestion] = useState('')
  const [answers, setAnswers] = useState<{ label: string; answer: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [aiProgress, setAiProgress] = useState<AiJobProgress | null>(null)
  const [error, setError] = useState('')

  function resetObject() {
    if (photoUrl) URL.revokeObjectURL(photoUrl)
    setAnalysis(null)
    setPhotoUrl('')
    setDisplayedPrice('')
    setFreeQuestion('')
    setAnswers([])
    setAiProgress(null)
    setError('')
  }

  async function choosePhoto(file?: File) {
    if (!file) return
    if (photoUrl) URL.revokeObjectURL(photoUrl)
    setPhotoUrl(URL.createObjectURL(file))
    setAnalysis(null)
    setAnswers([])
    setError('')
    setAiProgress(null)
    setLoading(true)
    try {
      setAnalysis(await analyzeAssistantPhoto(file, setAiProgress))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analyse impossible.')
    } finally {
      setLoading(false)
      setAiProgress(null)
    }
  }

  async function ask(type: AssistantQuestionType, label: string, question?: string) {
    if (!analysis || analysis.questions_remaining <= 0 || loading) return
    setLoading(true)
    setAiProgress(null)
    setError('')
    const price = displayedPrice.trim() ? Number(displayedPrice) : undefined
    try {
      const result = await askAssistantQuestion(analysis.scan_id, type, question, price, setAiProgress)
      setAnswers(current => [...current, { label, answer: result.answer }])
      setAnalysis({ ...analysis, questions_remaining: result.questions_remaining })
      if (type === 'free') setFreeQuestion('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Réponse impossible.')
    } finally {
      setLoading(false)
      setAiProgress(null)
    }
  }

  function submitFreeQuestion(e: FormEvent) {
    e.preventDefault()
    const cleaned = freeQuestion.trim()
    if (!cleaned) return
    void ask('free', cleaned, cleaned)
  }

  if (!analysis) return (
    <main className="screen">
      <BackButton onClick={goHome} />
      <p className="eyebrow">J’analyse un objet</p>
      <h2>Photographie l’objet</h2>
      <p className="lead small">BrocAI l’identifie, vous donne quelques repères utiles, puis vous permet de poser trois questions.</p>
      <label className="photo-drop">
        <span>✦</span>
        <strong>{loading ? queueMessage(aiProgress) : 'Prendre une photo'}</strong>
        <small>ou choisir une image dans la galerie</small>
        <input disabled={loading} type="file" accept="image/*" capture="environment" onChange={e => choosePhoto(e.target.files?.[0])} />
      </label>
      {photoUrl && loading && <div className="assistant-photo-preview"><img src={photoUrl} alt="Objet en cours d’analyse" /></div>}
      {loading && <div className="notice ai-queue-notice"><strong>{queueMessage(aiProgress)}</strong><span>La photo temporaire est supprimée du serveur dès que la fiche est créée.</span>{aiProgress?.status === 'queued' && aiProgress.queue_size > 0 && <small>{aiProgress.queue_size} demande{aiProgress.queue_size > 1 ? 's' : ''} en attente.</small>}</div>}
      {error && <p className="error">{error}</p>}
    </main>
  )

  const confidenceLabel = CONFIDENCE_LABELS[analysis.confidence]
  const priceLabel = analysis.price_range_eur
    ? `${analysis.price_range_eur.min}–${analysis.price_range_eur.max} €`
    : analysis.estimated_price_eur !== null ? `environ ${formatPrice(analysis.estimated_price_eur)}` : 'non estimé'

  return (
    <main className="screen assistant-screen">
      <button className="back" onClick={resetObject}>← Analyser un autre objet</button>
      <p className="eyebrow">Analyse d’objet</p>
      {photoUrl && <div className="detail-photo assistant-photo"><img src={photoUrl} alt={analysis.name} /></div>}
      <div className="assistant-meta"><span className="pill">{analysis.category}</span><span>Confiance {confidenceLabel}</span></div>
      <h2>{analysis.name}</h2>
      <p className="market-description">{analysis.description}</p>
      <div className="assistant-facts">
        <div><span>Repère de prix</span><strong>{priceLabel}</strong></div>
        <div><span>Contexte</span><strong>{analysis.context_note}</strong></div>
      </div>
      <p className="assistant-caution">⚠ {analysis.caution}</p>

      <section className="assistant-wishes">
        <div className="assistant-section-heading">
          <div><p className="eyebrow">Vos 3 questions</p><h3>{analysis.questions_remaining} restante{analysis.questions_remaining > 1 ? 's' : ''}</h3></div>
          <span className="wish-counter">{3 - analysis.questions_remaining}/3</span>
        </div>

        {analysis.questions_remaining > 0 ? (
          <>
            <label className="displayed-price">Prix affiché sur le stand <span className="muted">(facultatif)</span><input min="0" step="0.5" inputMode="decimal" type="number" placeholder="Ex. 20" value={displayedPrice} onChange={e => setDisplayedPrice(e.target.value)} /></label>
            <div className="wish-grid">
              <button disabled={loading} type="button" onClick={() => void ask('good_deal', 'Est-ce une bonne affaire ?')}>💶 <strong>Bonne affaire ?</strong><span>Comparer avec le prix affiché</span></button>
              <button disabled={loading} type="button" onClick={() => void ask('tell_more', 'Raconte-m’en plus')}>📚 <strong>Raconte-m’en plus</strong><span>Contexte, style, époque possible</span></button>
              <button disabled={loading} type="button" onClick={() => void ask('negotiate', 'Négocie pour moi')}>🤝 <strong>Négocie pour moi</strong><span>Une proposition courte et sympa</span></button>
            </div>
            <form className="assistant-free-question" onSubmit={submitFreeQuestion}>
              <label>Ou posez votre propre question<textarea disabled={loading} maxLength={240} rows={2} placeholder="Ex. Comment reconnaître si c’est une reproduction ?" value={freeQuestion} onChange={e => setFreeQuestion(e.target.value)} /></label>
              <button className="secondary" disabled={loading || !freeQuestion.trim()} type="submit">{loading ? 'Réponse…' : 'Envoyer ma question'}</button>
            </form>
          </>
        ) : (
          <div className="empty assistant-limit"><strong>Vos trois questions sont utilisées.</strong><span>Vous pouvez photographier un autre objet pour repartir avec trois nouvelles questions.</span><button className="primary empty-action" type="button" onClick={resetObject}>Analyser un autre objet</button></div>
        )}

        {loading && aiProgress && <div className="notice ai-queue-notice compact-queue"><strong>{queueMessage(aiProgress, 'Réponse')}</strong>{aiProgress.status === 'queued' && <span>Vous pouvez rester sur cette fiche pendant l’attente.</span>}</div>}
        {error && <p className="error">{error}</p>}
        {answers.length > 0 && <div className="assistant-answers">{answers.map((item, index) => <article key={`${item.label}-${index}`}><span>Question {index + 1}</span><h4>{item.label}</h4><p>{item.answer}</p></article>)}</div>}
      </section>
    </main>
  )
}

export default function App() {
  const [view, setView] = useState<View>(initialView)
  const [sellerEntry, setSellerEntry] = useState<SellerEntry>('dashboard')
  // Listing tapped on the home: the market opens directly on its detail.
  const [marketEntry, setMarketEntry] = useState<Listing | null>(null)
  const previousView = useRef<View | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)

  function enterFromWelcome(next: 'market' | 'seller') {
    try {
      localStorage.setItem(APP_ONBOARDING_KEY, 'complete')
    } catch {
      setView(next)
      return
    }
    setView(next)
  }

  // Mirror the view background onto <html> and the browser chrome so the legacy beige base
  // never shows through overscroll or safe areas. Views without their own background are left alone.
  useEffect(() => {
    const root = document.documentElement
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const background = shellRef.current ? getComputedStyle(shellRef.current).backgroundColor : ''
    const hasOwnBackground = background !== '' && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)'
    root.style.backgroundColor = hasOwnBackground ? background : ''
    document.body.style.background = hasOwnBackground ? background : ''
    if (meta) meta.content = hasOwnBackground ? background : '#ffffff'
  }, [view])

  useEffect(() => {
    if (view === 'admin') return
    const previous = previousView.current
    previousView.current = view
    void (async () => {
      await trackSessionStarted()
      await trackEvent('nav_opened', { screen: view, previous_screen: previous })
    })()
  }, [view])

  const content = useMemo(() => {
    if (view === 'welcome') return <Welcome enter={enterFromWelcome} />
    if (view === 'admin') return <Admin goHome={() => { window.history.replaceState({}, '', '/'); setView('home') }} />
    if (view === 'showroom') return <Showroom exitShowroom={() => { window.history.replaceState({}, '', '/'); setView('home') }} />
    if (view === 'funlab') return <FunLab goHome={() => { window.history.replaceState({}, '', '/'); setView('home') }} />
    if (view === 'seller') return <Seller goHome={() => setView('home')} openMarket={() => setView('market')} entry={sellerEntry} />
    if (view === 'market') return <Market goHome={() => setView('home')} initialListing={marketEntry} />
    if (view === 'assistant') return <Assistant goHome={() => setView('home')} />
    return <Home navigate={next => { setMarketEntry(null); setView(next) }} openSeller={entry => { setSellerEntry(entry); setView('seller') }} openListing={item => { setMarketEntry(item); setView('market') }} />
  }, [view, marketEntry, sellerEntry])
  const showProductFooter = view !== 'welcome' && view !== 'home' && view !== 'admin' && view !== 'showroom'

  return (
    <div className={`app-shell view-${view}`} ref={shellRef}>
      {content}
      {showProductFooter && (
        <footer className="product-footer">
          <strong>BrocAI</strong>
          <span>Une expérience Gaia Vector Studio</span>
        </footer>
      )}
    </div>
  )
}

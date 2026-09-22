import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeAssistantPhoto, analyzeSellerPhoto, askAssistantQuestion, downloadSellerReport, fetchListing, fetchListings, fetchSellerListings, publishListing, setListingSold, trackEvent, trackSessionStarted, updateListing } from './api'
import Admin from './Admin'
import Showroom from './Showroom'
import FunLab from './FunLab'
import { DEFAULT_CATEGORY, LISTING_CATEGORIES } from './categories'
import type { ListingCategory } from './categories'
import type { AiJobProgress, AssistantAnalysis, AssistantQuestionType, Listing, ListingDraft, ListingEditDraft, SellerAnalysis } from './types'

type View = 'home' | 'seller' | 'market' | 'assistant' | 'admin' | 'showroom' | 'funlab'
type SellerMode = 'dashboard' | 'create' | 'edit'

const SELLER_STAND_KEY = 'brocai-seller-stand'

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

function HomeIllustration({ kind }: { kind: 'seller' | 'market' | 'assistant' | 'fun' }) {
  if (kind === 'seller') return (
    <svg className="journey-illustration seller-illustration" viewBox="0 0 180 180" aria-hidden="true" focusable="false">
      <path d="M30 109c14-19 25-8 34-26s21-17 29-2 13 10 20-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".35" />
      <path d="M44 119c8-8 13-15 17-25M72 99l-4-14m24 1 4-15m6 31 12-10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".28" />
      <path d="M111 58h42l8 50h-58z" fill="currentColor" opacity=".09" stroke="currentColor" strokeWidth="2" />
      <path d="M107 59h50v7h-50zm4 51h42v5h-42zm17 6v18m-9 0h18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".5" />
      <path d="M126 139h12l7 8h-26z" fill="currentColor" opacity=".22" stroke="currentColor" strokeWidth="2" />
      <path d="m133 128 3 5-6 3" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".4" />
    </svg>
  )

  if (kind === 'market') return (
    <svg className="journey-illustration market-illustration" viewBox="0 0 180 180" aria-hidden="true" focusable="false">
      <path d="M89 27c-18 0-32 14-32 32 0 8 3 16 9 22l-9 27h64l-9-27c6-6 9-14 9-22 0-18-14-32-32-32z" fill="currentColor" opacity=".08" stroke="currentColor" strokeWidth="2" />
      <path d="M73 59c0-9 7-16 16-16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".5" />
      <path d="M61 104h56m-49 0-5 10v6h52v-6l-5-10m-47 16-4 42m52-42 4 42m-39-42v42m23-42v42M61 142h56" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".48" />
      <path d="M56 120h66" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".18" />
      <path d="M139 48h13m-7-7v14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".35" />
    </svg>
  )

  if (kind === 'assistant') return (
    <svg className="journey-illustration assistant-illustration" viewBox="0 0 180 180" aria-hidden="true" focusable="false">
      <path d="M88 76c-10 5-20 1-25-7-6 10 0 22 12 23 11 1 18-7 13-16zm26-10c-9 8-19 7-27 0-2 12 7 21 19 18 10-3 14-13 8-18zm-41 31c-5 11 0 21 11 22 11 1 18-6 15-16-9 4-19 1-26-6zm34 3c3 11 12 16 22 10 10-6 10-17 3-23-5 9-14 13-25 13z" fill="currentColor" opacity=".12" stroke="currentColor" strokeWidth="1.5" />
      <path d="M94 73c-2 20 1 42 9 63m-12-41-18-12m28 13 17-14m-21 31-20 12m24-9 18 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".42" />
      <path d="M81 130h40l-5 8H86zm8 10h24v8H89zm3 10h18v7H92z" fill="currentColor" opacity=".09" stroke="currentColor" strokeWidth="1.5" />
      <path d="m137 39 3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="currentColor" opacity=".3" />
    </svg>
  )

  return (
    <svg className="journey-illustration fun-illustration" viewBox="0 0 180 180" aria-hidden="true" focusable="false">
      <path d="M47 45h86v101H47z" fill="currentColor" opacity=".07" stroke="currentColor" strokeWidth="3" />
      <path d="M57 55h66v81H57z" fill="none" stroke="currentColor" strokeWidth="2" opacity=".42" />
      <path d="M40 40h100v111H40z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 5" opacity=".28" />
      <path d="M45 61c8 0 8-10 16-10m75 0c0 8 9 8 9 16m-97 66c8 0 8 10 16 10m75 0c0-8 9-8 9-16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".5" />
      <path d="m34 31 2 6 6 2-6 2-2 6-2-6-6-2 6-2zm111 78 2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="currentColor" opacity=".38" />
      <path d="m79 86 4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z" fill="currentColor" opacity=".48" />
    </svg>
  )
}

function Home({ navigate }: { navigate: (view: View) => void }) {
  const [rememberedStand, setRememberedStand] = useState(() => localStorage.getItem(SELLER_STAND_KEY)?.trim() || '')
  const [sellerItems, setSellerItems] = useState<Listing[]>([])
  const [loadingListings, setLoadingListings] = useState(false)
  const [listingsError, setListingsError] = useState('')

  async function loadSellerItems(stand: string) {
    setLoadingListings(true)
    setListingsError('')
    try {
      setSellerItems(await fetchSellerListings(stand))
    } catch (err) {
      setListingsError(err instanceof Error ? err.message : 'Impossible de charger vos annonces.')
    } finally {
      setLoadingListings(false)
    }
  }

  useEffect(() => {
    if (rememberedStand) void loadSellerItems(rememberedStand)
  }, [rememberedStand])

  function openSeller() {
    navigate('seller')
  }

  return (
    <main className="screen home">
      <header className="home-hero home-header">
        <div className="brand-lockup" aria-label="BrocAI, la brocante plus intelligente">
          <strong><span>Broc</span><span>AI</span><i aria-hidden="true">✦</i></strong>
          <small>La brocante, plus intelligente</small>
        </div>
        <button className="stand-entry" type="button" onClick={openSeller} aria-label={rememberedStand ? `Ouvrir le stand ${rememberedStand}` : 'Ouvrir mon stand'}>
          <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M5 13h22v15H5zM3 12l3-8h20l3 8c0 2-2 3-4 2-2 1-4 1-5 0-2 1-4 1-5 0-2 1-4 1-5 0-2 1-4 0-4-2z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M12 19h8v9h-8z" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>
          <span>{rememberedStand ? `Stand ${rememberedStand}` : 'Mon stand'}</span>
        </button>
      </header>

      <section className="journey-section" aria-label="Parcours BrocAI">
        <div className="journey-grid">
          <button className="journey-card journey-seller" type="button" onClick={openSeller}>
            <span className="journey-icon" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><path d="M12 4h12l5 5v12L17 31 2 16z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"/><circle cx="21" cy="10" r="1.8" fill="currentColor"/></svg></span>
            <span className="journey-copy"><strong>Je vends</strong><small>Déposer une annonce et estimer un prix</small></span>
            <span className="journey-arrow" aria-hidden="true">›</span>
            <HomeIllustration kind="seller" />
          </button>
          <button className="journey-card journey-market" type="button" onClick={() => navigate('market')}>
            <span className="journey-icon" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><circle cx="13.5" cy="13.5" r="9.5" fill="none" stroke="currentColor" strokeWidth="2.6"/><path d="m21 21 7 7" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"/></svg></span>
            <span className="journey-copy"><strong>Je recherche</strong><small>Voir les bonnes affaires autour de vous</small></span>
            <span className="journey-arrow" aria-hidden="true">›</span>
            <HomeIllustration kind="market" />
          </button>
          <button className="journey-card journey-assistant" type="button" onClick={() => navigate('assistant')}>
            <span className="journey-icon" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><path d="M16 3v26M3 16h26M7 7l18 18m0-18L7 25" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"/></svg></span>
            <span className="journey-copy"><strong>J’analyse</strong><small>Comparer, estimer et mieux négocier</small></span>
            <span className="journey-arrow" aria-hidden="true">›</span>
            <HomeIllustration kind="assistant" />
          </button>
          <button className="journey-card journey-fun" type="button" onClick={() => { window.history.pushState({}, '', '/fun'); navigate('funlab') }}>
            <span className="journey-icon" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><path d="M16 2c2.4 8.2 5.8 11.6 14 14-8.2 2.4-11.6 5.8-14 14C13.6 21.8 10.2 18.4 2 16 10.2 13.6 13.6 10.2 16 2z" fill="currentColor"/></svg></span>
            <span className="journey-copy"><strong>FunLab</strong><small>Créer des visuels fun à partir de vos photos</small></span>
            <span className="journey-arrow" aria-hidden="true">›</span>
            <HomeIllustration kind="fun" />
          </button>
        </div>
      </section>

      <section className="home-listings" aria-labelledby="home-listings-title" aria-live="polite">
        <div className="home-listings-heading">
          <div><span className="home-listings-icon" aria-hidden="true">▤</span><h2 id="home-listings-title">Mes annonces</h2></div>
          <button type="button" onClick={openSeller} aria-label="Voir toutes mes annonces">Voir tout <span aria-hidden="true">›</span></button>
        </div>
        {!rememberedStand ? (
          <button className="home-listings-empty" type="button" onClick={openSeller}>Accédez à votre stand pour retrouver vos annonces <span aria-hidden="true">›</span></button>
        ) : loadingListings ? (
          <p className="home-listings-state">Chargement de vos annonces…</p>
        ) : listingsError ? (
          <div className="home-listings-error"><span>{listingsError}</span><button type="button" onClick={() => void loadSellerItems(rememberedStand)}>Réessayer</button></div>
        ) : sellerItems.length === 0 ? (
          <button className="home-listings-empty" type="button" onClick={openSeller}>Aucune annonce pour le moment. Ajoutez votre premier objet <span aria-hidden="true">›</span></button>
        ) : (
          <div className="home-listing-list">
            {sellerItems.slice(0, 2).map(item => {
              const sold = item.sold_at !== null
              return <button className="home-listing-row" key={item.id} type="button" onClick={openSeller} aria-label={`Ouvrir ${item.title}, ${item.price_eur} euros, ${sold ? 'vendu' : 'en ligne'}`}>
                <img src={item.image_url} alt="" loading="lazy" />
                <span className="home-listing-copy"><strong>{item.title}</strong><b>{item.price_eur} €</b><span className="home-listing-stats"><span aria-hidden="true">◎</span> Stand {item.stand_number}</span></span>
                <span className={`home-listing-status ${sold ? 'is-sold' : ''}`}>{sold ? 'Vendu' : 'En ligne'}</span>
                <span className="home-listing-chevron" aria-hidden="true">›</span>
              </button>
            })}
          </div>
        )}
      </section>
    </main>
  )
}

function Seller({ goHome, openMarket }: { goHome: () => void; openMarket: () => void }) {
  const [standInput, setStandInput] = useState(() => localStorage.getItem(SELLER_STAND_KEY) || '')
  const [standNumber, setStandNumber] = useState(() => localStorage.getItem(SELLER_STAND_KEY) || '')
  const [sellerMode, setSellerMode] = useState<SellerMode>('dashboard')
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

  async function enterStand(e: FormEvent) {
    e.preventDefault()
    const cleaned = standInput.trim()
    if (!cleaned) return
    localStorage.setItem(SELLER_STAND_KEY, cleaned)
    setStandNumber(cleaned)
    setSellerMode('dashboard')
  }

  function changeStand() {
    setStandNumber('')
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
    setDraft({ ...EMPTY_DRAFT, stand_number: standNumber })
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
        seller_alias: ''
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

  if (!standNumber) return (
    <main className="screen"><BackButton onClick={goHome} />
      <p className="eyebrow">Je vends un objet</p><h2>Commencez par votre stand</h2>
      <p className="lead small">Entrez votre numéro de stand pour publier un objet ou retrouver les annonces déjà créées.</p>
      <form className="stand-login" onSubmit={enterStand}>
        <label>Numéro de stand<input autoFocus required maxLength={40} inputMode="text" placeholder="Ex. 42" value={standInput} onChange={e => setStandInput(e.target.value)} /></label>
        <button className="primary" disabled={loading} type="submit">{loading ? 'Ouverture…' : 'Accéder à mon stand'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="seller-access-note">Pas de compte à créer : pour ce MVP, le numéro de stand sert d’accès rapide à l’espace vendeur.</p>
    </main>
  )

  if (published) return (
    <main className="screen"><button className="back" onClick={() => void backToDashboard()}>← Mes annonces</button>
      <div className="success-mark">✓</div><h2>Annonce publiée</h2>
      <p className="muted">Elle est maintenant visible sur le marché BrocAI tant qu’elle n’est pas marquée comme vendue.</p>
      <article className="listing-card featured"><img src={published.image_url} alt="" /><div><span className="pill">Stand {published.stand_number}</span><h3>{published.title}</h3><strong>{published.price_eur} €</strong>{published.fun_line && <p className="fun-line final-fun-line">✦ {published.fun_line}</p>}</div></article>
      <button className="primary" onClick={() => void backToDashboard()}>Voir mes annonces</button>
      <button className="secondary" onClick={openMarket}>Voir le marché BrocAI</button>
    </main>
  )

  if (sellerMode === 'dashboard') return (
    <main className="screen wide"><BackButton onClick={goHome} />
      <div className="seller-heading"><div><p className="eyebrow">Je vends un objet</p><h2>Stand {standNumber}</h2></div><button className="text-action" type="button" onClick={changeStand}>Changer</button></div>
      <button className="primary" type="button" onClick={startCreate}>＋ Ajouter un objet</button>
      <div className="seller-section-title"><h3>Mes annonces</h3><span>{sellerItems.filter(item => item.sold_at === null).length} en vente · {sellerItems.filter(item => item.sold_at !== null).length} vendue(s)</span></div>
      {error && <p className="error">{error}</p>}
      {loading ? <p className="muted">Chargement…</p> : sellerItems.length === 0 ? <div className="empty"><strong>Aucune annonce sur ce stand.</strong><span>Ajoutez votre premier objet pour le faire apparaître sur le marché BrocAI.</span></div> :
        <div className="seller-list">{sellerItems.map(item => {
          const sold = item.sold_at !== null
          return <article key={item.id} className={`seller-listing ${sold ? 'is-sold' : ''}`}>
            <img src={item.image_url} alt="" />
            <div className="seller-listing-body">
              <div className="seller-listing-top"><span className={`pill ${sold ? 'pill-sold' : ''}`}>{sold ? 'Vendu' : 'En vente'}</span><strong>{item.price_eur} €</strong></div>
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
        <label>Pseudo vendeur <span className="muted">(facultatif)</span><input value={editDraft.seller_alias} onChange={e => setEditDraft({ ...editDraft, seller_alias: e.target.value })} /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={loading} type="submit">{loading ? 'Enregistrement…' : 'Enregistrer les modifications'}</button>
        <button className="secondary" disabled={loading} type="button" onClick={() => void backToDashboard()}>Annuler</button>
      </form>
    </main>
  )

  if (preview && analysis) return (
    <main className="screen"><button className="back" onClick={() => setPreview(false)}>← Modifier</button><p className="eyebrow">Aperçu avant publication</p><h2>{draft.title}</h2>
      <div className="preview-photo"><img src={`/media/${draft.image_key}`} alt="Objet à vendre" /></div>
      <div className="price-row"><strong>{draft.price_eur} €</strong><span className="pill">Stand {standNumber}</span></div>
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
        <label>Pseudo vendeur <span className="muted">(facultatif)</span><input value={draft.seller_alias} onChange={e => setDraft({ ...draft, seller_alias: e.target.value })} /></label>
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

function Market({ goHome }: { goHome: () => void }) {
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

  useEffect(() => { void load() }, [])

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
      <button className="back" onClick={closeDetail}>← Annonces</button>
      {detailError ? (
        <div className="market-detail-error">
          <div className="notice"><strong>Annonce indisponible</strong><br />{detailError}</div>
          <button className="primary" type="button" onClick={() => { closeDetail(); void load(appliedQuery, category) }}>Actualiser le marché</button>
        </div>
      ) : (
        <>
          <div className={`detail-photo ${detailLoading ? 'is-loading' : ''}`}><img src={selected.image_url} alt={selected.title} /></div>
          <div className="market-detail-meta">
            <span className="pill">Stand {selected.stand_number}</span>
            {selected.category && <span className="category-label">{selected.category}</span>}
          </div>
          <h2>{selected.title}</h2>
          <div className="detail-price">{selected.price_eur} €</div>
          <p className="market-description">{selected.description}</p>
          {selected.fun_line && <p className="fun-line market-fun-line">✦ {selected.fun_line}</p>}
          {selected.seller_alias && <p className="muted">Vendeur · {selected.seller_alias}</p>}
          <div className="stand-destination"><span>Pour voir cet objet</span><strong>Rendez-vous au stand {selected.stand_number}</strong></div>
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
      <p className="lead small">Explorez les objets encore disponibles. Ouvrez une annonce pour voir son prix et retrouver immédiatement son stand.</p>

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
          <button key={item.id} type="button" className="listing-card" onClick={() => void openListing(item)} aria-label={`Voir ${item.title}, ${item.price_eur} euros, stand ${item.stand_number}`}>
            <img src={item.image_url} alt={item.title} loading="lazy" />
            <div>
              <div className="listing-card-meta"><span className="pill">Stand {item.stand_number}</span>{item.category && <span className="category-label compact-category">{item.category}</span>}</div>
              <h3>{item.title}</h3>
              <strong>{item.price_eur} €</strong>
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
    : analysis.estimated_price_eur !== null ? `environ ${analysis.estimated_price_eur} €` : 'non estimé'

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
  const [view, setView] = useState<View>(
    window.location.pathname === '/admin'
      ? 'admin'
      : window.location.pathname === '/showroom' ? 'showroom' : window.location.pathname === '/fun' ? 'funlab' : 'home'
  )
  const previousView = useRef<View | null>(null)

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
    if (view === 'admin') return <Admin goHome={() => { window.history.replaceState({}, '', '/'); setView('home') }} />
    if (view === 'showroom') return <Showroom exitShowroom={() => { window.history.replaceState({}, '', '/'); setView('home') }} />
    if (view === 'funlab') return <FunLab goHome={() => { window.history.replaceState({}, '', '/'); setView('home') }} />
    if (view === 'seller') return <Seller goHome={() => setView('home')} openMarket={() => setView('market')} />
    if (view === 'market') return <Market goHome={() => setView('home')} />
    if (view === 'assistant') return <Assistant goHome={() => setView('home')} />
    return <Home navigate={setView} />
  }, [view])
  const showProductFooter = view !== 'home' && view !== 'admin' && view !== 'showroom'

  return (
    <div className={`app-shell view-${view}`}>
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

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeAssistantPhoto, analyzeSellerPhoto, askAssistantQuestion, fetchListing, fetchListings, fetchSellerListings, publishListing, setListingSold, trackEvent, trackSessionStarted, updateListing } from './api'
import Admin from './Admin'
import { DEFAULT_CATEGORY, LISTING_CATEGORIES } from './categories'
import type { ListingCategory } from './categories'
import type { AiJobProgress, AssistantAnalysis, AssistantQuestionType, Listing, ListingDraft, ListingEditDraft, SellerAnalysis } from './types'

type View = 'home' | 'seller' | 'market' | 'assistant' | 'admin'
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
  return <button className="back" onClick={onClick} type="button">← Accueil</button>
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

function Home({ navigate }: { navigate: (view: View) => void }) {
  return (
    <main className="screen home">
      <p className="eyebrow">Brocante Saint‑Fiacre · Épernon</p>
      <h1>BrocAI</h1>
      <p className="lead">Une photo, un stand, et la brocante devient plus simple.</p>
      <div className="journey-grid">
        <button className="journey-card" onClick={() => navigate('seller')}>
          <span className="journey-icon">＋</span><strong>Je vends</strong><small>Créer et gérer les annonces de mon stand</small>
        </button>
        <button className="journey-card" onClick={() => navigate('market')}>
          <span className="journey-icon">⌕</span><strong>Je cherche</strong><small>Voir les objets et trouver leur stand</small>
        </button>
        <button className="journey-card" onClick={() => navigate('assistant')}>
          <span className="journey-icon">✦</span><strong>J’analyse</strong><small>Photographier un objet pour en savoir plus</small>
        </button>
      </div>
    </main>
  )
}

function Seller({ goHome, openMarket }: { goHome: () => void; openMarket: () => void }) {
  const rememberedStand = localStorage.getItem(SELLER_STAND_KEY) || ''
  const [standInput, setStandInput] = useState(rememberedStand)
  const [standNumber, setStandNumber] = useState('')
  const [sellerMode, setSellerMode] = useState<SellerMode>('dashboard')
  const [sellerItems, setSellerItems] = useState<Listing[]>([])
  const [analysis, setAnalysis] = useState<SellerAnalysis | null>(null)
  const [draft, setDraft] = useState<ListingDraft>(EMPTY_DRAFT)
  const [editing, setEditing] = useState<Listing | null>(null)
  const [editDraft, setEditDraft] = useState<ListingEditDraft | null>(null)
  const [preview, setPreview] = useState(false)
  const [published, setPublished] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(false)
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

  async function enterStand(e: FormEvent) {
    e.preventDefault()
    const cleaned = standInput.trim()
    if (!cleaned) return
    localStorage.setItem(SELLER_STAND_KEY, cleaned)
    setStandNumber(cleaned)
    setSellerMode('dashboard')
    await loadSellerItems(cleaned)
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

  if (!standNumber) return (
    <main className="screen"><BackButton onClick={goHome} />
      <p className="eyebrow">Espace vendeur</p><h2>Quel est ton stand ?</h2>
      <p className="lead small">Entre simplement ton numéro de stand pour créer une annonce ou retrouver celles déjà publiées.</p>
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
      <p className="muted">Elle est maintenant visible dans le mini‑marché tant qu’elle n’est pas marquée comme vendue.</p>
      <article className="listing-card featured"><img src={published.image_url} alt="" /><div><span className="pill">Stand {published.stand_number}</span><h3>{published.title}</h3><strong>{published.price_eur} €</strong>{published.fun_line && <p className="fun-line final-fun-line">✦ {published.fun_line}</p>}</div></article>
      <button className="primary" onClick={() => void backToDashboard()}>Voir mes annonces</button>
      <button className="secondary" onClick={openMarket}>Voir le mini‑marché</button>
    </main>
  )

  if (sellerMode === 'dashboard') return (
    <main className="screen wide"><BackButton onClick={goHome} />
      <div className="seller-heading"><div><p className="eyebrow">Espace vendeur</p><h2>Stand {standNumber}</h2></div><button className="text-action" type="button" onClick={changeStand}>Changer</button></div>
      <button className="primary" type="button" onClick={startCreate}>＋ Ajouter un objet</button>
      <div className="seller-section-title"><h3>Mes annonces</h3><span>{sellerItems.filter(item => item.sold_at === null).length} en vente · {sellerItems.filter(item => item.sold_at !== null).length} vendue(s)</span></div>
      {error && <p className="error">{error}</p>}
      {loading ? <p className="muted">Chargement…</p> : sellerItems.length === 0 ? <div className="empty"><strong>Aucune annonce sur ce stand.</strong><span>Ajoute ton premier objet pour le faire apparaître dans le mini‑marché.</span></div> :
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
      <button className="secondary" type="button" onClick={openMarket}>Voir le mini‑marché</button>
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
    <main className="screen"><button className="back" onClick={() => setSellerMode('dashboard')}>← Mes annonces</button><p className="eyebrow">Brouillon éditable</p><h2>Vérifie avant de publier</h2>
      <div className="stand-summary"><span>Publication sur</span><strong>Stand {standNumber}</strong></div>
      {analysis.analysis_mode === 'mock-fallback' ? <div className="notice">Mode développement : ce brouillon est simulé. Passe <code>AI_PROVIDER=gemini</code> pour activer l’analyse réelle.</div> : <div className="analysis-meta"><span>Analyse IA</span><strong>Confiance {CONFIDENCE_LABELS[analysis.confidence]}</strong></div>}
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
    <main className="screen"><button className="back" onClick={() => setSellerMode('dashboard')}>← Mes annonces</button><p className="eyebrow">Stand {standNumber} · Nouvelle annonce</p><h2>Photographie ton objet</h2><p className="lead small">Une photo suffit pour préparer le brouillon de l’annonce.</p>
      <label className="photo-drop"><span>📷</span><strong>{loading ? queueMessage(aiProgress) : 'Prendre une photo'}</strong><small>ou choisir une image dans la galerie</small><input disabled={loading} type="file" accept="image/*" capture="environment" onChange={e => choosePhoto(e.target.files?.[0])} /></label>
      {loading && <div className="notice ai-queue-notice"><strong>{queueMessage(aiProgress)}</strong><span>Le mini‑marché reste accessible pendant l’attente.</span>{aiProgress?.status === 'queued' && aiProgress.queue_size > 0 && <small>{aiProgress.queue_size} demande{aiProgress.queue_size > 1 ? 's' : ''} actuellement en attente.</small>}</div>}
      {error && <p className="error">{error}</p>}
      <button className="secondary" onClick={openMarket}>Voir le mini‑marché</button>
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
      <p className="eyebrow">Mini‑marché</p>
      <h2>Qu’est-ce que tu cherches ?</h2>
      <p className="lead small">Les objets affichés ici sont encore disponibles. Ouvre une annonce pour connaître immédiatement son stand.</p>

      <form className="search" onSubmit={submitSearch}>
        <input aria-label="Rechercher dans le mini-marché" placeholder="vinyle, lampe, jouet…" value={query} onChange={e => setQuery(e.target.value)} />
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
          <span>{appliedQuery || category ? 'Essaie un autre mot-clé, une autre catégorie ou affiche de nouveau tout le marché.' : 'Les objets en vente apparaîtront ici.'}</span>
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
      <p className="eyebrow">J’analyse</p>
      <h2>Photographie un objet</h2>
      <p className="lead small">BrocAI te donne une fiche courte, puis tu disposes de trois questions sur cet objet.</p>
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
      <p className="eyebrow">Assistant photo</p>
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
          <div><p className="eyebrow">Tes 3 questions</p><h3>{analysis.questions_remaining} restante{analysis.questions_remaining > 1 ? 's' : ''}</h3></div>
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
              <label>Ou pose ta propre question<textarea disabled={loading} maxLength={240} rows={2} placeholder="Ex. Comment reconnaître si c’est une reproduction ?" value={freeQuestion} onChange={e => setFreeQuestion(e.target.value)} /></label>
              <button className="secondary" disabled={loading || !freeQuestion.trim()} type="submit">{loading ? 'Réponse…' : 'Envoyer ma question'}</button>
            </form>
          </>
        ) : (
          <div className="empty assistant-limit"><strong>Tes trois questions sont utilisées.</strong><span>Tu peux photographier un autre objet pour repartir avec trois nouvelles questions.</span><button className="primary empty-action" type="button" onClick={resetObject}>Analyser un autre objet</button></div>
        )}

        {loading && aiProgress && <div className="notice ai-queue-notice compact-queue"><strong>{queueMessage(aiProgress, 'Réponse')}</strong>{aiProgress.status === 'queued' && <span>Tu peux rester sur cette fiche pendant l’attente.</span>}</div>}
        {error && <p className="error">{error}</p>}
        {answers.length > 0 && <div className="assistant-answers">{answers.map((item, index) => <article key={`${item.label}-${index}`}><span>Question {index + 1}</span><h4>{item.label}</h4><p>{item.answer}</p></article>)}</div>}
      </section>
    </main>
  )
}

export default function App() {
  const [view, setView] = useState<View>(window.location.pathname === '/admin' ? 'admin' : 'home')
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
    if (view === 'seller') return <Seller goHome={() => setView('home')} openMarket={() => setView('market')} />
    if (view === 'market') return <Market goHome={() => setView('home')} />
    if (view === 'assistant') return <Assistant goHome={() => setView('home')} />
    return <Home navigate={setView} />
  }, [view])
  return <div className="app-shell">{content}</div>
}

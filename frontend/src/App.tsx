import { FormEvent, useEffect, useMemo, useState } from 'react'
import { analyzeSellerPhoto, fetchListings, fetchSellerListings, publishListing, setListingSold, updateListing } from './api'
import type { Listing, ListingDraft, ListingEditDraft, SellerAnalysis } from './types'

type View = 'home' | 'seller' | 'market' | 'assistant'
type SellerMode = 'dashboard' | 'create' | 'edit'

const SELLER_STAND_KEY = 'brocai-seller-stand'

const EMPTY_DRAFT: ListingDraft = {
  image_key: '',
  title: '',
  description: '',
  category: '',
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
    setSellerMode('dashboard')
  }

  function startCreate() {
    setAnalysis(null)
    setEditing(null)
    setEditDraft(null)
    setPublished(null)
    setPreview(false)
    setError('')
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
      category: item.category || '',
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
    setSellerMode('dashboard')
    await loadSellerItems(standNumber)
  }

  async function choosePhoto(file?: File) {
    if (!file) return
    setLoading(true); setError('')
    try {
      const result = await analyzeSellerPhoto(file)
      setAnalysis(result)
      setDraft({
        image_key: result.image_key,
        title: result.title,
        description: result.description,
        category: result.category || '',
        price_eur: String(result.suggested_price_eur),
        stand_number: standNumber,
        seller_alias: ''
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analyse impossible.')
    } finally {
      setLoading(false)
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
      <article className="listing-card featured"><img src={published.image_url} alt="" /><div><span className="pill">Stand {published.stand_number}</span><h3>{published.title}</h3><strong>{published.price_eur} €</strong></div></article>
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
        <label>Catégorie<input value={editDraft.category} onChange={e => setEditDraft({ ...editDraft, category: e.target.value })} /></label>
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
      <p>{draft.description}</p>{draft.category && <p className="muted">{draft.category}</p>}
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
        <label>Catégorie<input value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label>
        <label>Prix final (€)<input required min="0" step="0.5" inputMode="decimal" type="number" value={draft.price_eur} onChange={e => setDraft({ ...draft, price_eur: e.target.value })} /><small>Suggestion initiale : {analysis.suggested_price_eur} € · fourchette {analysis.price_range_eur.min}–{analysis.price_range_eur.max} €</small></label>
        <label>Pseudo vendeur <span className="muted">(facultatif)</span><input value={draft.seller_alias} onChange={e => setDraft({ ...draft, seller_alias: e.target.value })} /></label>
        <button className="primary" type="submit">Prévisualiser l’annonce</button>
      </form>
    </main>
  )

  return (
    <main className="screen"><button className="back" onClick={() => setSellerMode('dashboard')}>← Mes annonces</button><p className="eyebrow">Stand {standNumber} · Nouvelle annonce</p><h2>Photographie ton objet</h2><p className="lead small">Une photo suffit pour préparer le brouillon de l’annonce.</p>
      <label className="photo-drop"><span>📷</span><strong>{loading ? 'Analyse en cours…' : 'Prendre une photo'}</strong><small>ou choisir une image dans la galerie</small><input disabled={loading} type="file" accept="image/*" capture="environment" onChange={e => choosePhoto(e.target.files?.[0])} /></label>
      {loading && <div className="notice">Analyse en cours. Le mini‑marché reste accessible.</div>}
      {error && <p className="error">{error}</p>}
      <button className="secondary" onClick={openMarket}>Voir le mini‑marché</button>
    </main>
  )
}

function Market({ goHome }: { goHome: () => void }) {
  const [items, setItems] = useState<Listing[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(q = '') {
    setLoading(true); setError('')
    try { setItems(await fetchListings(q)) } catch (err) { setError(err instanceof Error ? err.message : 'Catalogue indisponible.') } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  if (selected) return <main className="screen"><button className="back" onClick={() => setSelected(null)}>← Annonces</button><div className="detail-photo"><img src={selected.image_url} alt={selected.title} /></div><span className="pill">Stand {selected.stand_number}</span><h2>{selected.title}</h2><div className="detail-price">{selected.price_eur} €</div><p>{selected.description}</p>{selected.category && <p className="muted">Catégorie · {selected.category}</p>}{selected.seller_alias && <p className="muted">Vendeur · {selected.seller_alias}</p>}</main>

  function submitSearch(e: FormEvent) { e.preventDefault(); void load(query) }
  return <main className="screen wide"><BackButton onClick={goHome} /><p className="eyebrow">Mini‑marché</p><h2>Qu’est-ce que tu cherches ?</h2>
    <form className="search" onSubmit={submitSearch}><input aria-label="Rechercher" placeholder="vinyle, lampe, jouet…" value={query} onChange={e => setQuery(e.target.value)} /><button>Rechercher</button></form>
    {error && <p className="error">{error}</p>}
    {loading ? <p className="muted">Chargement…</p> : items.length === 0 ? <div className="empty"><strong>Aucune annonce pour le moment.</strong><span>Les objets en vente apparaîtront ici.</span></div> : <div className="listing-grid">{items.map(item => <button key={item.id} className="listing-card" onClick={() => setSelected(item)}><img src={item.image_url} alt="" /><div><span className="pill">Stand {item.stand_number}</span><h3>{item.title}</h3><strong>{item.price_eur} €</strong></div></button>)}</div>}
  </main>
}

function Assistant({ goHome }: { goHome: () => void }) {
  return <main className="screen"><BackButton onClick={goHome} /><p className="eyebrow">J’analyse</p><h2>Assistant photo</h2><div className="notice"><strong>Tranche suivante.</strong><br />Le parcours vendeur et le mini‑marché sont prioritaires. L’analyse objet + les trois questions seront branchées après validation du socle.</div></main>
}

export default function App() {
  const [view, setView] = useState<View>('home')
  const content = useMemo(() => {
    if (view === 'seller') return <Seller goHome={() => setView('home')} openMarket={() => setView('market')} />
    if (view === 'market') return <Market goHome={() => setView('home')} />
    if (view === 'assistant') return <Assistant goHome={() => setView('home')} />
    return <Home navigate={setView} />
  }, [view])
  return <div className="app-shell">{content}</div>
}

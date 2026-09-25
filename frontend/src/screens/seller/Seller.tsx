import { FormEvent, useEffect, useState } from 'react'
import { downloadSellerReport, fetchSellerListings, setListingSold, trackEvent, updateListing } from '../../api'
import { plural } from '../../format'
import { cachedListing, rememberListings } from '../../listingCache'
import { goBack, navigate, openSeriesCamera } from '../../navigation'
import type { Route } from '../../navigation'
import { clearSellerOnboarding } from '../../sellerOnboarding'
import type { SellerOnboarding } from '../../sellerOnboarding'
import type { SellerBatchController } from '../../sellerBatch'
import type { Listing } from '../../types'
import { Icon } from '../../ui/icons'
import { Alert, Kicker, Page, TopBar } from '../../ui/Page'
import { PriceTag, StandBadge } from '../../ui/Tags'
import { useToast } from '../../ui/Toast'
import { DraftFields, draftProblem } from './DraftFields'
import type { DraftValues } from './DraftFields'
import SellerOnboardingFlow, { trackOnboarding } from './SellerOnboardingFlow'
import SeriesScreen from './SeriesScreen'

type SellerRoute = Extract<Route, { name: 'seller' | 'series' | 'editListing' }>

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message !== 'Une erreur est survenue.' ? err.message : fallback
}

export default function Seller({ route, onboarding, onOnboardingChange, batch }: {
  route: SellerRoute
  onboarding: SellerOnboarding | null
  onOnboardingChange: (value: SellerOnboarding | null) => void
  batch: SellerBatchController
}) {
  const stand = onboarding?.stand ?? ''
  const alias = onboarding?.alias ?? ''

  useEffect(() => {
    if (stand) batch.ensureStand(stand, alias)
  }, [stand, alias, batch.ensureStand])

  if (!onboarding) return <SellerOnboardingFlow onConfirmed={value => { batch.ensureStand(value.stand, value.alias); onOnboardingChange(value) }} />

  if (route.name === 'series') return <SeriesScreen camera={route.camera} stand={stand} alias={alias} batch={batch} />
  if (route.name === 'editListing') return <EditListing id={route.id} stand={stand} />
  return <Dashboard stand={stand} alias={alias} batch={batch} onStandReset={() => { batch.reset(); onOnboardingChange(null) }} />
}

function Dashboard({ stand, alias, batch, onStandReset }: { stand: string; alias: string; batch: SellerBatchController; onStandReset: () => void }) {
  const toast = useToast()
  const [items, setItems] = useState<Listing[] | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [confirmingChange, setConfirmingChange] = useState(false)
  const batchItems = batch.batch.stand === stand ? batch.batch.items : []
  const unfinished = batchItems.filter(item => item.status !== 'published').length

  async function load() {
    setError('')
    try {
      const rows = await fetchSellerListings(stand)
      rememberListings(rows)
      setItems(rows)
    } catch (err) {
      setError(errorText(err, 'Impossible de charger vos annonces.'))
    }
  }

  useEffect(() => { void load() }, [stand])

  async function setSold(item: Listing, sold: boolean) {
    setPending(item.id)
    setError('')
    try {
      const updated = await setListingSold(item.id, stand, sold)
      setItems(current => current?.map(row => row.id === item.id ? { ...row, ...updated, view_count: row.view_count } : row) ?? null)
      return true
    } catch (err) {
      setError(errorText(err, 'La mise à jour n’a pas abouti. Réessayez.'))
      return false
    } finally {
      setPending(null)
    }
  }

  async function markSold(item: Listing) {
    if (!await setSold(item, true)) return
    toast({
      message: `« ${item.title} » marqué vendu`,
      actionLabel: 'Annuler',
      onAction: () => {
        void trackEvent('feature_clicked', { feature: 'listing_sold', action: 'undone' })
        void setSold(item, false)
      }
    })
  }

  async function exportReport() {
    setReportLoading(true)
    setError('')
    try {
      await downloadSellerReport(stand)
    } catch (err) {
      setError(errorText(err, 'Le bilan PDF n’a pas pu être créé.'))
    } finally {
      setReportLoading(false)
    }
  }

  function changeStand() {
    trackOnboarding('stand_reset')
    clearSellerOnboarding()
    setConfirmingChange(false)
    onStandReset()
  }

  const active = items?.filter(item => item.sold_at === null).length ?? 0
  const sold = items?.filter(item => item.sold_at !== null).length ?? 0

  return (
    <Page className="dashboard">
      <TopBar onBack={() => goBack({ name: 'home' })} />
      <div className="dashboard__head">
        <div>
          <Kicker>Mon stand</Kicker>
          <StandBadge stand={stand} size="xl" />
          {alias && <p className="muted-line">Pseudo : {alias}</p>}
        </div>
        {!confirmingChange && <button type="button" className="btn-link" onClick={() => setConfirmingChange(true)}>Changer de stand</button>}
      </div>
      {confirmingChange && (
        <div className="confirm-box" role="group" aria-label="Changer de stand">
          <p><strong>Changer de stand ?</strong> Ce téléphone ne gérera plus le stand {stand}. Ses annonces restent en ligne.</p>
          <div>
            <button type="button" className="btn btn--secondary btn--inline" onClick={changeStand}>Oui, changer</button>
            <button type="button" className="btn-link" onClick={() => setConfirmingChange(false)}>Annuler</button>
          </div>
        </div>
      )}

      {unfinished > 0 ? (
        <button type="button" className="hero-action" onClick={() => navigate({ name: 'series', camera: false })}>
          <span className="hero-action__icon"><Icon name="tag" size={32} /></span>
          <span><strong>Reprendre ma série</strong><small>{plural(unfinished, 'annonce')} en cours de préparation.</small></span>
        </button>
      ) : (
        <button type="button" className="hero-action" onClick={openSeriesCamera}>
          <span className="hero-action__icon"><Icon name="camera" size={32} /></span>
          <span><strong>Ajouter des objets</strong><small>Photographiez-les à la suite, BrocAI prépare les annonces.</small></span>
        </button>
      )}

      <section className="section" aria-labelledby="dashboard-listings">
        <div className="section__head">
          <div>
            <h2 id="dashboard-listings">Mes annonces</h2>
            {items && <p className="section__hint">{active} en vente · {plural(sold, 'vendue')}</p>}
          </div>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {items === null && !error ? (
          <p className="muted-line" role="status">Chargement de vos annonces…</p>
        ) : items && items.length === 0 ? (
          <div className="empty-state"><strong>Aucune annonce sur ce stand.</strong><span>Ajoutez vos premiers objets : ils apparaîtront aussitôt pour les visiteurs.</span></div>
        ) : (
          <ul className="seller-list">
            {items?.map(item => {
              const isSold = item.sold_at !== null
              return (
                <li key={item.id} className={`seller-item${isSold ? ' is-sold' : ''}`}>
                  <img src={item.image_url} alt="" loading="lazy" />
                  <div className="seller-item__body">
                    <div className="seller-item__top">
                      <span className={`status-pill${isSold ? ' status-pill--sold' : ''}`}>{isSold ? 'Vendu' : 'En vente'}</span>
                      <PriceTag price={item.price_eur} size="sm" />
                    </div>
                    <strong>{item.title}</strong>
                    <span className="muted-line"><Icon name="eye" size={18} /> {plural(item.view_count ?? 0, 'vue')}</span>
                    <div className="seller-item__actions">
                      {isSold ? (
                        <button type="button" className="btn btn--secondary btn--inline" disabled={pending === item.id} onClick={() => void setSold(item, false)}>Remettre en vente</button>
                      ) : (
                        <button type="button" className="btn btn--pine btn--inline" disabled={pending === item.id} onClick={() => void markSold(item)}><Icon name="check" size={20} /> Marquer vendu</button>
                      )}
                      <button type="button" className="btn btn--secondary btn--inline" onClick={() => navigate({ name: 'editListing', id: item.id })}>Modifier</button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="report-card">
        <div>
          <Kicker>Fin de journée</Kicker>
          <h2>Mon bilan vendeur</h2>
          <p>Ventes, montant déclaré, vues et liste des objets vendus, dans un PDF.</p>
        </div>
        <button type="button" className="btn btn--secondary" disabled={reportLoading} onClick={() => void exportReport()}><Icon name="download" /> {reportLoading ? 'Création du PDF…' : 'Télécharger mon bilan'}</button>
      </section>
    </Page>
  )
}

function EditListing({ id, stand }: { id: string; stand: string }) {
  const [listing, setListing] = useState<Listing | null>(() => cachedListing(id))
  const [values, setValues] = useState<DraftValues | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (listing) return
    void (async () => {
      try {
        const rows = await fetchSellerListings(stand)
        rememberListings(rows)
        const found = rows.find(row => row.id === id)
        if (found) setListing(found)
        else setError('Cette annonce n’appartient pas à ce stand.')
      } catch (err) {
        setError(errorText(err, 'Impossible de charger l’annonce.'))
      }
    })()
  }, [id, stand])

  useEffect(() => {
    if (listing && !values) setValues({
      title: listing.title,
      description: listing.description,
      fun_line: listing.fun_line || '',
      category: listing.category,
      price_eur: listing.price_eur,
      seller_alias: listing.seller_alias || ''
    })
  }, [listing])

  const back = () => goBack({ name: 'seller' })

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!values || draftProblem(values)) return
    setSaving(true)
    setError('')
    try {
      rememberListings([await updateListing(id, { ...values, stand_number: stand })])
      back()
    } catch (err) {
      setError(errorText(err, 'Modification non enregistrée. Réessayez.'))
      setSaving(false)
    }
  }

  const problem = values ? draftProblem(values) : null
  return (
    <Page className="edit">
      <TopBar onBack={back} />
      <Kicker>Stand {stand}</Kicker>
      <h1 className="page-title">Modifier l’annonce</h1>
      {listing && <img className="edit__photo" src={listing.image_url} alt={listing.title} />}
      {!values && !error && <p className="muted-line" role="status">Chargement…</p>}
      {values && (
        <form className="form" onSubmit={save}>
          <DraftFields values={values} onChange={setValues} expanded />
          {problem && <p className="inline-error">{problem}</p>}
          {error && <Alert tone="error">{error}</Alert>}
          <button className="btn btn--primary" disabled={saving || Boolean(problem)} type="submit">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          <button className="btn btn--secondary" disabled={saving} type="button" onClick={back}>Annuler</button>
        </form>
      )}
      {!values && error && <Alert tone="error">{error}</Alert>}
    </Page>
  )
}

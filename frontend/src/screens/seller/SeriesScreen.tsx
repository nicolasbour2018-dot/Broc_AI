import { useState } from 'react'
import CameraCapture from '../../camera/CameraCapture'
import type { CameraUnavailable } from '../../camera/CameraCapture'
import { goBack, navigate, openSeriesCamera } from '../../navigation'
import { BUSY_STATUSES, MAX_SELLER_PHOTOS, PUBLISHABLE_STATUSES } from '../../sellerBatch'
import type { SellerBatchController, SellerBatchItem } from '../../sellerBatch'
import { Icon } from '../../ui/icons'
import { Alert, Kicker, Page, TopBar } from '../../ui/Page'
import { useToast } from '../../ui/Toast'
import { Tip } from '../../ui/Tip'
import { draftProblem } from './DraftFields'
import { DraftCard } from './DraftCard'

const CAMERA_FALLBACK_TEXT: Record<CameraUnavailable, string> = {
  unsupported: 'Ce téléphone n’ouvre pas l’appareil photo dans l’application : utilisez celui du téléphone, photo après photo.',
  denied: 'L’accès à l’appareil photo a été refusé. Vous pouvez l’autoriser dans les réglages du navigateur, ou utiliser l’appareil photo du téléphone ci-dessous.',
  error: 'L’appareil photo n’a pas pu s’ouvrir : utilisez celui du téléphone, photo après photo.'
}

// The series: shoot, analyse, fix what needs fixing in the list, publish everything ready at once.
export default function SeriesScreen({ camera, stand, alias, batch }: { camera: boolean; stand: string; alias: string; batch: SellerBatchController }) {
  const toast = useToast()
  const [cameraUnavailable, setCameraUnavailable] = useState<CameraUnavailable | null>(null)
  const [limitMessage, setLimitMessage] = useState('')
  const items = batch.batch.stand === stand ? batch.batch.items : []

  const selected = items.filter(item => item.status === 'selected')
  const drafts = items.filter(item => item.status !== 'selected')
  const busyCount = items.filter(item => BUSY_STATUSES.includes(item.status)).length
  const publishable = items.filter(item => PUBLISHABLE_STATUSES.includes(item.status))
  const valid = publishable.filter(item => item.draft && !draftProblem(item.draft))
  const publishedCount = items.filter(item => item.status === 'published').length
  // Same count as `addPhotos`: every photo of the series, published ones included.
  const remaining = MAX_SELLER_PHOTOS - items.length
  const finished = batch.batch.started && publishedCount > 0 && selected.length === 0 && busyCount === 0 && publishable.length === 0
  const showCamera = camera && !cameraUnavailable

  function openCamera() {
    // A finished series makes room for a new one before shooting again.
    if (items.length > 0 && items.every(item => item.status === 'published')) batch.reset(stand, alias)
    if (cameraUnavailable) return
    openSeriesCamera()
  }

  function addFiles(files: File[]) {
    if (items.length > 0 && items.every(item => item.status === 'published')) batch.reset(stand, alias)
    const added = batch.addPhotos(files)
    setLimitMessage(added < files.length ? `Une série compte ${MAX_SELLER_PHOTOS} photos au plus : publiez celles-ci, puis commencez une nouvelle série.` : '')
  }

  function closeCamera(files: File[]) {
    if (files.length) addFiles(files)
    goBack({ name: 'series', camera: false })
  }

  function cameraFailed(reason: CameraUnavailable) {
    setCameraUnavailable(reason)
    navigate({ name: 'series', camera: false }, { replace: true })
  }

  function remove(item: SellerBatchItem) {
    const removed = batch.removeItem(item.id)
    if (!removed) return
    toast({
      message: item.draft?.title ? `« ${item.draft.title} » supprimé` : 'Photo retirée',
      actionLabel: 'Annuler',
      onAction: () => batch.restoreItem(removed),
      onExpire: () => batch.discardRemoved(removed)
    })
  }

  const nativeCamera = (label: string, primary: boolean) => (
    <label className={`btn ${primary ? 'btn--primary btn--xl' : 'btn--secondary'}`}>
      <Icon name="camera" size={primary ? 28 : 24} /> {label}
      <input className="sr-only" type="file" accept="image/*" capture="environment" onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
    </label>
  )
  const galleryButton = (
    <label className="btn btn--secondary">
      <Icon name="gallery" /> Choisir dans la galerie
      <input className="sr-only" type="file" accept="image/*" multiple onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
    </label>
  )
  const shootMore = cameraUnavailable
    ? nativeCamera(items.length ? 'Photo suivante' : 'Prendre une photo', items.length === 0 || selected.length > 0)
    : <button type="button" className={`btn ${items.length === 0 ? 'btn--primary btn--xl' : 'btn--secondary'}`} onClick={openCamera}><Icon name="camera" size={items.length === 0 ? 28 : 24} /> {items.length === 0 ? 'Prendre des photos' : 'Prendre d’autres photos'}</button>

  // One clear next step at the bottom of the screen.
  let action: { label: string; run: () => void } | null = null
  if (selected.length > 0) action = { label: selected.length === 1 ? 'Analyser ma photo' : `Analyser mes ${selected.length} photos`, run: () => void batch.startAnalysis() }
  else if (valid.length > 0) action = { label: valid.length === 1 ? 'Publier l’annonce prête' : `Publier les ${valid.length} annonces prêtes`, run: () => void batch.publishAll(valid.map(item => item.id)) }

  return (
    <>
      <Page className={`series${action ? ' has-action-bar' : ''}`}>
        <TopBar onBack={() => goBack({ name: 'seller' })} />
        <Kicker>Stand {stand}</Kicker>
        <h1 className="page-title">Ma série de photos</h1>

        {items.length === 0 && (
          <>
            <ol className="steps">
              <li><span className="steps__num">1</span><span><strong>Photographiez vos objets</strong> à la suite, jusqu’à {MAX_SELLER_PHOTOS}.</span></li>
              <li><span className="steps__num">2</span><span><strong>BrocAI prépare chaque annonce</strong> : titre, description, prix.</span></li>
              <li><span className="steps__num">3</span><span><strong>Corrigez si besoin et publiez</strong> tout d’un coup.</span></li>
            </ol>
            {cameraUnavailable && <Alert title="Appareil photo du téléphone">{CAMERA_FALLBACK_TEXT[cameraUnavailable]}</Alert>}
            <div className="photo-picker">{shootMore}{galleryButton}</div>
          </>
        )}

        {items.length > 0 && <Tip id="series-review">Relisez chaque annonce : BrocAI propose, c’est vous qui décidez du titre et du prix.</Tip>}
        {limitMessage && <Alert tone="error">{limitMessage}</Alert>}

        {selected.length > 0 && (
          <section className="section" aria-labelledby="series-photos">
            <div className="section__head">
              <div>
                <h2 id="series-photos">Photos à analyser</h2>
                <p className="section__hint">{selected.length} photo{selected.length > 1 ? 's' : ''}. Retirez celles qui ne vous plaisent pas avant de lancer l’analyse.</p>
              </div>
            </div>
            <ul className="photo-grid">
              {selected.map((item, index) => (
                <li key={item.id}>
                  <img src={item.previewUrl} alt={`Photo ${index + 1}`} />
                  <button type="button" onClick={() => remove(item)} aria-label={`Retirer la photo ${index + 1}`}><Icon name="close" size={20} /></button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {items.length > 0 && remaining > 0 && !finished && (
          <div className="photo-picker photo-picker--inline">
            {cameraUnavailable && <Alert title="Appareil photo du téléphone">{CAMERA_FALLBACK_TEXT[cameraUnavailable]}</Alert>}
            {shootMore}
            {cameraUnavailable && galleryButton}
          </div>
        )}

        {drafts.length > 0 && (
          <section className="section" aria-labelledby="series-drafts">
            <div className="section__head">
              <div>
                <h2 id="series-drafts">{finished ? 'Annonces de cette série' : 'Mes annonces à publier'}</h2>
                <p className="section__hint">{busyCount > 0 ? `${busyCount} en préparation : vous pouvez déjà publier celles qui sont prêtes.` : publishable.length > 0 ? 'Vérifiez le titre et le prix, puis publiez.' : 'Toutes les annonces de la série sont en ligne.'}</p>
              </div>
            </div>
            <div className="draft-list">
              {drafts.map(item => <DraftCard key={item.id} item={item} index={items.indexOf(item)} batch={batch} onDelete={() => remove(item)} />)}
            </div>
          </section>
        )}

        {finished && (
          <div className="done-panel">
            <Alert tone="success" title={`${publishedCount} annonce${publishedCount > 1 ? 's' : ''} en ligne`}>Les visiteurs peuvent les voir et savent qu’elles sont au stand {stand}.</Alert>
            <button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'seller' })}>Voir mes annonces</button>
            <button type="button" className="btn btn--secondary" onClick={() => { batch.reset(stand, alias); openCamera() }}><Icon name="camera" /> Nouvelle série</button>
          </div>
        )}
      </Page>

      {action && (
        <div className="action-bar">
          <button type="button" className="btn btn--primary" onClick={action.run}>{action.label}</button>
        </div>
      )}

      {showCamera && <CameraCapture remaining={Math.max(0, remaining)} onDone={closeCamera} onUnavailable={cameraFailed} />}
    </>
  )
}

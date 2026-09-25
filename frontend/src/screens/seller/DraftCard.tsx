import type { SellerBatchController, SellerBatchItem } from '../../sellerBatch'
import { AiWait } from '../../ui/Ai'
import { Icon } from '../../ui/icons'
import { DraftFields, draftProblem } from './DraftFields'

function needsCheck(item: SellerBatchItem): string | null {
  if (item.analysis?.analysis_mode === 'mock-fallback') return 'Analyse automatique indisponible pour cette photo : complétez l’annonce vous-même.'
  if (item.analysis?.confidence === 'low') return 'BrocAI n’est pas sûr de lui : vérifiez le titre et le prix.'
  return null
}

// One photo of the series, from analysis to publication. Ready drafts are edited in place; there is no
// separate preview or validation step.
export function DraftCard({ item, index, batch, onDelete }: { item: SellerBatchItem; index: number; batch: SellerBatchController; onDelete: () => void }) {
  const busy = ['uploading', 'queued', 'running', 'publishing'].includes(item.status)
  const deleteButton = (
    <button type="button" className="btn-link btn-link--danger" onClick={onDelete} disabled={busy} title={busy ? 'Suppression possible après l’analyse' : undefined}>
      <Icon name="trash" size={20} /> Supprimer
    </button>
  )
  const photo = item.previewUrl ? <img className="draft-card__photo" src={item.previewUrl} alt={item.draft?.title || `Photo ${index + 1}`} /> : <span className="draft-card__photo draft-card__photo--empty" aria-hidden="true">{index + 1}</span>

  if (item.status === 'published') return (
    <article className="draft-card draft-card--done">
      {photo}
      <div className="draft-card__summary">
        <strong>{item.published?.title ?? item.draft?.title}</strong>
        <span className="status-pill"><Icon name="check" size={18} /> En ligne</span>
      </div>
    </article>
  )

  if (item.status === 'publishing') return (
    <article className="draft-card draft-card--waiting">
      {photo}
      <div className="draft-card__summary">
        <strong>{item.draft?.title}</strong>
        <p className="muted-line" role="status"><span className="spinner" aria-hidden="true" /> Publication en cours…</p>
      </div>
    </article>
  )

  if (item.status === 'uploading' || item.status === 'queued' || item.status === 'running') return (
    <article className="draft-card draft-card--waiting">
      {photo}
      <div className="draft-card__summary">
        <strong>Photo {index + 1}</strong>
        <AiWait progress={item.progress ?? null} label={item.status === 'uploading' ? 'Envoi de la photo' : 'Préparation de l’annonce'} compact />
        <small className="muted-line">Suppression possible après l’analyse.</small>
      </div>
    </article>
  )

  if (item.status === 'analysis_error' || item.status === 'tracking_error') return (
    <article className="draft-card draft-card--error">
      {photo}
      <div className="draft-card__summary">
        <strong>Photo {index + 1}</strong>
        <p className="inline-error">{item.status === 'tracking_error' ? 'Connexion perdue pendant l’analyse.' : item.error || 'L’analyse n’a pas abouti.'}</p>
        <div className="draft-card__actions">
          {item.status === 'tracking_error' && <button type="button" className="btn btn--secondary btn--inline" onClick={() => batch.retryTracking(item.id)}><Icon name="refresh" size={20} /> Reprendre</button>}
          {item.status === 'analysis_error' && item.file && <button type="button" className="btn btn--secondary btn--inline" onClick={() => void batch.submitItem(item.id)}><Icon name="refresh" size={20} /> Réessayer</button>}
          {item.status === 'analysis_error' && (
            <label className="btn btn--secondary btn--inline">
              <Icon name="camera" size={20} /> Autre photo
              <input className="sr-only" type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) void batch.submitItem(item.id, file); e.target.value = '' }} />
            </label>
          )}
          {deleteButton}
        </div>
      </div>
    </article>
  )

  if (!item.draft || !item.analysis) return null
  const draft = item.draft
  const check = needsCheck(item)
  const problem = draftProblem(draft)
  const range = item.analysis.price_range_eur

  return (
    <article className="draft-card" aria-label={`Brouillon ${index + 1} : ${draft.title}`}>
      <div className="draft-card__head">
        {photo}
        <div>
          <span className="draft-card__index">Objet {index + 1}</span>
          {check && <span className="check-badge"><Icon name="warning" size={18} /> À vérifier</span>}
        </div>
      </div>
      {check && <p className="draft-card__check">{check}</p>}
      <DraftFields
        values={draft}
        onChange={values => batch.updateDraft(item.id, { ...draft, ...values })}
        suggestion={`Suggestion de BrocAI : ${item.analysis.suggested_price_eur} € (entre ${range.min} et ${range.max} €).`}
      />
      {problem && <p className="inline-error">{problem}</p>}
      {item.status === 'publish_error' && (
        <div className="inline-error">
          <span>Publication non aboutie : {item.error}</span>
          <button type="button" className="btn-link" onClick={() => void batch.publishOne(item.id)}>Réessayer</button>
        </div>
      )}
      <div className="draft-card__actions">{deleteButton}</div>
    </article>
  )
}

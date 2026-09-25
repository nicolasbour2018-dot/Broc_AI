import type { AiJobProgress, Confidence } from '../types'
import { Icon } from './icons'

export function queueMessage(progress: AiJobProgress | null, action = 'Analyse'): string {
  if (!progress) return `${action} en cours…`
  if (progress.status === 'queued') {
    const position = progress.queue_position && progress.queue_position > 0 ? `Vous êtes ${progress.queue_position}${progress.queue_position === 1 ? 'er' : 'e'} dans la file` : 'En attente de traitement'
    return `${position}${progress.wait_label ? ` · ${progress.wait_label}` : ''}`
  }
  if (progress.status === 'running') return `${action} en cours…`
  return `${action} terminée`
}

// Waiting on the AI queue: what is happening, where we are in the line, and an optional preview.
export function AiWait({ progress, label, note, photoUrl, compact = false }: { progress: AiJobProgress | null; label: string; note?: string; photoUrl?: string; compact?: boolean }) {
  return (
    <div className={`ai-wait${compact ? ' ai-wait--compact' : ''}`} role="status" aria-live="polite">
      {photoUrl && <img src={photoUrl} alt="" />}
      <div>
        <span className="spinner" aria-hidden="true" />
        <strong>{queueMessage(progress, label)}</strong>
        {note && <small>{note}</small>}
      </div>
    </div>
  )
}

const CONFIDENCE: Record<Confidence, { label: string; level: number; text: string }> = {
  low: { label: 'faible', level: 1, text: 'La photo laisse un doute : prenez ces repères avec prudence.' },
  medium: { label: 'moyenne', level: 2, text: 'Identification probable, à confirmer en regardant l’objet de près.' },
  high: { label: 'forte', level: 3, text: 'L’objet est bien reconnu sur la photo.' }
}

export function ConfidenceMeter({ confidence }: { confidence: Confidence }) {
  const value = CONFIDENCE[confidence]
  return (
    <div className="confidence">
      <span className="confidence__bars" aria-hidden="true">{[1, 2, 3].map(level => <span key={level} className={level <= value.level ? 'is-on' : ''} />)}</span>
      <p><strong>Confiance {value.label}.</strong> {value.text}</p>
    </div>
  )
}

// Camera first (the phone opens its camera app), gallery as an alternative.
export function PhotoPicker({ onFile, cameraLabel, disabled = false }: { onFile: (file: File) => void; cameraLabel: string; disabled?: boolean }) {
  return (
    <div className="photo-picker">
      <label className={`btn btn--primary btn--xl${disabled ? ' is-disabled' : ''}`}>
        <Icon name="camera" size={28} /> {cameraLabel}
        <input className="sr-only" disabled={disabled} type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = '' }} />
      </label>
      <label className={`btn btn--secondary${disabled ? ' is-disabled' : ''}`}>
        <Icon name="gallery" /> Choisir dans la galerie
        <input className="sr-only" disabled={disabled} type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = '' }} />
      </label>
    </div>
  )
}

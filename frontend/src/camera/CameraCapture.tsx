import { useEffect, useRef, useState } from 'react'
import { trackEvent } from '../api'
import { Icon } from '../ui/icons'

type Shot = { file: File; url: string }

export type CameraUnavailable = 'unsupported' | 'denied' | 'error'

function trackCamera(action: string, extra: Record<string, string | number> = {}) {
  void trackEvent('feature_clicked', { feature: 'camera', action, ...extra })
}

// In-app viewfinder: shoot object after object without leaving the app, then hand the photos over.
// When the camera cannot open (no API, permission refused, busy), the parent falls back to the
// phone's own camera through a file input.
export default function CameraCapture({ remaining, onDone, onUnavailable }: {
  remaining: number
  onDone: (files: File[]) => void
  onUnavailable: (reason: CameraUnavailable) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const shotsRef = useRef<Shot[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [ready, setReady] = useState(false)
  const [flash, setFlash] = useState(false)
  const [capturing, setCapturing] = useState(false)
  // A permission prompt left unanswered, or a camera that never starts: offer the phone's camera instead.
  const [slow, setSlow] = useState(false)
  const full = shots.length >= remaining

  function updateShots(next: Shot[]) {
    shotsRef.current = next
    setShots(next)
  }

  useEffect(() => {
    let cancelled = false

    function stop() {
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      setReady(false)
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        trackCamera('fallback', { reason: 'unsupported' })
        onUnavailable('unsupported')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }
        })
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setReady(true)
      } catch (error) {
        if (cancelled) return
        const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
        trackCamera(denied ? 'denied' : 'fallback', { reason: error instanceof DOMException ? error.name : 'unknown' })
        onUnavailable(denied ? 'denied' : 'error')
      }
    }

    // The camera stays off while the page is hidden (phone locked, app switched).
    function onVisibility() {
      if (document.hidden) stop()
      else if (!streamRef.current) void start()
    }

    trackCamera('opened')
    void start()
    const slowTimer = window.setTimeout(() => setSlow(true), 6000)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearTimeout(slowTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [])

  // Photos not handed over are released when the viewfinder closes.
  useEffect(() => () => { for (const shot of shotsRef.current) URL.revokeObjectURL(shot.url) }, [])

  function capture() {
    const video = videoRef.current
    if (!video || !ready || full || capturing || !video.videoWidth) return
    setCapturing(true)
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    setFlash(true)
    window.setTimeout(() => setFlash(false), 160)
    canvas.toBlob(blob => {
      setCapturing(false)
      if (!blob) return
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
      updateShots([...shotsRef.current, { file, url: URL.createObjectURL(file) }])
      trackCamera('captured', { count: shotsRef.current.length })
    }, 'image/jpeg', 0.9)
  }

  function addFromGallery(files: FileList | null) {
    if (!files) return
    const added = Array.from(files).slice(0, remaining - shotsRef.current.length).map(file => ({ file, url: URL.createObjectURL(file) }))
    updateShots([...shotsRef.current, ...added])
  }

  function remove(index: number) {
    URL.revokeObjectURL(shotsRef.current[index].url)
    updateShots(shotsRef.current.filter((_, position) => position !== index))
  }

  function finish() {
    const files = shotsRef.current.map(shot => shot.file)
    // The URLs are revoked on unmount; the series creates its own previews from the files.
    trackCamera('done', { count: files.length })
    onDone(files)
  }

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label="Appareil photo">
      <div className="camera__top">
        <button type="button" className="camera__close" onClick={finish}>
          <Icon name={shots.length ? 'check' : 'close'} /> {shots.length ? 'Terminer' : 'Fermer'}
        </button>
        <span className="camera__count" aria-live="polite">{shots.length} photo{shots.length > 1 ? 's' : ''} · {remaining - shots.length} restante{remaining - shots.length > 1 ? 's' : ''}</span>
      </div>

      <div className="camera__viewport">
        <video ref={videoRef} playsInline muted autoPlay aria-hidden="true" />
        {!ready && (
          <div className="camera__status">
            <p>Ouverture de l’appareil photo…</p>
            {slow && <p>Si votre téléphone demande l’accès à l’appareil photo, acceptez-le.</p>}
            {slow && <button type="button" className="camera__fallback" onClick={() => { trackCamera('fallback', { reason: 'slow' }); onUnavailable('error') }}>Utiliser l’appareil photo du téléphone</button>}
          </div>
        )}
        {flash && <span className="camera__flash" aria-hidden="true" />}
        <p className="camera__hint">Une photo = une annonce. Pour un lot, photographiez tous les objets ensemble.</p>
      </div>

      {shots.length > 0 && (
        <ul className="camera__shots" aria-label="Photos prises">
          {shots.map((shot, index) => (
            <li key={shot.url}>
              <img src={shot.url} alt={`Photo ${index + 1}`} />
              <button type="button" onClick={() => remove(index)} aria-label={`Retirer la photo ${index + 1}`}><Icon name="close" size={18} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="camera__controls">
        <label className="camera__side">
          <Icon name="gallery" size={28} />
          <span>Galerie</span>
          <input className="sr-only" type="file" accept="image/*" multiple disabled={full} onChange={e => { addFromGallery(e.target.files); e.target.value = '' }} />
        </label>
        <button type="button" className="camera__shutter" onClick={capture} disabled={!ready || full} aria-label={full ? 'Nombre maximum de photos atteint' : 'Prendre la photo'}>
          <span />
        </button>
        <button type="button" className="camera__side camera__done" onClick={finish} disabled={shots.length === 0}>
          <Icon name="check" size={28} />
          <span>Terminer{shots.length ? ` (${shots.length})` : ''}</span>
        </button>
      </div>
    </div>
  )
}

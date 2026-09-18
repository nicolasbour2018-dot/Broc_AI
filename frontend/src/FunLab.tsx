import { useMemo, useState } from 'react'
import { analyzeFunPhoto, requestFunQuest, requestFunWish } from './api'
import type { AiJobProgress, AssistantAnalysis, FunQuestType, FunWishResult, FunWishType } from './types'
import './funlab.css'

type ResultCard = FunWishResult & { photos?: string[] }
type QuestPhoto = { file: File | null; url: string }

type WishMeta = {
  id: FunWishType
  icon: string
  title: string
  description: string
}

type QuestMeta = {
  id: FunQuestType
  icon: string
  title: string
  description: string
  missionOne: string
  missionTwo: string
}

const WISHES: WishMeta[] = [
  {
    id: 'bring_to_life',
    icon: '✨',
    title: 'Donne-moi vie',
    description: 'Ton objet devient un personnage avec un nom, un caractère et une mini-réplique.'
  },
  {
    id: 'movie_star',
    icon: '🎬',
    title: 'Fais de moi une star',
    description: 'Une affiche imaginaire : titre, slogan et premier rôle pour ton objet.'
  },
  {
    id: 'imaginary_past',
    icon: '📜',
    title: 'Raconte mon passé',
    description: 'Une mini-biographie totalement inventée, comme si ton objet avait déjà vécu mille vies.'
  },
  {
    id: 'secret_power',
    icon: '⚡',
    title: 'Mon pouvoir secret',
    description: 'Un super-pouvoir absurde, sa faiblesse et une punchline.'
  },
  {
    id: 'fairground_quest',
    icon: '🎡',
    title: 'Pars en quête',
    description: 'Emmène ton objet à la fête foraine : un selfie, deux photos-missions, puis BrocAI raconte votre aventure.'
  }
]

const QUESTS: QuestMeta[] = [
  {
    id: 'grand_tour',
    icon: '🎢',
    title: 'La grande aventure',
    description: 'Trouve l’attraction qui ressemble le plus à ton objet, puis son endroit préféré dans la fête.',
    missionOne: 'Photographie l’attraction qui ressemble le plus à la personnalité de ton objet.',
    missionTwo: 'Photographie l’endroit où ton objet voudrait terminer sa soirée.'
  },
  {
    id: 'secret_mission',
    icon: '🕵️',
    title: 'Mission secrète',
    description: 'Pars à la recherche de deux indices dans la fête et laisse BrocAI relier les preuves.',
    missionOne: 'Trouve quelque chose de plus bruyant ou plus agité que ton objet.',
    missionTwo: 'Trouve sa couleur jumelle quelque part dans la fête.'
  },
  {
    id: 'fair_star',
    icon: '🌟',
    title: 'Star de la fête',
    description: 'Fabrique le décor de rêve de ton objet, puis trouve-lui un rival ou un complice.',
    missionOne: 'Photographie le décor parfait pour l’affiche de ton objet.',
    missionTwo: 'Photographie quelque chose qui pourrait être son rival ou son meilleur complice.'
  }
]

const EMPTY_PHOTO: QuestPhoto = { file: null, url: '' }

function queueMessage(progress: AiJobProgress | null): string {
  if (!progress) return 'Création en cours…'
  if (progress.status === 'queued') {
    const position = progress.queue_position && progress.queue_position > 0 ? `Position ${progress.queue_position}` : 'En attente'
    return `${position}${progress.wait_label ? ` · ${progress.wait_label}` : ''}`
  }
  if (progress.status === 'running') return 'BrocAI prépare ton vœu…'
  return 'Vœu terminé'
}

function WishDots({ remaining }: { remaining: number }) {
  return (
    <div className="fun-wish-dots" aria-label={`${remaining} vœu${remaining > 1 ? 'x' : ''} restant${remaining > 1 ? 's' : ''}`}>
      {[0, 1, 2].map(index => <span key={index} className={index < remaining ? 'active' : ''}>✦</span>)}
    </div>
  )
}

function PhotoStep({
  number,
  title,
  description,
  capture,
  value,
  onChange
}: {
  number: number
  title: string
  description: string
  capture: 'user' | 'environment'
  value: QuestPhoto
  onChange: (file: File) => void
}) {
  return (
    <label className={`fun-photo-step ${value.url ? 'has-photo' : ''}`}>
      <span className="fun-step-number">{number}</span>
      <div className="fun-photo-copy"><strong>{title}</strong><small>{description}</small></div>
      {value.url ? <img src={value.url} alt="Aperçu de la mission" /> : <span className="fun-photo-cta">Prendre la photo</span>}
      <input type="file" accept="image/*" capture={capture} onChange={event => {
        const file = event.target.files?.[0]
        if (file) onChange(file)
      }} />
    </label>
  )
}

export default function FunLab({ goHome }: { goHome: () => void }) {
  const [analysis, setAnalysis] = useState<AssistantAnalysis | null>(null)
  const [objectPhotoUrl, setObjectPhotoUrl] = useState('')
  const [results, setResults] = useState<ResultCard[]>([])
  const [usedWishes, setUsedWishes] = useState<FunWishType[]>([])
  const [questType, setQuestType] = useState<FunQuestType | null>(null)
  const [selfie, setSelfie] = useState<QuestPhoto>(EMPTY_PHOTO)
  const [missionOne, setMissionOne] = useState<QuestPhoto>(EMPTY_PHOTO)
  const [missionTwo, setMissionTwo] = useState<QuestPhoto>(EMPTY_PHOTO)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<AiJobProgress | null>(null)
  const [error, setError] = useState('')

  const selectedQuest = useMemo(() => QUESTS.find(item => item.id === questType) || null, [questType])

  function replacePhoto(current: QuestPhoto, file: File, setter: (value: QuestPhoto) => void) {
    if (current.url) URL.revokeObjectURL(current.url)
    setter({ file, url: URL.createObjectURL(file) })
  }

  function revokeAllUrls() {
    if (objectPhotoUrl) URL.revokeObjectURL(objectPhotoUrl)
    for (const item of [selfie, missionOne, missionTwo]) if (item.url) URL.revokeObjectURL(item.url)
    for (const result of results) for (const url of result.photos || []) URL.revokeObjectURL(url)
  }

  function reset() {
    revokeAllUrls()
    setAnalysis(null)
    setObjectPhotoUrl('')
    setResults([])
    setUsedWishes([])
    setQuestType(null)
    setSelfie(EMPTY_PHOTO)
    setMissionOne(EMPTY_PHOTO)
    setMissionTwo(EMPTY_PHOTO)
    setLoading(false)
    setProgress(null)
    setError('')
  }

  async function chooseObject(file?: File) {
    if (!file) return
    if (objectPhotoUrl) URL.revokeObjectURL(objectPhotoUrl)
    setObjectPhotoUrl(URL.createObjectURL(file))
    setLoading(true)
    setProgress(null)
    setError('')
    try {
      setAnalysis(await analyzeFunPhoto(file, setProgress))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de préparer le FunLab pour cet objet.')
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  async function useWish(type: Exclude<FunWishType, 'fairground_quest'>) {
    if (!analysis || loading || usedWishes.includes(type)) return
    setLoading(true)
    setProgress(null)
    setError('')
    try {
      const result = await requestFunWish(analysis.scan_id, type, setProgress)
      setResults(current => [...current, result])
      setUsedWishes(current => [...current, type])
      setAnalysis({ ...analysis, questions_remaining: result.wishes_remaining })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ce vœu n’a pas pu être créé.')
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  async function launchQuest() {
    if (!analysis || !questType || !selfie.file || !missionOne.file || !missionTwo.file || loading) return
    setLoading(true)
    setProgress(null)
    setError('')
    try {
      const result = await requestFunQuest(
        analysis.scan_id,
        questType,
        selfie.file,
        missionOne.file,
        missionTwo.file,
        setProgress
      )
      const photos = [selfie.url, missionOne.url, missionTwo.url]
      setResults(current => [...current, { ...result, photos }])
      setUsedWishes(current => [...current, 'fairground_quest'])
      setAnalysis({ ...analysis, questions_remaining: result.wishes_remaining })
      setQuestType(null)
      setSelfie(EMPTY_PHOTO)
      setMissionOne(EMPTY_PHOTO)
      setMissionTwo(EMPTY_PHOTO)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La quête n’a pas pu être racontée.')
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  if (!analysis) return (
    <main className="screen fun-screen">
      <button className="back" type="button" onClick={goHome}>← Accueil</button>
      <p className="eyebrow">FunLab · Brocante + fête foraine</p>
      <h2>Ton objet t’accorde 3 vœux</h2>
      <p className="lead small">Photographie un objet de la brocante. BrocAI le transforme ensuite en personnage, star, légende… ou compagnon d’aventure dans la fête.</p>
      <label className="photo-drop fun-photo-drop">
        <span>🪄</span>
        <strong>{loading ? queueMessage(progress) : 'Photographier mon objet'}</strong>
        <small>Une seule photo suffit pour lancer les 5 possibilités.</small>
        <input disabled={loading} type="file" accept="image/*" capture="environment" onChange={event => void chooseObject(event.target.files?.[0])} />
      </label>
      {objectPhotoUrl && <div className="fun-object-preview"><img src={objectPhotoUrl} alt="Objet choisi pour le FunLab" /></div>}
      {loading && <div className="notice ai-queue-notice"><strong>{queueMessage(progress)}</strong><span>La photo envoyée au serveur est supprimée après l’analyse.</span></div>}
      {error && <p className="error">{error}</p>}
    </main>
  )

  if (questType && selectedQuest) return (
    <main className="screen wide fun-screen">
      <button className="back" type="button" disabled={loading} onClick={() => setQuestType(null)}>← Mes 5 vœux</button>
      <div className="fun-quest-head">
        <div><p className="eyebrow">🎡 Pars en quête · {selectedQuest.title}</p><h2>3 photos, puis une histoire</h2></div>
        <WishDots remaining={analysis.questions_remaining} />
      </div>
      <p className="lead small">Garde ton objet avec toi. Fais le selfie, suis les deux missions, puis BrocAI racontera votre mini-aventure. Compte environ 5 à 10 minutes.</p>
      <div className="fun-quest-steps">
        <PhotoStep number={1} title="Votre selfie" description="Toi + ton objet, quelque part dans la fête foraine." capture="user" value={selfie} onChange={file => replacePhoto(selfie, file, setSelfie)} />
        <PhotoStep number={2} title="Photo mission #1" description={selectedQuest.missionOne} capture="environment" value={missionOne} onChange={file => replacePhoto(missionOne, file, setMissionOne)} />
        <PhotoStep number={3} title="Photo mission #2" description={selectedQuest.missionTwo} capture="environment" value={missionTwo} onChange={file => replacePhoto(missionTwo, file, setMissionTwo)} />
      </div>
      <p className="fun-privacy">🔒 Le selfie et les deux photos servent uniquement à créer l’histoire et sont supprimés du serveur après traitement.</p>
      {loading && <div className="notice ai-queue-notice"><strong>{queueMessage(progress)}</strong><span>Tu peux rester sur cet écran pendant la création.</span></div>}
      {error && <p className="error">{error}</p>}
      <button className="primary" type="button" disabled={loading || !selfie.file || !missionOne.file || !missionTwo.file} onClick={() => void launchQuest()}>{loading ? 'BrocAI raconte…' : '✨ Raconte notre aventure'}</button>
    </main>
  )

  const exhausted = analysis.questions_remaining <= 0

  return (
    <main className="screen wide fun-screen">
      <button className="back" type="button" onClick={reset}>← Nouvel objet</button>
      <div className="fun-heading">
        <div><p className="eyebrow">FunLab · {analysis.name}</p><h2>Choisis jusqu’à 3 vœux</h2></div>
        <div className="fun-counter"><WishDots remaining={analysis.questions_remaining} /><strong>{analysis.questions_remaining} restant{analysis.questions_remaining > 1 ? 's' : ''}</strong></div>
      </div>
      <div className="fun-object-strip">
        {objectPhotoUrl && <img src={objectPhotoUrl} alt={analysis.name} />}
        <div><strong>{analysis.name}</strong><span>{analysis.description}</span></div>
      </div>

      {!exhausted ? (
        <div className="fun-wish-grid">
          {WISHES.map(wish => {
            const used = usedWishes.includes(wish.id)
            const isQuest = wish.id === 'fairground_quest'
            if (isQuest) return <article key={wish.id} className={`fun-wish-card quest ${used ? 'used' : ''}`}>
              <span className="fun-wish-icon">{wish.icon}</span>
              <strong>{wish.title}</strong>
              <small>{wish.description}</small>
              {used ? <em>✓ Vœu utilisé</em> : <>
                <span className="fun-quest-picker-title">Choisis ta mini-aventure ↓</span>
                <div className="fun-quest-picker">{QUESTS.map(quest => <button key={quest.id} type="button" disabled={loading} onClick={() => setQuestType(quest.id)}><b>{quest.icon} {quest.title}</b><i>{quest.description}</i></button>)}</div>
              </>}
            </article>
            return <button key={wish.id} className={`fun-wish-card ${used ? 'used' : ''}`} type="button" disabled={loading || used} onClick={() => void useWish(wish.id as Exclude<FunWishType, 'fairground_quest'>)}>
              <span className="fun-wish-icon">{wish.icon}</span>
              <strong>{wish.title}</strong>
              <small>{wish.description}</small>
              {used && <em>✓ Vœu utilisé</em>}
            </button>
          })}
        </div>
      ) : (
        <div className="empty fun-exhausted"><strong>✨ Ton objet a épuisé ses pouvoirs.</strong><span>Tu peux garder les résultats en capture d’écran, ou photographier un autre objet pour repartir avec 3 nouveaux vœux.</span><button className="primary empty-action" type="button" onClick={reset}>Photographier un autre objet</button></div>
      )}

      {loading && <div className="notice ai-queue-notice"><strong>{queueMessage(progress)}</strong><span>Un vœu réussi seulement consomme l’un de tes trois essais.</span></div>}
      {error && <p className="error">{error}</p>}

      {results.length > 0 && <section className="fun-results"><div className="fun-results-head"><p className="eyebrow">Tes créations</p><h3>À montrer, raconter ou garder en capture d’écran</h3></div>{results.map((result, index) => <article key={`${result.wish_type}-${index}`} className={`fun-result-card ${result.wish_type}`}>
        {result.photos && <div className="fun-triptych">{result.photos.map((url, photoIndex) => <img key={url} src={url} alt={`Souvenir ${photoIndex + 1} de la quête`} />)}</div>}
        {!result.photos && objectPhotoUrl && <img className="fun-result-object" src={objectPhotoUrl} alt={analysis.name} />}
        <div className="fun-result-copy"><span>{result.badge}</span><h3>{result.title}</h3><strong>{result.subtitle}</strong><p>{result.story}</p></div>
      </article>)}</section>}
    </main>
  )
}

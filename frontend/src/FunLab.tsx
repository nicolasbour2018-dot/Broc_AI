import { useMemo, useState } from 'react'
import { analyzeFunPhoto, requestFunQuest, requestFunWish } from './api'
import type { AiJobProgress, AssistantAnalysis, FunQuestType, FunWishResult, FunWishType } from './types'
import { AiWait, PhotoPicker } from './ui/Ai'
import { Icon } from './ui/icons'
import type { IconName } from './ui/icons'
import { goBack } from './navigation'
import { Alert, Kicker, Page, TopBar } from './ui/Page'
import './funlab.css'

type ResultCard = FunWishResult & { photos?: string[] }
type QuestPhoto = { file: File | null; url: string }

type WishMeta = {
  id: FunWishType
  icon: IconName
  title: string
  description: string
}

type QuestMeta = {
  id: FunQuestType
  title: string
  description: string
  missionOne: string
  missionTwo: string
}

const WISHES: WishMeta[] = [
  {
    id: 'bring_to_life',
    icon: 'sparkle',
    title: 'Donne-moi vie',
    description: 'Ton objet devient un personnage avec un nom, un caractère et une mini-réplique.'
  },
  {
    id: 'movie_star',
    icon: 'star',
    title: 'Fais de moi une star',
    description: 'Une affiche imaginaire : titre, slogan et premier rôle pour ton objet.'
  },
  {
    id: 'imaginary_past',
    icon: 'book',
    title: 'Raconte mon passé',
    description: 'Une mini-biographie totalement inventée, comme si ton objet avait déjà vécu mille vies.'
  },
  {
    id: 'secret_power',
    icon: 'bolt',
    title: 'Mon pouvoir secret',
    description: 'Un super-pouvoir absurde, sa faiblesse et une punchline.'
  },
  {
    id: 'fairground_quest',
    icon: 'compass',
    title: 'Pars en quête',
    description: 'Emmène ton objet à la fête foraine : un selfie, deux photos-missions, puis BrocAI raconte votre aventure.'
  }
]

const QUESTS: QuestMeta[] = [
  {
    id: 'grand_tour',
    title: 'La grande aventure',
    description: 'Trouve l’attraction qui ressemble le plus à ton objet, puis son endroit préféré dans la fête.',
    missionOne: 'Photographie l’attraction qui ressemble le plus à la personnalité de ton objet.',
    missionTwo: 'Photographie l’endroit où ton objet voudrait terminer sa soirée.'
  },
  {
    id: 'secret_mission',
    title: 'Mission secrète',
    description: 'Pars à la recherche de deux indices dans la fête et laisse BrocAI relier les preuves.',
    missionOne: 'Trouve quelque chose de plus bruyant ou plus agité que ton objet.',
    missionTwo: 'Trouve sa couleur jumelle quelque part dans la fête.'
  },
  {
    id: 'fair_star',
    title: 'Star de la fête',
    description: 'Fabrique le décor de rêve de ton objet, puis trouve-lui un rival ou un complice.',
    missionOne: 'Photographie le décor parfait pour l’affiche de ton objet.',
    missionTwo: 'Photographie quelque chose qui pourrait être son rival ou son meilleur complice.'
  }
]

const EMPTY_PHOTO: QuestPhoto = { file: null, url: '' }

function WishDots({ remaining }: { remaining: number }) {
  return (
    <div className="fun-wish-dots" role="img" aria-label={`${remaining} vœu${remaining > 1 ? 'x' : ''} restant${remaining > 1 ? 's' : ''}`}>
      {[0, 1, 2].map(index => <span key={index} className={index < remaining ? 'active' : ''}><Icon name="sparkle" size={18} /></span>)}
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
      <span className="fun-photo-copy"><strong>{title}</strong><small>{description}</small></span>
      {value.url ? <img src={value.url} alt="Aperçu de la mission" /> : <span className="fun-photo-cta"><Icon name="camera" size={20} /> Prendre la photo</span>}
      <input className="sr-only" type="file" accept="image/*" capture={capture} onChange={event => {
        const file = event.target.files?.[0]
        if (file) onChange(file)
      }} />
    </label>
  )
}

export default function FunLab() {
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
    <Page className="fun-screen">
      <TopBar onBack={() => goBack({ name: 'home' })} />
      <Kicker>FunLab · le jeu de la brocante</Kicker>
      <h1 className="page-title">Ton objet t’accorde 3 vœux</h1>
      <img className="fun-hero" src="/images/home/frame.webp" alt="" />
      <ol className="steps">
        <li><span className="steps__num">1</span><span><strong>Photographie un objet</strong> de la brocante.</span></li>
        <li><span className="steps__num">2</span><span><strong>Choisis 3 vœux parmi 5</strong> : il devient un personnage, une star, une légende…</span></li>
        <li><span className="steps__num">3</span><span><strong>Garde tes cartes</strong> en capture d’écran et montre-les.</span></li>
      </ol>
      {loading ? (
        <AiWait progress={progress} label="Préparation de ton objet" photoUrl={objectPhotoUrl} note="La photo est supprimée du serveur après l’analyse." />
      ) : (
        <PhotoPicker onFile={file => void chooseObject(file)} cameraLabel="Photographier mon objet" />
      )}
      {error && <Alert tone="error" title="Ça n’a pas marché">{error}</Alert>}
    </Page>
  )

  if (questType && selectedQuest) return (
    <Page wide className="fun-screen">
      <button className="btn-link" type="button" disabled={loading} onClick={() => setQuestType(null)}><Icon name="back" size={20} /> Mes 5 vœux</button>
      <div className="fun-quest-head">
        <div><Kicker>Pars en quête · {selectedQuest.title}</Kicker><h1 className="page-title">3 photos, puis une histoire</h1></div>
        <WishDots remaining={analysis.questions_remaining} />
      </div>
      <p className="lede">Garde ton objet avec toi. Fais le selfie, suis les deux missions, puis BrocAI racontera votre mini-aventure. Compte 5 à 10 minutes.</p>
      <div className="fun-quest-steps">
        <PhotoStep number={1} title="Votre selfie" description="Toi + ton objet, quelque part dans la fête foraine." capture="user" value={selfie} onChange={file => replacePhoto(selfie, file, setSelfie)} />
        <PhotoStep number={2} title="Photo mission 1" description={selectedQuest.missionOne} capture="environment" value={missionOne} onChange={file => replacePhoto(missionOne, file, setMissionOne)} />
        <PhotoStep number={3} title="Photo mission 2" description={selectedQuest.missionTwo} capture="environment" value={missionTwo} onChange={file => replacePhoto(missionTwo, file, setMissionTwo)} />
      </div>
      <p className="muted-line">Le selfie et les deux photos servent uniquement à créer l’histoire. Ils sont supprimés du serveur après.</p>
      {loading && <AiWait progress={progress} label="BrocAI écrit votre aventure" note="Tu peux rester sur cet écran pendant la création." compact />}
      {error && <Alert tone="error">{error}</Alert>}
      <button className="btn btn--primary" type="button" disabled={loading || !selfie.file || !missionOne.file || !missionTwo.file} onClick={() => void launchQuest()}><Icon name="sparkle" /> {loading ? 'BrocAI raconte…' : 'Raconte notre aventure'}</button>
    </Page>
  )

  const exhausted = analysis.questions_remaining <= 0

  return (
    <Page wide className="fun-screen">
      <TopBar onBack={() => goBack({ name: 'home' })} />
      <button className="btn-link" type="button" onClick={reset}><Icon name="camera" size={20} /> Nouvel objet</button>
      <div className="fun-heading">
        <div><Kicker>FunLab · {analysis.name}</Kicker><h1 className="page-title">Choisis jusqu’à 3 vœux</h1></div>
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
              <span className="fun-wish-icon"><Icon name={wish.icon} size={26} /></span>
              <strong>{wish.title}</strong>
              <small>{wish.description}</small>
              {used ? <em><Icon name="check" size={18} /> Vœu utilisé</em> : <>
                <span className="fun-quest-picker-title">Choisis ta mini-aventure</span>
                <div className="fun-quest-picker">{QUESTS.map(quest => <button key={quest.id} type="button" disabled={loading} onClick={() => setQuestType(quest.id)}><b>{quest.title}</b><i>{quest.description}</i></button>)}</div>
              </>}
            </article>
            return <button key={wish.id} className={`fun-wish-card ${used ? 'used' : ''}`} type="button" disabled={loading || used} onClick={() => void useWish(wish.id as Exclude<FunWishType, 'fairground_quest'>)}>
              <span className="fun-wish-icon"><Icon name={wish.icon} size={26} /></span>
              <strong>{wish.title}</strong>
              <small>{wish.description}</small>
              {used && <em><Icon name="check" size={18} /> Vœu utilisé</em>}
            </button>
          })}
        </div>
      ) : (
        <div className="empty-state"><strong>Ton objet a épuisé ses pouvoirs.</strong><span>Garde tes cartes en capture d’écran, ou photographie un autre objet pour 3 nouveaux vœux.</span><button className="btn btn--primary btn--inline" type="button" onClick={reset}><Icon name="camera" size={20} /> Photographier un autre objet</button></div>
      )}

      {loading && <AiWait progress={progress} label="BrocAI prépare ton vœu" note="Un vœu ne compte que s’il réussit." compact />}
      {error && <Alert tone="error">{error}</Alert>}

      {results.length > 0 && <section className="fun-results"><div className="fun-results-head"><Kicker>Tes créations</Kicker><h2>À montrer, raconter ou garder en capture d’écran</h2></div>{results.map((result, index) => <article key={`${result.wish_type}-${index}`} className={`fun-result-card ${result.wish_type}`}>
        {result.photos && <div className="fun-triptych">{result.photos.map((url, photoIndex) => <img key={url} src={url} alt={`Souvenir ${photoIndex + 1} de la quête`} />)}</div>}
        {!result.photos && objectPhotoUrl && <img className="fun-result-object" src={objectPhotoUrl} alt={analysis.name} />}
        <div className="fun-result-copy"><span>{result.badge}</span><h3>{result.title}</h3><strong>{result.subtitle}</strong><p>{result.story}</p></div>
      </article>)}</section>}
    </Page>
  )
}

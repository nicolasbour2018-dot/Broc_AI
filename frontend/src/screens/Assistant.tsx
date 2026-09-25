import { FormEvent, useEffect, useRef, useState } from 'react'
import { analyzeAssistantPhoto, askAssistantQuestion } from '../api'
import { formatPrice } from '../format'
import type { AiJobProgress, AssistantAnalysis, AssistantQuestionType } from '../types'
import { AiWait, ConfidenceMeter, PhotoPicker } from '../ui/Ai'
import { CATEGORY_DISPLAY, Icon } from '../ui/icons'
import type { IconName } from '../ui/icons'
import { Alert, Kicker, Page } from '../ui/Page'
import { Tip } from '../ui/Tip'

const MAX_QUESTIONS = 3

// Each quick question says what comes back, and whether the stand price helps (it does for the deal
// and negotiation answers, see `_cached_assistant_answer` in the backend).
const QUESTIONS: { type: Exclude<AssistantQuestionType, 'free'>; label: string; result: string; icon: IconName; usesPrice: boolean }[] = [
  { type: 'good_deal', label: 'Est-ce un bon prix ?', result: 'Un avis qui compare le prix du stand à l’estimation.', icon: 'euro', usesPrice: true },
  { type: 'tell_more', label: 'Racontez-m’en plus', result: 'Son histoire, son style, son époque probable.', icon: 'book', usesPrice: false },
  { type: 'negotiate', label: 'Aidez-moi à négocier', result: 'Un prix à proposer et une phrase à dire au vendeur.', icon: 'handshake', usesPrice: true }
]

type Answer = { label: string; answer: string }

export default function Assistant() {
  const [analysis, setAnalysis] = useState<AssistantAnalysis | null>(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [displayedPrice, setDisplayedPrice] = useState('')
  const [freeQuestion, setFreeQuestion] = useState('')
  const [answers, setAnswers] = useState<Answer[]>([])
  const [loading, setLoading] = useState(false)
  const [asking, setAsking] = useState('')
  const [progress, setProgress] = useState<AiJobProgress | null>(null)
  const [error, setError] = useState('')
  const lastAnswer = useRef<HTMLElement>(null)

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }, [photoUrl])
  useEffect(() => { lastAnswer.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [answers.length])

  function reset() {
    setAnalysis(null)
    setPhotoUrl('')
    setDisplayedPrice('')
    setFreeQuestion('')
    setAnswers([])
    setProgress(null)
    setError('')
    window.scrollTo(0, 0)
  }

  async function choosePhoto(file: File) {
    setPhotoUrl(URL.createObjectURL(file))
    setAnalysis(null)
    setAnswers([])
    setError('')
    setProgress(null)
    setLoading(true)
    try {
      setAnalysis(await analyzeAssistantPhoto(file, setProgress))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'L’analyse n’a pas abouti.')
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  async function ask(type: AssistantQuestionType, label: string, question?: string) {
    if (!analysis || analysis.questions_remaining <= 0 || loading) return
    setLoading(true)
    setAsking(label)
    setProgress(null)
    setError('')
    const price = displayedPrice.trim() ? Number(displayedPrice.replace(',', '.')) : undefined
    try {
      const result = await askAssistantQuestion(analysis.scan_id, type, question, Number.isFinite(price) ? price : undefined, setProgress)
      setAnswers(current => [...current, { label, answer: result.answer }])
      setAnalysis({ ...analysis, questions_remaining: result.questions_remaining })
      if (type === 'free') setFreeQuestion('')
    } catch (err) {
      setError(err instanceof Error ? `${err.message} Votre question n’a pas été comptée.` : 'La réponse n’a pas abouti. Votre question n’a pas été comptée.')
    } finally {
      setLoading(false)
      setAsking('')
      setProgress(null)
    }
  }

  function submitFree(e: FormEvent) {
    e.preventDefault()
    const cleaned = freeQuestion.trim()
    if (cleaned) void ask('free', cleaned, cleaned)
  }

  if (!analysis) return (
    <Page className="assistant">
      <Kicker>Analyser un objet</Kicker>
      <h1 className="page-title">Un objet vous intrigue ?</h1>
      <ol className="steps">
        <li><span className="steps__num">1</span><span><strong>Photographiez-le</strong> sur le stand, bien en face.</span></li>
        <li><span className="steps__num">2</span><span><strong>BrocAI l’identifie</strong> et donne un repère de prix.</span></li>
        <li><span className="steps__num">3</span><span><strong>Posez jusqu’à 3 questions</strong> : bon prix, histoire, négociation.</span></li>
      </ol>
      {loading ? (
        <AiWait progress={progress} photoUrl={photoUrl} label="Analyse de la photo" note="La photo est supprimée du serveur dès que l’analyse est prête." />
      ) : (
        <PhotoPicker onFile={file => void choosePhoto(file)} cameraLabel="Photographier l’objet" />
      )}
      {error && <Alert tone="error" title="L’analyse n’a pas abouti">{error} Vous pouvez réessayer avec une autre photo.</Alert>}
    </Page>
  )

  const remaining = analysis.questions_remaining
  const used = MAX_QUESTIONS - remaining
  const priceLabel = analysis.price_range_eur
    ? `${analysis.price_range_eur.min} – ${analysis.price_range_eur.max} €`
    : analysis.estimated_price_eur !== null ? `environ ${formatPrice(analysis.estimated_price_eur)}` : 'Pas d’estimation possible'

  return (
    <Page className="assistant">
      <button type="button" className="btn-link assistant__restart" onClick={reset}><Icon name="camera" size={20} /> Analyser un autre objet</button>

      <article className="analysis-card">
        {photoUrl && <img className="analysis-card__photo" src={photoUrl} alt={analysis.name} />}
        <div className="analysis-card__body">
          <span className="category-label"><Icon name={CATEGORY_DISPLAY[analysis.category].icon} size={20} /> {analysis.category}</span>
          <h1>{analysis.name}</h1>
          <p>{analysis.description}</p>
          <dl className="facts">
            <div><dt>Repère de prix</dt><dd className="facts__price">{priceLabel}</dd></div>
            <div><dt>Contexte</dt><dd>{analysis.context_note}</dd></div>
          </dl>
          <ConfidenceMeter confidence={analysis.confidence} />
          <p className="caution"><Icon name="warning" size={20} /> {analysis.caution}</p>
        </div>
      </article>

      <section className="section questions" aria-labelledby="questions-title">
        <div className="section__head">
          <div>
            <h2 id="questions-title">Posez jusqu’à 3 questions sur cet objet</h2>
            <p className="section__hint">{remaining > 0 ? `Il vous reste ${remaining} question${remaining > 1 ? 's' : ''}.` : 'Vous avez utilisé vos 3 questions.'}</p>
          </div>
          <span className="question-dots" aria-hidden="true">{Array.from({ length: MAX_QUESTIONS }, (_, index) => <span key={index} className={index < used ? 'is-used' : ''} />)}</span>
        </div>

        {answers.length > 0 && (
          <div className="answers" aria-live="polite">
            {answers.map((item, index) => (
              <article key={`${item.label}-${index}`} className="answer" ref={index === answers.length - 1 ? lastAnswer : undefined}>
                <h3><Icon name="chat" size={20} /> {item.label}</h3>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
        )}

        {remaining > 0 ? (
          <>
            {answers.length === 0 && <Tip id="assistant-questions">Chaque question donne une réponse courte. Après 3 questions, photographiez un autre objet pour recommencer.</Tip>}
            <label className="field">
              <span className="field__label">Prix demandé sur le stand <span className="field__optional">(facultatif)</span></span>
              <span className="field__input-euro"><input inputMode="decimal" type="number" min="0" step="0.5" placeholder="Ex. 20" value={displayedPrice} onChange={e => setDisplayedPrice(e.target.value)} /><span aria-hidden="true">€</span></span>
              <small className="field__help">Il sert aux questions « Est-ce un bon prix ? » et « Aidez-moi à négocier ».</small>
            </label>
            <div className="question-list">
              {QUESTIONS.map(question => (
                <button key={question.type} type="button" className="question-card" disabled={loading} onClick={() => void ask(question.type, question.label)}>
                  <span className="question-card__icon"><Icon name={question.icon} size={26} /></span>
                  <span>
                    <strong>{question.label}</strong>
                    <small>{question.result}{question.usesPrice && !displayedPrice.trim() ? ' Plus précis avec le prix du stand.' : ''}</small>
                  </span>
                </button>
              ))}
            </div>
            <form className="free-question" onSubmit={submitFree}>
              <label className="field">
                <span className="field__label">Ou posez votre propre question</span>
                <textarea disabled={loading} maxLength={240} rows={2} placeholder="Ex. Comment savoir si c’est une reproduction ?" value={freeQuestion} onChange={e => setFreeQuestion(e.target.value)} />
              </label>
              <button className="btn btn--secondary" disabled={loading || !freeQuestion.trim()} type="submit">Envoyer ma question</button>
            </form>
          </>
        ) : (
          <div className="empty-state">
            <strong>Vos 3 questions sont utilisées pour cet objet.</strong>
            <span>Photographiez un autre objet pour en poser 3 nouvelles.</span>
            <button type="button" className="btn btn--primary btn--inline" onClick={reset}><Icon name="camera" size={20} /> Analyser un autre objet</button>
          </div>
        )}

        {loading && <AiWait progress={progress} label={`Réponse à « ${asking} »`} note="Vous pouvez rester sur cette page pendant l’attente." compact />}
        {error && <Alert tone="error">{error}</Alert>}
      </section>
    </Page>
  )
}

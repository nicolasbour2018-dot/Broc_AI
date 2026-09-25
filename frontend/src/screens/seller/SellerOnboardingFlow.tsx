import { FormEvent, useState } from 'react'
import { trackEvent } from '../../api'
import { saveSellerOnboarding } from '../../sellerOnboarding'
import type { SellerOnboarding } from '../../sellerOnboarding'
import { Icon } from '../../ui/icons'
import type { IconName } from '../../ui/icons'
import { Kicker, Page } from '../../ui/Page'
import { StandBadge } from '../../ui/Tags'

type OnboardingStep = 'details' | 'guide' | 'confirm'

export function trackOnboarding(action: string) {
  void trackEvent('feature_clicked', { feature: 'seller_onboarding', action })
}

const GUIDE: { icon: IconName; title: string; text: string }[] = [
  { icon: 'camera', title: 'Photographiez vos objets', text: 'À la suite, directement sur votre stand.' },
  { icon: 'sparkle', title: 'BrocAI prépare les annonces', text: 'Titre, description et prix proposés : vous corrigez ce que vous voulez.' },
  { icon: 'check', title: 'Publiez, puis marquez « vendu »', text: 'Les visiteurs voient vos objets et votre numéro de stand. Un geste quand un objet part.' }
]

// Stand number and optional alias, a one-screen guide, then an explicit confirmation of the number.
// Only the confirmation stores the onboarding on this device.
export default function SellerOnboardingFlow({ onConfirmed }: { onConfirmed: (value: SellerOnboarding) => void }) {
  const [step, setStep] = useState<OnboardingStep>('details')
  const [stand, setStand] = useState('')
  const [alias, setAlias] = useState('')

  function submitDetails(e: FormEvent) {
    e.preventDefault()
    if (!stand.trim()) return
    setStand(stand.trim())
    trackOnboarding('details_submitted')
    setStep('guide')
  }

  if (step === 'guide') return (
    <Page className="onboarding">
      <Kicker>Ouvrir mon stand · étape 2 sur 3</Kicker>
      <h1 className="page-title">Comment ça marche</h1>
      <ol className="guide">
        {GUIDE.map(item => (
          <li key={item.title}>
            <span className="guide__icon"><Icon name={item.icon} size={28} /></span>
            <span><strong>{item.title}</strong><small>{item.text}</small></span>
          </li>
        ))}
      </ol>
      <button className="btn btn--primary" type="button" onClick={() => { trackOnboarding('validated'); setStep('confirm') }}>J’ai compris</button>
      <button className="btn-link btn-link--center" type="button" onClick={() => setStep('details')}>Modifier le stand ou le pseudo</button>
    </Page>
  )

  if (step === 'confirm') return (
    <Page className="onboarding">
      <Kicker>Ouvrir mon stand · étape 3 sur 3</Kicker>
      <h1 className="page-title">C’est bien votre stand ?</h1>
      <div className="confirm-stand">
        <StandBadge stand={stand} size="xl" />
        {alias.trim() && <span>Pseudo : {alias.trim()}</span>}
      </div>
      <p className="lede">Vérifiez le numéro affiché sur votre emplacement : ce téléphone gérera ce stand et ses annonces.</p>
      <button className="btn btn--primary" type="button" onClick={() => { trackOnboarding('confirmed'); onConfirmed(saveSellerOnboarding(stand, alias)) }}>Oui, c’est le stand {stand}</button>
      <button className="btn btn--secondary" type="button" onClick={() => { trackOnboarding('number_changed'); setStep('details') }}>Changer de numéro</button>
    </Page>
  )

  return (
    <Page className="onboarding">
      <Kicker>Ouvrir mon stand · étape 1 sur 3</Kicker>
      <h1 className="page-title">Quel est votre numéro de stand ?</h1>
      <p className="lede">Il s’affiche sur chacune de vos annonces : c’est ainsi que les visiteurs vous trouvent.</p>
      <form className="form" onSubmit={submitDetails}>
        <label className="field">
          <span className="field__label">Numéro de stand</span>
          <input className="input--big" autoFocus required maxLength={40} placeholder="Ex. 42" value={stand} onChange={e => setStand(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Pseudo vendeur <span className="field__optional">(facultatif)</span></span>
          <input maxLength={80} placeholder="Ex. Chez Martine" value={alias} onChange={e => setAlias(e.target.value)} />
          <small className="field__help">Affiché sur vos annonces, modifiable pour chaque objet.</small>
        </label>
        <button className="btn btn--primary" type="submit">Continuer</button>
      </form>
      <p className="muted-line">Pas de compte à créer : le numéro de stand suffit.</p>
    </Page>
  )
}

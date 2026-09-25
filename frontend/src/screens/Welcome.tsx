import { Brand, EventLine } from '../ui/Page'
import { Icon } from '../ui/icons'

export type WelcomeChoice = 'visitor' | 'seller' | 'skip'

// First launch: one question, two big answers. Each answer shapes what the app shows next;
// nothing here needs to be read to get going.
export default function Welcome({ choose }: { choose: (choice: WelcomeChoice) => void }) {
  return (
    <main className="welcome" aria-labelledby="welcome-title">
      <header className="welcome__head">
        <Brand size="lg" />
        <EventLine />
      </header>
      <h1 id="welcome-title">Bienvenue ! Vous êtes…</h1>
      <div className="welcome__choices">
        <button type="button" className="welcome-choice" onClick={() => choose('visitor')}>
          <img src="/images/home/chair.webp" alt="" />
          <span className="welcome-choice__copy">
            <strong>Je viens chiner</strong>
            <span>Trouver des objets, savoir à quel stand ils sont, demander un avis sur un prix.</span>
          </span>
          <Icon name="chevron" className="welcome-choice__chevron" />
        </button>
        <button type="button" className="welcome-choice" onClick={() => choose('seller')}>
          <img src="/images/home/lamp.webp" alt="" />
          <span className="welcome-choice__copy">
            <strong>Je tiens un stand</strong>
            <span>Mettre mes objets en ligne en quelques photos, sans créer de compte.</span>
          </span>
          <Icon name="chevron" className="welcome-choice__chevron" />
        </button>
      </div>
      <button type="button" className="btn-link welcome__skip" onClick={() => choose('skip')}>Passer</button>
    </main>
  )
}

import { FormEvent, useRef, useState } from 'react'
import { trackEvent } from './api'
import './showroom.css'

type DemoKey = 'rocky' | 'basket' | 'garage' | 'jarvis'
type ChatMessage = { role: 'visitor' | 'assistant'; text: string }

type DemoMeta = {
  name: string
  eyebrow: string
  description: string
  promise: string
  icon: string
  features: Array<{ id: string; label: string }>
}

const DEMOS: Record<DemoKey, DemoMeta> = {
  rocky: {
    name: 'Rocky',
    eyebrow: 'Assistant emploi',
    description: 'Veille, matching, candidatures et assistant pour transformer une recherche d’emploi en pipeline pilotable.',
    promise: 'De l’offre détectée à la prochaine action utile.',
    icon: '↗',
    features: [
      { id: 'dashboard', label: 'Cockpit' },
      { id: 'applications', label: 'Candidatures' },
      { id: 'statistics', label: 'Statistiques' },
      { id: 'chat', label: 'Assistant Rocky' }
    ]
  },
  basket: {
    name: 'Basket Lab',
    eyebrow: 'Data sport',
    description: 'Lecture rapide d’une équipe, profils joueurs, tendances et comparaison pour aider le staff à décider.',
    promise: 'Des données de match lisibles en quelques secondes.',
    icon: '◉',
    features: [
      { id: 'dashboard', label: 'Équipe' },
      { id: 'players', label: 'Joueurs' },
      { id: 'match', label: 'Match' },
      { id: 'compare', label: 'Comparer' }
    ]
  },
  garage: {
    name: 'Garage Gildoni',
    eyebrow: 'Application métier automobile',
    description: 'Prédevis, espace client, atelier et gestion réunis dans une application locale adaptée au fonctionnement du garage.',
    promise: 'Du premier prédevis au suivi de réparation et au règlement.',
    icon: '🔧',
    features: [
      { id: 'dashboard', label: 'Accueil & prédevis' },
      { id: 'workshop', label: 'Atelier' },
      { id: 'client', label: 'Espace client' },
      { id: 'admin', label: 'Gestion' }
    ]
  },
  jarvis: {
    name: 'Jarvis',
    eyebrow: 'Assistant quotidien',
    description: 'Agenda familial, maison, courses et routines dans un assistant futuriste entièrement simulé.',
    promise: 'Un cockpit familial sans connexion à des services réels.',
    icon: '✦',
    features: [
      { id: 'dashboard', label: 'Aujourd’hui' },
      { id: 'agenda', label: 'Agenda' },
      { id: 'home', label: 'Maison' },
      { id: 'assistant', label: 'Assistant' }
    ]
  }
}

const ROCKY_MATCHES = [
  { role: 'Data Analyst · Impact', company: 'Terranova', score: 92, detail: 'SQL · Python · BI · hybride' },
  { role: 'Data Ops Junior', company: 'Novadata', score: 86, detail: 'Python · automatisation · remote' },
  { role: 'Automation Specialist', company: 'Flow Studio', score: 82, detail: 'APIs · n8n · agents' }
]

const PLAYERS = [
  { name: 'M. Diallo', role: 'Meneur', pts: 18.6, eff: 22.1, trend: '+12%' },
  { name: 'L. Bernard', role: 'Arrière', pts: 15.2, eff: 18.7, trend: '+4%' },
  { name: 'A. Costa', role: 'Ailier', pts: 12.9, eff: 17.4, trend: '+9%' },
  { name: 'T. Morel', role: 'Pivot', pts: 10.1, eff: 19.2, trend: '-2%' }
]

const GARAGE_JOBS = [
  { time: '09:00', car: 'Peugeot 208', job: 'Révision + filtres', status: 'En cours' },
  { time: '10:30', car: 'Renault Clio', job: 'Diagnostic freinage', status: 'À contrôler' },
  { time: '13:30', car: 'Toyota Yaris', job: 'Pneus avant', status: 'Planifié' },
  { time: '15:00', car: 'Citroën C3', job: 'Batterie', status: 'Planifié' }
]

const DEFAULT_ROCKY_CHAT: ChatMessage[] = [
  { role: 'assistant', text: 'Je peux résumer les offres fictives, prioriser les candidatures ou préparer une prochaine action.' }
]

const DEFAULT_JARVIS_CHAT: ChatMessage[] = [
  { role: 'assistant', text: 'Mode démonstration actif. Je peux organiser la journée ou simuler une routine, sans agir sur aucun service réel.' }
]

function rockyReply(input: string): string {
  const value = input.toLowerCase()
  if (value.includes('offre') || value.includes('match')) return 'La priorité fictive est Terranova à 92 % : compétences proches, mission impact et peu d’écart à combler. Prochaine action simulée : adapter les 3 premières lignes du CV.'
  if (value.includes('candid') || value.includes('relance')) return 'Tu as 3 candidatures fictives actives. La relance la plus utile aujourd’hui concerne Novadata, envoyée il y a 6 jours.'
  if (value.includes('aujourd') || value.includes('prior')) return 'Plan fictif du jour : 1 candidature ciblée, 1 relance, puis 20 minutes pour enrichir le portfolio avec BrocAI.'
  return 'Dans cette démo, je réponds uniquement à partir des offres et candidatures fictives affichées. Essaie “quelle offre prioriser ?” ou “quelle relance aujourd’hui ?”.'
}

function jarvisReply(input: string): string {
  const value = input.toLowerCase()
  if (value.includes('agenda') || value.includes('journ')) return 'Journée fictive : école à 8h30, déjeuner à 12h30, activité à 16h30 et courses à 18h00. Aucun calendrier réel n’est connecté.'
  if (value.includes('course')) return 'Liste simulée : lait, pâtes, tomates, croquettes et café. Je peux la réorganiser, mais rien n’est envoyé à un magasin.'
  if (value.includes('maison') || value.includes('lumi')) return 'La maison affichée est un décor de démonstration. Tu peux tester les interrupteurs ici sans piloter aucun appareil réel.'
  if (value.includes('routine')) return 'Routine fictive “départ école” : météo résumée, sacs vérifiés, lumières coupées et rappel des clés — uniquement simulé dans cette interface.'
  return 'Je suis en mode démonstration : je peux raisonner sur l’agenda, la maison et les routines fictives, sans exécuter d’action externe.'
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="showroom-stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function RockyView({ feature, onFeature }: { feature: string; onFeature: (feature: string, action?: string) => void }) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_ROCKY_CHAT)
  const [cockpitView, setCockpitView] = useState<'suggestions' | 'new' | 'enrichment' | 'mine' | 'flow'>('suggestions')
  const [watchRun, setWatchRun] = useState(false)
  const [selectedApplication, setSelectedApplication] = useState(0)
  const chatStarted = useRef(false)

  const applications = [
    { id: 18, company: 'Terranova', role: 'Data Analyst · Impact', status: 'PRÉPARÉE', score: 92, date: '18/09/2026' },
    { id: 17, company: 'Novadata', role: 'Data Ops Junior', status: 'CANDIDATURE ENVOYÉE', score: 86, date: '12/09/2026' },
    { id: 14, company: 'GreenMetrics', role: 'Assistant Data', status: 'ENTRETIEN', score: 84, date: '10/09/2026' }
  ]

  function send(e: FormEvent) {
    e.preventDefault()
    const cleaned = input.trim()
    if (!cleaned) return
    const next = [...messages, { role: 'visitor' as const, text: cleaned }, { role: 'assistant' as const, text: rockyReply(cleaned) }]
    setMessages(next)
    setInput('')
    if (!chatStarted.current) {
      chatStarted.current = true
      void trackEvent('chat_started', { demo: 'rocky' })
    }
    void trackEvent('message_count', { demo: 'rocky', count: next.length - 1 })
  }

  if (feature === 'applications') return (
    <section className="rocky-showcase">
      <div className="rocky-kicker-demo">Suivi & candidatures</div>
      <h1 className="rocky-page-title">Candidatures</h1>
      <p className="rocky-page-caption">Pilotage des dossiers, retours recruteurs et prochaines actions.</p>

      <div className="rocky-metrics-grid rocky-metrics-apps">
        <div><span>Offres suivies</span><strong>12</strong></div>
        <div><span>Dossiers</span><strong>3</strong></div>
        <div><span>Envoyées</span><strong>2</strong></div>
        <div><span>Réponses</span><strong>1</strong></div>
        <div><span>Entretiens</span><strong>1</strong></div>
        <div><span>Taux de réponse</span><strong>50 %</strong></div>
      </div>

      <div className="rocky-section-head"><div><span>Dossiers récents</span><strong>3 candidatures</strong></div><small>utilise les cartes pour parcourir la démo</small></div>
      <div className="rocky-application-grid">
        {applications.map((application, index) => (
          <button
            key={application.id}
            type="button"
            className={selectedApplication === index ? 'active' : ''}
            onClick={() => { setSelectedApplication(index); onFeature('applications', 'select_application') }}
          >
            <small>#{application.id} · {application.date}</small>
            <strong>{application.company}</strong>
            <span>{application.role}</span>
            <em>{application.status} · score {application.score} %</em>
            <b>{selectedApplication === index ? 'Dossier ouvert' : 'Voir le dossier'}</b>
          </button>
        ))}
      </div>

      <div className="rocky-two-columns">
        <div className="rocky-card-panel">
          <span className="rocky-small-label">Dossier sélectionné</span>
          <h3>{applications[selectedApplication].company} · {applications[selectedApplication].role}</h3>
          <div className="rocky-status-line"><span>Statut</span><strong>{applications[selectedApplication].status}</strong></div>
          <div className="rocky-status-line"><span>Matching</span><strong>{applications[selectedApplication].score} %</strong></div>
          <button type="button" className="rocky-primary-button" onClick={() => onFeature('applications', 'prepare_application')}>Préparer / revoir le dossier</button>
        </div>
        <div className="rocky-card-panel rocky-mail-card">
          <span className="rocky-small-label">File Gmail simulée</span>
          <h3>1 réponse à vérifier</h3>
          <p><strong>Novadata</strong> · “Suite à votre candidature”</p>
          <p>Classification fictive : <b>ENTRETIEN</b> · confiance 94 %</p>
          <button type="button" onClick={() => onFeature('applications', 'review_email')}>Voir l’e-mail simulé</button>
        </div>
      </div>
    </section>
  )

  if (feature === 'statistics') return (
    <section className="rocky-showcase">
      <div className="rocky-kicker-demo">Mesure & progression</div>
      <h1 className="rocky-page-title">Statistiques</h1>
      <p className="rocky-page-caption">Un bilan visuel du flux d’offres jusqu’aux retours des recruteurs.</p>

      <div className="rocky-metrics-grid rocky-metrics-stats">
        <div><span>Offres suivies</span><strong>12</strong></div>
        <div><span>Dossiers</span><strong>3</strong></div>
        <div><span>Envoyées</span><strong>2</strong></div>
        <div><span>Réponses</span><strong>1</strong></div>
        <div><span>Entretiens</span><strong>1</strong></div>
        <div><span>Taux de réponse</span><strong>50 %</strong></div>
        <div><span>Délai de réponse</span><strong>4,5 j</strong></div>
      </div>

      <div className="rocky-stat-layout">
        <div className="rocky-card-panel">
          <span className="rocky-small-label">Entonnoir</span>
          <h3>Du dossier à l’entretien</h3>
          <div className="rocky-funnel">
            {[['Préparées', 3], ['Envoyées', 2], ['Réponses', 1], ['Entretiens', 1], ['Offres', 0]].map(([label, value]) => (
              <div key={String(label)}><span>{label}</span><i style={{ width: `${Math.max(8, Number(value) * 28)}%` }} /><strong>{value}</strong></div>
            ))}
          </div>
        </div>
        <div className="rocky-card-panel">
          <span className="rocky-small-label">Distribution du matching</span>
          <h3>Scores Rocky</h3>
          <div className="rocky-histogram">{[28, 42, 58, 82, 96, 70, 45, 22].map((height, index) => <i key={index} style={{ height: `${height}px` }} />)}</div>
          <div className="rocky-chart-axis"><span>60 %</span><span>70 %</span><span>80 %</span><span>90 %+</span></div>
        </div>
      </div>
    </section>
  )

  if (feature === 'chat') return (
    <section className="rocky-showcase rocky-assistant-page">
      <div className="rocky-kicker-demo">Copilote personnel</div>
      <h1 className="rocky-page-title">Assistant Rocky</h1>
      <p className="rocky-page-caption">Rocky lit les données du scénario ; toute modification reste visible et confirmable.</p>
      <div className="rocky-hero-demo"><strong>On regarde les vraies annonces, ensemble.</strong><span>Demande un comparatif, une piste de candidature ou un point rapide sur ton suivi.</span></div>

      <div className="rocky-mascot-stage">
        <img
          src="/rocky_mascot.png"
          alt="Mascotte Rocky"
          onError={event => {
            event.currentTarget.onerror = null
            event.currentTarget.src = 'https://raw.githubusercontent.com/nicolasbour2018-dot/Rocky_assistant_job/main/assets/rocky_mascot.png'
          }}
        />
      </div>

      <div className="rocky-example-row"><span>« Fais-moi un bilan »</span><span>« Quelle offre prioriser ? »</span><span>« Quelle relance aujourd’hui ? »</span></div>
      <div className="rocky-chat-box">
        {messages.map((message, index) => <div key={index} className={`rocky-chat-message ${message.role}`}><span>{message.role === 'assistant' ? 'Rocky' : 'Vous'}</span><p>{message.text}</p></div>)}
      </div>
      <div className="rocky-chat-chips"><button type="button" onClick={() => setInput('Fais-moi un bilan')}>Fais-moi un bilan</button><button type="button" onClick={() => setInput('Quelle offre prioriser ?')}>Quelle offre prioriser ?</button><button type="button" onClick={() => setInput('Quelle relance aujourd’hui ?')}>Quelle relance aujourd’hui ?</button></div>
      <form className="rocky-chat-form" onSubmit={send}><input value={input} onChange={event => setInput(event.target.value)} placeholder="Demande un bilan ou prépare une action…" /><button type="submit">Envoyer</button></form>
    </section>
  )

  const views = [
    { id: 'suggestions' as const, label: 'Suggestions', count: 3 },
    { id: 'new' as const, label: 'Nouvelles', count: 8 },
    { id: 'enrichment' as const, label: 'À enrichir', count: 2 },
    { id: 'mine' as const, label: 'Mes annonces', count: 5 },
    { id: 'flow' as const, label: 'Tout le flux', count: 12 }
  ]

  return (
    <section className="rocky-showcase">
      <div className="rocky-kicker-demo">Recherche & décisions</div>
      <h1 className="rocky-page-title">Rocky Assistant Recherche d'emploi · V2</h1>
      <p className="rocky-page-caption">Cockpit personnel · veille, matching et prochaines actions</p>
      <div className="rocky-hero-demo"><strong>Ton terrain de jeu pour la prochaine bonne opportunité.</strong><span>Explore les suggestions, ajuste ton profil et laisse Rocky te guider vers les annonces qui comptent.</span></div>
      <p className="rocky-profile-caption">Profil actif : <strong>Data / IA · Junior</strong></p>

      <div className="rocky-watch-card">
        <span className="rocky-small-label">Veille manuelle</span>
        <label>Postes recherchés pour cette veille</label>
        <div className="rocky-watch-row"><input defaultValue="Data Analyst, Data Ops, Automation" /><button type="button" onClick={() => { setWatchRun(true); onFeature('dashboard', 'run_watch') }}>Lancer la veille</button><button type="button" className="rocky-threshold">Seuil · 75 %</button></div>
        <small>Requêtes utilisées : Data Analyst · Data Ops · Automation</small>
      </div>
      {watchRun && <div className="rocky-success">Veille terminée — 8 nouvelles annonces ajoutées, dont 3 recommandations à 80 % ou plus.</div>}

      <div className="rocky-view-tabs">
        {views.map(view => <button key={view.id} type="button" className={cockpitView === view.id ? 'active' : ''} onClick={() => { setCockpitView(view.id); onFeature('dashboard', `view_${view.id}`) }}>{view.label} · {view.count}</button>)}
      </div>

      <div className="rocky-next-action">
        <div><span className="rocky-small-label">Prochaine action</span><strong>📬 1 réponse à vérifier</strong><small>Valide les retours Gmail pour garder tes candidatures à jour.</small></div>
        <button type="button" onClick={() => onFeature('applications', 'open_pending_email')}>Ouvrir</button>
      </div>

      <h2 className="rocky-results-title">{views.find(view => view.id === cockpitView)?.label} · {cockpitView === 'suggestions' ? 3 : cockpitView === 'new' ? 8 : cockpitView === 'enrichment' ? 2 : cockpitView === 'mine' ? 5 : 12} résultat(s)</h2>
      <div className="rocky-jobs-grid">
        {ROCKY_MATCHES.map((item, index) => (
          <article key={item.role} className="rocky-job-card">
            <div className="rocky-job-head"><h3>{item.role}</h3><div><small>Score</small><strong>{item.score} %</strong></div></div>
            <strong>{item.company}</strong>
            <p>Paris / hybride · Salaire non précisé</p>
            <small>`NOUVELLE` · source démo · {index === 0 ? '18/09/2026' : '17/09/2026'}</small>
            <button type="button" className="rocky-primary-button" onClick={() => onFeature('dashboard', 'open_job_detail')}>Ouvrir la fiche complète</button>
            <button type="button" className="rocky-secondary-button" onClick={() => onFeature('dashboard', 'open_matching')}>Analyse du matching</button>
          </article>
        ))}
      </div>
    </section>
  )
}


function BasketView({ feature, onFeature }: { feature: string; onFeature: (feature: string, action?: string) => void }) {
  const [selected, setSelected] = useState(0)

  if (feature === 'players') return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Roster fictif</span><h2>Profils joueurs</h2></div><strong>4 profils suivis</strong></div>
      <div className="showroom-player-layout"><div className="showroom-list compact">{PLAYERS.map((player, index) => <button key={player.name} type="button" className={`showroom-player ${selected === index ? 'active' : ''}`} onClick={() => { setSelected(index); onFeature('players', 'select_player') }}><span>{player.role}</span><strong>{player.name}</strong><small>{player.pts} pts · EFF {player.eff}</small></button>)}</div><div className="showroom-player-focus"><span>{PLAYERS[selected].role}</span><h3>{PLAYERS[selected].name}</h3><strong className="showroom-big-number">{PLAYERS[selected].eff}</strong><small>efficacité moyenne</small><div className="showroom-meter"><i style={{ width: `${Math.min(100, PLAYERS[selected].eff * 4)}%` }} /></div><p>Tendance sur 5 matchs : <strong>{PLAYERS[selected].trend}</strong></p></div></div>
    </section>
  )

  if (feature === 'match') return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Match fictif · terminé</span><h2>Épernon 78 — 71 Rambouillet</h2></div><strong>+7</strong></div>
      <div className="showroom-stats"><Stat label="eFG %" value="54.8%" note="+5.2 vs adversaire" /><Stat label="Rebonds" value="41" note="12 offensifs" /><Stat label="Turnovers" value="9" note="meilleur total saison" /><Stat label="Pace" value="73" note="rythme maîtrisé" /></div>
      <div className="showroom-chart"><span className="showroom-section-label">Écart au score</span><div className="showroom-bars">{[4, 9, 6, 14, 10, 18, 13, 21, 17, 24, 20, 28].map((height, i) => <i key={i} style={{ height: `${height * 3}px` }} />)}</div><div className="showroom-chart-axis"><span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span></div></div>
    </section>
  )

  if (feature === 'compare') return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Comparateur</span><h2>Diallo vs Bernard</h2></div><strong>5 derniers matchs</strong></div>
      <div className="showroom-compare"><div><span>M. Diallo</span><strong>18.6</strong><small>points</small><strong>7.4</strong><small>passes</small><strong>22.1</strong><small>efficacité</small></div><div className="showroom-versus">VS</div><div><span>L. Bernard</span><strong>15.2</strong><small>points</small><strong>3.1</strong><small>passes</small><strong>18.7</strong><small>efficacité</small></div></div>
    </section>
  )

  return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Équipe fictive</span><h2>Épernon Basket · Senior M</h2></div><strong>6 V · 2 D</strong></div>
      <div className="showroom-stats"><Stat label="Offensive rating" value="112.4" note="3e de la poule" /><Stat label="Défensive rating" value="101.8" note="+4.1 sur 5 matchs" /><Stat label="Différentiel" value="+10.6" note="tendance positive" /><Stat label="Forme" value="W W L W W" note="5 derniers matchs" /></div>
      <div className="showroom-split"><div className="showroom-callout"><span>Signal du moment</span><strong>Le rebond offensif progresse.</strong><p>+18 % sur trois matchs dans ce jeu de données fictif.</p><button type="button" onClick={() => onFeature('match', 'open_last_match')}>Voir le dernier match</button></div><div><span className="showroom-section-label">Impact joueurs</span>{PLAYERS.slice(0, 3).map(player => <div key={player.name} className="showroom-impact"><span>{player.name}</span><div><i style={{ width: `${player.eff * 3.5}%` }} /></div><strong>{player.eff}</strong></div>)}</div></div>
    </section>
  )
}

function GarageView({ feature, onFeature }: { feature: string; onFeature: (feature: string, action?: string) => void }) {
  const [prequoteSent, setPrequoteSent] = useState(false)
  const [workshopTab, setWorkshopTab] = useState<'prequotes' | 'quotes' | 'repairs' | 'appointments'>('prequotes')
  const [clientTab, setClientTab] = useState<'vehicles' | 'quotes' | 'repairs' | 'appointments'>('vehicles')
  const [quoteSent, setQuoteSent] = useState(false)
  const [repairProgress, setRepairProgress] = useState(52)
  const [paymentSaved, setPaymentSaved] = useState(false)

  const vehicles = [
    { registration: 'AB-123-CD', name: 'Peugeot 208', mileage: '84 200 km' },
    { registration: 'GH-456-IJ', name: 'Renault Clio', mileage: '112 600 km' }
  ]

  const quotes = [
    { number: 'DEV-2026-041', status: quoteSent ? 'Envoyé' : 'Brouillon', total: '286,80 €' },
    { number: 'DEV-2026-038', status: 'Accepté', total: '144,00 €' }
  ]

  if (feature === 'workshop') return (
    <section className="gildoni-showcase">
      <div className="gildoni-page-head">
        <div><span>Espace métier</span><h1>Atelier</h1><p>Prédevis, devis, réparations et rendez-vous.</p></div>
        <div className="gildoni-role-badge">Espace : <strong>atelier</strong></div>
      </div>

      <div className="gildoni-tabs">
        {[
          ['prequotes', 'Prédevis'],
          ['quotes', 'Devis'],
          ['repairs', 'Réparations'],
          ['appointments', 'Rendez-vous']
        ].map(([id, label]) => (
          <button key={id} type="button" className={workshopTab === id ? 'active' : ''} onClick={() => { setWorkshopTab(id as typeof workshopTab); onFeature('workshop', `tab_${id}`) }}>{label}</button>
        ))}
      </div>

      {workshopTab === 'prequotes' && (
        <div className="gildoni-card-stack">
          <article className="gildoni-record">
            <div><span>PRE-260918-014</span><h3>Camille Martin · Peugeot 208</h3><p>Voyant frein allumé et bruit métallique à faible vitesse.</p></div>
            <div className="gildoni-record-side"><strong>186,40 €</strong><small>prédevis indicatif</small><button type="button" onClick={() => onFeature('workshop', 'review_prequote')}>Valider la revue atelier</button></div>
          </article>
          <article className="gildoni-record">
            <div><span>PRE-260918-011</span><h3>Julien Robert · véhicule manuel</h3><p>Révision annuelle, filtres et contrôle général.</p></div>
            <div className="gildoni-record-side"><strong>249,00 €</strong><small>déjà revu</small><button type="button" onClick={() => { setWorkshopTab('quotes'); onFeature('workshop', 'create_quote') }}>Créer le brouillon</button></div>
          </article>
        </div>
      )}

      {workshopTab === 'quotes' && (
        <div className="gildoni-card-stack">
          {quotes.map((quote, index) => (
            <article className="gildoni-record" key={quote.number}>
              <div><span>{quote.number}</span><h3>{index === 0 ? 'Peugeot 208 · freinage' : 'Renault Clio · contrôle freinage'}</h3><p>Statut : <strong>{quote.status}</strong></p></div>
              <div className="gildoni-record-side"><strong>{quote.total}</strong><small>TTC</small>{index === 0 ? <button type="button" disabled={quoteSent} onClick={() => { setQuoteSent(true); onFeature('workshop', 'send_quote') }}>{quoteSent ? '✓ Envoyé (simulation)' : 'Envoyer au client'}</button> : <button type="button" onClick={() => onFeature('workshop', 'generate_pdf')}>Générer le PDF</button>}</div>
            </article>
          ))}
        </div>
      )}

      {workshopTab === 'repairs' && (
        <div className="gildoni-card-stack">
          <article className="gildoni-repair-card">
            <div className="gildoni-repair-head"><div><span>Ordre #1042</span><h3>Peugeot 208 · AB-123-CD</h3></div><strong>{repairProgress < 75 ? 'Réparation' : 'Contrôle sécurité'}</strong></div>
            <div className="gildoni-progress"><i style={{ width: `${repairProgress}%` }} /></div>
            <div className="gildoni-repair-meta"><span>Pièces commandées ✓</span><span>Intervention en cours</span><span>Livraison prévue 17:30</span></div>
            <button type="button" disabled={repairProgress >= 78} onClick={() => { setRepairProgress(78); onFeature('workshop', 'advance_repair') }}>{repairProgress >= 78 ? '✓ Contrôle sécurité validé' : 'Valider : contrôle sécurité'}</button>
          </article>
          <article className="gildoni-repair-card">
            <div className="gildoni-repair-head"><div><span>Ordre #1038</span><h3>Renault Clio · GH-456-IJ</h3></div><strong>Prêt</strong></div>
            <div className="gildoni-progress"><i style={{ width: '92%' }} /></div>
            <div className="gildoni-repair-meta"><span>Réparation terminée ✓</span><span>Contrôle sécurité ✓</span><span>À remettre au client</span></div>
          </article>
        </div>
      )}

      {workshopTab === 'appointments' && (
        <div className="gildoni-table-wrap">
          <table className="gildoni-table">
            <thead><tr><th>Heure</th><th>Véhicule</th><th>Motif</th><th>Statut</th></tr></thead>
            <tbody>{GARAGE_JOBS.map(job => <tr key={job.time}><td>{job.time}</td><td>{job.car}</td><td>{job.job}</td><td><span className="gildoni-status">{job.status}</span></td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  )

  if (feature === 'client') return (
    <section className="gildoni-showcase">
      <div className="gildoni-page-head">
        <div><span>Espace sécurisé</span><h1>Mon garage</h1><p>Véhicules, devis, réparations et rendez-vous.</p></div>
        <div className="gildoni-role-badge">Espace : <strong>client</strong></div>
      </div>

      <div className="gildoni-tabs">
        {[
          ['vehicles', 'Mes véhicules'],
          ['quotes', 'Mes devis'],
          ['repairs', 'Suivi des réparations'],
          ['appointments', 'Rendez-vous']
        ].map(([id, label]) => (
          <button key={id} type="button" className={clientTab === id ? 'active' : ''} onClick={() => { setClientTab(id as typeof clientTab); onFeature('client', `tab_${id}`) }}>{label}</button>
        ))}
      </div>

      {clientTab === 'vehicles' && (
        <div className="gildoni-vehicle-grid">
          {vehicles.map(vehicle => <article key={vehicle.registration}><span>{vehicle.registration}</span><h3>{vehicle.name}</h3><p>{vehicle.mileage}</p><small>Véhicule actif · données fictives</small></article>)}
          <button type="button" className="gildoni-add-card" onClick={() => onFeature('client', 'add_vehicle')}><strong>＋</strong><span>Ajouter un véhicule</span></button>
        </div>
      )}

      {clientTab === 'quotes' && (
        <div className="gildoni-card-stack">
          <article className="gildoni-record">
            <div><span>DEV-2026-041</span><h3>Peugeot 208 · freinage</h3><p>Devis envoyé · décision attendue.</p></div>
            <div className="gildoni-record-side"><strong>286,80 €</strong><div className="gildoni-decision-row"><button type="button" onClick={() => onFeature('client', 'accept_quote')}>Accepter</button><button type="button" className="danger" onClick={() => onFeature('client', 'refuse_quote')}>Refuser</button></div></div>
          </article>
        </div>
      )}

      {clientTab === 'repairs' && (
        <div className="gildoni-repair-card">
          <div className="gildoni-repair-head"><div><span>Ordre #1042</span><h3>Peugeot 208 · AB-123-CD</h3></div><strong>Réparation</strong></div>
          <div className="gildoni-progress"><i style={{ width: '52%' }} /></div>
          <div className="gildoni-repair-meta"><span>Devis accepté ✓</span><span>Pièces reçues ✓</span><span>Réparation en cours</span></div>
        </div>
      )}

      {clientTab === 'appointments' && (
        <div className="gildoni-form-card">
          <h3>Demander un rendez-vous</h3>
          <div className="gildoni-form-grid"><label>Véhicule<select defaultValue="AB-123-CD"><option>AB-123-CD · Peugeot 208</option></select></label><label>Jour souhaité<input type="date" defaultValue="2026-09-22" /></label><label>Créneau<select defaultValue="10:00"><option value="10:00">10 h 00</option><option value="14:00">14 h 00</option></select></label><label>Motif<input defaultValue="Contrôle freinage" /></label></div>
          <button type="button" onClick={() => onFeature('client', 'request_appointment')}>Demander ce rendez-vous</button>
        </div>
      )}
    </section>
  )

  if (feature === 'admin') return (
    <section className="gildoni-showcase">
      <div className="gildoni-page-head">
        <div><span>Pilotage interne</span><h1>Administration et gestion</h1><p>Facturation, règlements et comptes.</p></div>
        <div className="gildoni-role-badge">Espace : <strong>admin</strong></div>
      </div>

      <div className="gildoni-metrics">
        <div><span>Facturé TTC</span><strong>12 480 €</strong></div>
        <div><span>Encaissé</span><strong>10 936 €</strong></div>
        <div><span>Reste à payer</span><strong>1 544 €</strong></div>
      </div>
      <p className="gildoni-caption">Outil de gestion interne — démonstration, ne remplace pas une comptabilité légale certifiée.</p>

      <div className="gildoni-admin-grid">
        <div className="gildoni-panel">
          <span className="gildoni-section-label">Comptes</span>
          <table className="gildoni-table compact"><thead><tr><th>Utilisateur</th><th>Rôle</th><th>État</th></tr></thead><tbody><tr><td>atelier.demo</td><td>atelier</td><td>Actif</td></tr><tr><td>client.demo</td><td>client</td><td>Actif</td></tr><tr><td>admin.demo</td><td>admin</td><td>Actif</td></tr></tbody></table>
        </div>
        <div className="gildoni-panel">
          <span className="gildoni-section-label">Factures et règlements</span>
          <div className="gildoni-invoice-row"><div><strong>FAC-2026-087</strong><span>286,80 € · 142,80 € restant</span></div><button type="button" disabled={paymentSaved} onClick={() => { setPaymentSaved(true); onFeature('admin', 'save_payment') }}>{paymentSaved ? '✓ Règlement simulé' : 'Enregistrer 142,80 €'}</button></div>
          <div className="gildoni-invoice-row"><div><strong>FAC-2026-083</strong><span>144,00 € · réglée</span></div><b>Payée</b></div>
        </div>
      </div>
    </section>
  )

  return (
    <section className="gildoni-showcase">
      <div className="gildoni-public-hero">
        <span>GARAGE GILDONI</span>
        <h1>Garage <strong>Gildoni</strong></h1>
        <p>Plus de 30 ans d’expérience automobile à Ascros.</p>
        <small>Du lundi au samedi · 8 h–20 h · démonstration événementielle</small>
      </div>

      <div className="gildoni-public-layout">
        <div className="gildoni-info-column">
          <span className="gildoni-section-label">Un atelier proche de vous</span>
          <h2>Entretien et réparation toutes marques.</h2>
          <p>Entretien, diagnostic, freinage, pneumatiques et réparations dans un même parcours numérique.</p>
          <div className="gildoni-address-box">📍 Ascros · adresse masquée dans la démo</div>
          <div className="gildoni-notice">Le prédevis est indicatif. Les prix sont confirmés par l’atelier après contrôle.</div>
          {prequoteSent && <div className="gildoni-success"><strong>Prédevis PRE-260918-014 enregistré</strong><span>Estimation TTC · 186,40 €</span><small>Diagnostic fictif : freinage · contrôle atelier requis</small></div>}
        </div>

        <div className="gildoni-form-card">
          <h2>Demander un prédevis</h2>
          <div className="gildoni-form-grid">
            <label>Nom et prénom<input defaultValue="Camille Martin" /></label>
            <label>Email<input defaultValue="camille@example.test" /></label>
            <label>Téléphone<input defaultValue="06 00 00 00 00" /></label>
            <label>Immatriculation<input defaultValue="AB-123-CD" /></label>
            <label>Marque<input defaultValue="Peugeot" /></label>
            <label>Modèle<input defaultValue="208" /></label>
            <label>Kilométrage<input defaultValue="84200" /></label>
            <label className="wide">Décrivez les symptômes<textarea defaultValue="Voyant frein allumé et bruit métallique à faible vitesse." /></label>
          </div>
          <label className="gildoni-consent"><input type="checkbox" defaultChecked /> J’accepte l’utilisation de ces informations pour traiter cette démonstration.</label>
          <button type="button" disabled={prequoteSent} onClick={() => { setPrequoteSent(true); onFeature('dashboard', 'submit_prequote') }}>{prequoteSent ? '✓ Estimation obtenue' : 'Obtenir mon estimation'}</button>
        </div>
      </div>
    </section>
  )
}

function JarvisView({ feature, onFeature }: { feature: string; onFeature: (feature: string, action?: string) => void }) {
  const [lightsOn, setLightsOn] = useState(true)
  const [routineRun, setRoutineRun] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_JARVIS_CHAT)
  const chatStarted = useRef(false)

  function send(e: FormEvent) {
    e.preventDefault()
    const cleaned = input.trim()
    if (!cleaned) return
    const next = [...messages, { role: 'visitor' as const, text: cleaned }, { role: 'assistant' as const, text: jarvisReply(cleaned) }]
    setMessages(next)
    setInput('')
    if (!chatStarted.current) {
      chatStarted.current = true
      void trackEvent('chat_started', { demo: 'jarvis' })
    }
    void trackEvent('message_count', { demo: 'jarvis', count: next.length - 1 })
  }

  if (feature === 'agenda') return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Agenda fictif</span><h2>Jeudi 18 septembre</h2></div><strong>4 rendez-vous</strong></div>
      <div className="showroom-agenda"><article><time>08:30</time><div><strong>École</strong><p>Dépose du matin</p></div></article><article><time>12:30</time><div><strong>Déjeuner</strong><p>Rendez-vous simulé</p></div></article><article><time>16:30</time><div><strong>Activité</strong><p>Rappel familial fictif</p></div></article><article><time>18:00</time><div><strong>Courses</strong><p>Liste prête · 5 articles</p></div></article></div>
    </section>
  )

  if (feature === 'home') return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Maison fictive</span><h2>État de la maison</h2></div><strong>Aucun appareil réel connecté</strong></div>
      <div className="showroom-device-grid"><button type="button" className={lightsOn ? 'active' : ''} onClick={() => { setLightsOn(value => !value); onFeature('home', 'toggle_lights') }}><span>Salon</span><strong>{lightsOn ? 'Lumières ON' : 'Lumières OFF'}</strong><small>simulation locale</small></button><article><span>Température</span><strong>20.8 °C</strong><small>valeur fictive</small></article><article><span>Porte</span><strong>Verrouillée</strong><small>état fictif</small></article><article><span>Énergie</span><strong>1.4 kW</strong><small>consommation simulée</small></article></div>
      <button className="showroom-action" type="button" onClick={() => { setRoutineRun(true); onFeature('home', 'run_routine') }}>{routineRun ? '✓ Routine “départ” simulée' : 'Simuler la routine “départ”'}</button>
    </section>
  )

  if (feature === 'assistant') return (
    <section className="showroom-panel showroom-chat-panel">
      <div className="showroom-panel-head"><div><span>Assistant fictif</span><h2>Jarvis</h2></div><strong>Simulation transparente</strong></div>
      <div className="showroom-chat">{messages.map((message, index) => <div key={index} className={`showroom-message ${message.role}`}><span>{message.role === 'assistant' ? 'Jarvis' : 'Vous'}</span><p>{message.text}</p></div>)}</div>
      <div className="showroom-chips"><button type="button" onClick={() => setInput('Résume ma journée')}>Résume ma journée</button><button type="button" onClick={() => setInput('Lance la routine départ')}>Routine départ</button></div>
      <form className="showroom-chat-form" onSubmit={send}><input value={input} onChange={e => setInput(e.target.value)} placeholder="Parle au Jarvis de démonstration…" /><button type="submit">Envoyer</button></form>
    </section>
  )

  return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Maison fictive · maintenant</span><h2>Bonjour</h2></div><strong>20.8 °C · démo</strong></div>
      <div className="showroom-stats"><Stat label="Prochain rendez-vous" value="12:30" note="déjeuner · fictif" /><Stat label="Activité familiale" value="16:30" note="rappel simulé" /><Stat label="Courses" value="5" note="articles simulés" /><Stat label="Maison" value="OK" note="aucun appareil réel" /></div>
      <div className="showroom-split"><div className="showroom-callout"><span>Jarvis suggère</span><strong>La journée est légère jusqu’à 16:30.</strong><p>Une fenêtre fictive de 90 minutes est disponible après le déjeuner.</p><button type="button" onClick={() => onFeature('assistant', 'open_assistant')}>Ouvrir l’assistant</button></div><div><span className="showroom-section-label">Raccourcis</span><button className="showroom-shortcut" type="button" onClick={() => onFeature('agenda', 'open_agenda')}><span>Agenda</span><strong>4 événements</strong></button><button className="showroom-shortcut" type="button" onClick={() => onFeature('home', 'open_home')}><span>Maison</span><strong>Tout est simulé</strong></button></div></div>
    </section>
  )
}

export default function Showroom({ exitShowroom }: { exitShowroom: () => void }) {
  const [activeDemo, setActiveDemo] = useState<DemoKey | null>(null)
  const [activeFeature, setActiveFeature] = useState('dashboard')
  const [resetKey, setResetKey] = useState(0)
  const demoStartedAt = useRef<number | null>(null)

  function trackDuration(demo: DemoKey | null) {
    if (!demo || demoStartedAt.current === null) return
    const seconds = Math.max(1, Math.round((Date.now() - demoStartedAt.current) / 1000))
    void trackEvent('demo_duration_s', { demo, duration_s: seconds })
    demoStartedAt.current = null
  }

  function openDemo(demo: DemoKey) {
    if (activeDemo) trackDuration(activeDemo)
    setActiveDemo(demo)
    setActiveFeature('dashboard')
    setResetKey(value => value + 1)
    demoStartedAt.current = Date.now()
    void trackEvent('demo_opened', { demo })
  }

  function backToHub() {
    trackDuration(activeDemo)
    setActiveDemo(null)
    setActiveFeature('dashboard')
  }

  function resetShowroom() {
    const fromDemo = activeDemo
    trackDuration(fromDemo)
    setActiveDemo(null)
    setActiveFeature('dashboard')
    setResetKey(value => value + 1)
    void trackEvent('demo_reset', { from_demo: fromDemo })
  }

  function selectFeature(feature: string, action?: string) {
    if (!activeDemo) return
    setActiveFeature(feature)
    void trackEvent('feature_clicked', { demo: activeDemo, feature, action: action ?? null })
  }

  const themeClass = activeDemo ? `showroom-theme-${activeDemo}` : 'showroom-theme-hub'

  if (!activeDemo) return (
    <main className={`showroom-root ${themeClass}`}>
      <header className="showroom-topbar"><div><span className="showroom-brand-dot" /><strong>GAIA VECTOR STUDIO</strong><small>SHOWROOM · démonstrations fictives</small></div><button type="button" onClick={exitShowroom}>Quitter le showroom</button></header>
      <section className="showroom-hero"><p>SHOWROOM TABLETTE</p><h1>Des données aux décisions.</h1><span>Quatre prototypes interactifs. Les données et actions sont simulées : aucune connexion métier réelle n’est utilisée.</span></section>
      <section className="showroom-hub-grid">{(Object.keys(DEMOS) as DemoKey[]).map(key => { const demo = DEMOS[key]; return <button key={key} type="button" className={`showroom-hub-card showroom-card-${key}`} onClick={() => openDemo(key)}><div className="showroom-card-top"><span>{demo.eyebrow}</span><i>{demo.icon}</i></div><h2>{demo.name}</h2><p>{demo.description}</p><strong>{demo.promise}</strong><small>Ouvrir la démo →</small></button> })}</section>
      <footer className="showroom-footer"><span>Mode événement · données figées · reset instantané</span><button type="button" onClick={resetShowroom}>↻ Réinitialiser</button></footer>
    </main>
  )

  const meta = DEMOS[activeDemo]

  return (
    <main className={`showroom-root ${themeClass}`}>
      <header className="showroom-topbar"><div><span className="showroom-brand-dot" /><strong>{meta.name}</strong><small>{meta.eyebrow} · scénario fictif</small></div><div className="showroom-top-actions"><button type="button" onClick={backToHub}>← Hub</button><button type="button" className="showroom-reset-top" onClick={resetShowroom}>↻ Reset</button></div></header>
      <section className="showroom-demo-shell">
        <aside className="showroom-sidebar"><div><span className="showroom-demo-icon">{meta.icon}</span><h1>{meta.name}</h1><p>{meta.promise}</p></div><nav>{meta.features.map(feature => <button key={feature.id} type="button" className={activeFeature === feature.id ? 'active' : ''} onClick={() => selectFeature(feature.id)}>{feature.label}<span>→</span></button>)}</nav><small>Démo transparente · aucune donnée personnelle réelle</small></aside>
        <div className="showroom-content" key={`${activeDemo}-${resetKey}`}>
          {activeDemo === 'rocky' && <RockyView feature={activeFeature} onFeature={selectFeature} />}
          {activeDemo === 'basket' && <BasketView feature={activeFeature} onFeature={selectFeature} />}
          {activeDemo === 'garage' && <GarageView feature={activeFeature} onFeature={selectFeature} />}
          {activeDemo === 'jarvis' && <JarvisView feature={activeFeature} onFeature={selectFeature} />}
        </div>
      </section>
    </main>
  )
}

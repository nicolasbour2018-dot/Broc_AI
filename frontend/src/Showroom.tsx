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
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'offers', label: 'Offres' },
      { id: 'applications', label: 'Candidatures' },
      { id: 'chat', label: 'Assistant' }
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
    name: 'Garage OS',
    eyebrow: 'Pilotage métier',
    description: 'Clients, véhicules, interventions, devis et planning dans une interface opérationnelle simple.',
    promise: 'Voir l’atelier, les urgences et le chiffre du jour.',
    icon: '◇',
    features: [
      { id: 'dashboard', label: 'Atelier' },
      { id: 'planning', label: 'Planning' },
      { id: 'interventions', label: 'Interventions' },
      { id: 'quotes', label: 'Devis' }
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
  const chatStarted = useRef(false)

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

  if (feature === 'offers') return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Veille fictive</span><h2>Offres prioritaires</h2></div><strong>36 détectées · 3 retenues</strong></div>
      <div className="showroom-list">{ROCKY_MATCHES.map((item, index) => <article key={item.role} className="showroom-row-card"><div className="showroom-rank">0{index + 1}</div><div><h3>{item.role}</h3><p>{item.company} · {item.detail}</p></div><div className="showroom-score"><strong>{item.score}%</strong><span>match</span></div></article>)}</div>
      <button className="showroom-action" type="button" onClick={() => onFeature('applications', 'prepare_application')}>Simuler la préparation d’une candidature →</button>
    </section>
  )

  if (feature === 'applications') return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Pipeline fictif</span><h2>Candidatures</h2></div><strong>3 actives</strong></div>
      <div className="showroom-kanban">
        <div><span className="showroom-column-title">À envoyer · 1</span><article><strong>Terranova</strong><p>Data Analyst · 92 %</p><small>CV adapté · lettre prête</small></article></div>
        <div><span className="showroom-column-title">Envoyées · 1</span><article><strong>Novadata</strong><p>Data Ops Junior · J+6</p><small>Relance recommandée</small></article></div>
        <div><span className="showroom-column-title">Entretien · 1</span><article><strong>GreenMetrics</strong><p>Assistant Data</p><small>Vendredi · 10:30</small></article></div>
      </div>
      <div className="showroom-callout"><span>Prochaine action</span><strong>Relancer Novadata aujourd’hui</strong><p>Suggestion générée à partir d’un scénario fictif, aucun email réel n’est envoyé.</p></div>
    </section>
  )

  if (feature === 'chat') return (
    <section className="showroom-panel showroom-chat-panel">
      <div className="showroom-panel-head"><div><span>Assistant fictif</span><h2>Rocky Copilot</h2></div><strong>Aucune connexion externe</strong></div>
      <div className="showroom-chat">{messages.map((message, index) => <div key={index} className={`showroom-message ${message.role}`}><span>{message.role === 'assistant' ? 'Rocky' : 'Vous'}</span><p>{message.text}</p></div>)}</div>
      <div className="showroom-chips"><button type="button" onClick={() => setInput('Quelle offre prioriser ?')}>Quelle offre prioriser ?</button><button type="button" onClick={() => setInput('Quelle relance aujourd’hui ?')}>Quelle relance aujourd’hui ?</button></div>
      <form className="showroom-chat-form" onSubmit={send}><input value={input} onChange={e => setInput(e.target.value)} placeholder="Pose une question sur ce scénario fictif…" /><button type="submit">Envoyer</button></form>
    </section>
  )

  return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Vue du jour</span><h2>Recherche pilotée</h2></div><strong>18 septembre · démo</strong></div>
      <div className="showroom-stats"><Stat label="Offres suivies" value="12" note="+4 cette semaine" /><Stat label="Match ≥ 80 %" value="4" note="dont 1 à 92 %" /><Stat label="Candidatures" value="3" note="1 entretien" /><Stat label="Action du jour" value="1" note="relance conseillée" /></div>
      <div className="showroom-split"><div><span className="showroom-section-label">Top matching</span>{ROCKY_MATCHES.slice(0, 3).map(item => <button key={item.role} className="showroom-match" type="button" onClick={() => onFeature('offers', 'open_match')}><div><strong>{item.role}</strong><small>{item.company}</small></div><span>{item.score}%</span></button>)}</div><div className="showroom-callout"><span>Rocky recommande</span><strong>Concentre l’effort, pas le volume.</strong><p>Une candidature ciblée aujourd’hui vaut mieux que cinq génériques.</p><button type="button" onClick={() => onFeature('chat', 'open_copilot')}>Demander au copilote</button></div></div>
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
  const [quoteValidated, setQuoteValidated] = useState(false)

  if (feature === 'planning') return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Planning fictif</span><h2>Atelier · aujourd’hui</h2></div><strong>4 interventions</strong></div>
      <div className="showroom-timeline">{GARAGE_JOBS.map(job => <article key={job.time}><time>{job.time}</time><div><strong>{job.car}</strong><p>{job.job}</p></div><span>{job.status}</span></article>)}</div>
    </section>
  )

  if (feature === 'interventions') return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Dossier fictif</span><h2>Peugeot 208 · AB-123-CD</h2></div><strong>84 200 km</strong></div>
      <div className="showroom-split"><div className="showroom-checklist"><label><input type="checkbox" defaultChecked /> Vidange moteur</label><label><input type="checkbox" defaultChecked /> Filtre à huile</label><label><input type="checkbox" /> Contrôle plaquettes</label><label><input type="checkbox" /> Pression pneus</label></div><div className="showroom-callout"><span>Estimation atelier</span><strong>1 h 15 restante</strong><p>Pièces disponibles · aucun blocage détecté.</p></div></div>
    </section>
  )

  if (feature === 'quotes') return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Devis fictif #D-2048</span><h2>Renault Clio · freinage</h2></div><strong>{quoteValidated ? 'Validé (simulation)' : 'En attente'}</strong></div>
      <div className="showroom-invoice"><div><span>Plaquettes avant</span><strong>68 €</strong></div><div><span>Main-d’œuvre</span><strong>56 €</strong></div><div><span>Contrôle / essai</span><strong>20 €</strong></div><div className="total"><span>Total TTC</span><strong>144 €</strong></div></div>
      <button className="showroom-action" type="button" disabled={quoteValidated} onClick={() => { setQuoteValidated(true); onFeature('quotes', 'simulate_quote_approval') }}>{quoteValidated ? '✓ Validation simulée' : 'Simuler la validation du devis'}</button>
      <p className="showroom-disclaimer">Démonstration uniquement : aucun devis réel n’est envoyé ou signé.</p>
    </section>
  )

  return (
    <section className="showroom-panel">
      <div className="showroom-panel-head"><div><span>Atelier fictif</span><h2>Vue opérationnelle</h2></div><strong>Jeudi · 08:42</strong></div>
      <div className="showroom-stats"><Stat label="Véhicules aujourd’hui" value="7" note="4 en atelier" /><Stat label="CA prévu" value="1 840 €" note="6 devis validés" /><Stat label="Retards" value="1" note="pièce à 14:00" /><Stat label="Satisfaction" value="4.8/5" note="30 derniers avis fictifs" /></div>
      <div className="showroom-split"><div><span className="showroom-section-label">Maintenant</span>{GARAGE_JOBS.slice(0, 3).map(job => <button className="showroom-job" key={job.time} type="button" onClick={() => onFeature('planning', 'open_job')}><time>{job.time}</time><div><strong>{job.car}</strong><small>{job.job}</small></div><span>{job.status}</span></button>)}</div><div className="showroom-callout"><span>Attention</span><strong>Clio · contrôle freinage</strong><p>Un devis attend une validation simulée.</p><button type="button" onClick={() => onFeature('quotes', 'open_quote')}>Ouvrir le devis</button></div></div>
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

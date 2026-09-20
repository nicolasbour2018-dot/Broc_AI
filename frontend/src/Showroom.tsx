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
      { id: 'jobs', label: 'Offres' },
      { id: 'applications', label: 'Candidatures' },
      { id: 'statistics', label: 'Statistiques' },
      { id: 'chat', label: 'Assistant Rocky' }
    ]
  },
  basket: {
    name: 'HGSE Basket',
    eyebrow: 'Pilotage de club',
    description: 'Gestion sportive, association, communication, statistiques et assistant IA réunis dans un cockpit club.',
    promise: 'Plus qu’un club, une famille — et un pilotage enfin centralisé.',
    icon: '🏀',
    features: [
      { id: 'dashboard', label: 'Accueil' },
      { id: 'planning', label: 'Planning' },
      { id: 'messages', label: 'Messagerie' },
      { id: 'teams', label: 'Équipes' },
      { id: 'match', label: 'Match' },
      { id: 'statistics', label: 'Statistiques' },
      { id: 'club', label: 'Club / Association' },
      { id: 'assistant', label: 'Assistant IA' }
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
    eyebrow: 'Assistant familial intelligent',
    description: 'Agenda, maison connectée, organisation du foyer et assistant agentique réunis dans un même centre de contrôle familial.',
    promise: 'La famille, la maison et le quotidien dans une seule interface.',
    icon: '◉',
    features: [
      { id: 'dashboard', label: 'Accueil' },
      { id: 'family', label: 'Famille' },
      { id: 'home', label: 'Maison' },
      { id: 'organization', label: 'Organisation' },
      { id: 'assistant', label: 'Jarvis' }
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
  const [selectedJob, setSelectedJob] = useState(0)
  const [jobView, setJobView] = useState<'list' | 'detail'>('list')
  const [detailTab, setDetailTab] = useState<'overview' | 'matching' | 'application'>('overview')
  const [applicationPrepared, setApplicationPrepared] = useState(false)
  const [savedJob, setSavedJob] = useState(false)
  const chatStarted = useRef(false)

  const jobs = ROCKY_MATCHES.map((item, index) => ({
    ...item,
    id: [42, 38, 31][index],
    city: ['Paris', 'Chartres', 'Rambouillet'][index],
    remote: ['Hybride · 3 j télétravail', 'Remote France', 'Hybride · 2 j télétravail'][index],
    contract: ['CDI', 'CDI', 'CDD 12 mois'][index],
    salary: ['38–44 k€', '36–42 k€', '34–39 k€'][index],
    source: ['Apec', 'Adzuna', 'LinkedIn'][index],
    status: ['NOUVELLE', 'NOUVELLE', 'À ENRICHIR'][index],
    summary: [
      'Construire des analyses utiles aux équipes opérationnelles et transformer des données hétérogènes en indicateurs simples.',
      'Automatiser les flux de données, fiabiliser les imports et développer de petits outils internes en Python.',
      'Prototyper des automatisations et assistants IA pour fluidifier les opérations quotidiennes.'
    ][index],
    strengths: [
      ['Python / SQL très alignés', 'Expérience dashboard et EDA', 'Secteur impact cohérent'],
      ['Python et automatisation', 'APIs et orchestration', 'Culture produit transverse'],
      ['Agents et automatisation', 'Prototypage rapide', 'Expérience métier variée']
    ][index],
    gaps: [
      'Power BI demandé : niveau à préciser',
      'Airflow cité dans l’annonce : expérience limitée',
      'Expérience SaaS B2B souhaitée : à contextualiser'
    ][index]
  }))

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

  function openJob(index: number, tab: 'overview' | 'matching' | 'application' = 'overview') {
    setSelectedJob(index)
    setDetailTab(tab)
    setJobView('detail')
    setApplicationPrepared(false)
    setSavedJob(false)
    onFeature('jobs', tab === 'matching' ? 'open_matching' : 'open_job_detail')
  }

  if (feature === 'jobs') {
    const job = jobs[selectedJob]

    if (jobView === 'detail') return (
      <section className="rocky-showcase rocky-job-detail-page">
        <button type="button" className="rocky-back-link" onClick={() => { setJobView('list'); onFeature('jobs', 'back_to_flow') }}>← Retour au flux</button>
        <div className="rocky-detail-head">
          <div>
            <span className="rocky-small-label">Annonce #{job.id} · {job.source}</span>
            <h1 className="rocky-page-title">{job.role}</h1>
            <p className="rocky-page-caption">{job.company} · {job.city}</p>
          </div>
          <div className="rocky-detail-score"><span>Matching</span><strong>{job.score} %</strong><small>{job.score >= 90 ? 'Très forte adéquation' : 'Bonne adéquation'}</small></div>
        </div>

        <div className="rocky-detail-meta">
          <div><span>Contrat</span><strong>{job.contract}</strong></div>
          <div><span>Télétravail</span><strong>{job.remote}</strong></div>
          <div><span>Salaire</span><strong>{job.salary}</strong></div>
          <div><span>Statut</span><strong>{job.status}</strong></div>
        </div>

        <div className="rocky-detail-tabs">
          {([['overview', 'Aperçu'], ['matching', 'Matching'], ['application', 'Candidature']] as const).map(([id, label]) => (
            <button key={id} type="button" className={detailTab === id ? 'active' : ''} onClick={() => { setDetailTab(id); onFeature('jobs', `detail_${id}`) }}>{label}</button>
          ))}
        </div>

        {detailTab === 'overview' && <div className="rocky-detail-grid">
          <article className="rocky-card-panel rocky-detail-copy">
            <span className="rocky-small-label">Mission</span>
            <h3>{job.company} cherche un profil capable de rendre la donnée directement actionnable.</h3>
            <p>{job.summary}</p>
            <div className="rocky-skill-row"><span>Python</span><span>SQL</span><span>Data viz</span><span>Automatisation</span></div>
          </article>
          <aside className="rocky-card-panel rocky-source-card">
            <span className="rocky-small-label">Provenance</span>
            <h3>{job.source}</h3>
            <p>Annonce importée dans le scénario de démonstration.</p>
            <div className="rocky-status-line"><span>Fraîcheur</span><strong>{selectedJob === 0 ? '2 jours' : '3 jours'}</strong></div>
            <div className="rocky-status-line"><span>Qualité des données</span><strong>Complète</strong></div>
            <button type="button" className="rocky-secondary-button" onClick={() => { setSavedJob(value => !value); onFeature('jobs', 'toggle_saved') }}>{savedJob ? '✓ Ajoutée à mes annonces' : '+ Ajouter à mes annonces'}</button>
          </aside>
        </div>}

        {detailTab === 'matching' && <div className="rocky-detail-grid rocky-matching-grid">
          <article className="rocky-card-panel rocky-score-panel">
            <span className="rocky-small-label">Score Rocky</span>
            <div className="rocky-score-ring" style={{ background: `conic-gradient(#08b5d1 ${job.score * 3.6}deg, #e7f0f1 0)` }}><strong>{job.score}%</strong></div>
            <p>Le score combine les compétences, le type de mission et les préférences du profil actif.</p>
          </article>
          <article className="rocky-card-panel">
            <span className="rocky-small-label">Pourquoi ça matche</span>
            <div className="rocky-reason-list">{job.strengths.map(reason => <div key={reason}><b>✓</b><span>{reason}</span></div>)}</div>
            <div className="rocky-gap"><b>À clarifier</b><span>{job.gaps}</span></div>
            <button type="button" className="rocky-primary-button" onClick={() => { setDetailTab('application'); onFeature('jobs', 'prepare_from_matching') }}>Préparer cette candidature</button>
          </article>
        </div>}

        {detailTab === 'application' && <div className="rocky-detail-grid">
          <article className="rocky-card-panel rocky-application-prep">
            <span className="rocky-small-label">Dossier candidat</span>
            <h3>Adapter sans réécrire tout le CV.</h3>
            <div className="rocky-checkline"><span>CV principal</span><strong>Prêt</strong></div>
            <div className="rocky-checkline"><span>Accroche ciblée</span><strong>{applicationPrepared ? 'Générée' : 'À préparer'}</strong></div>
            <div className="rocky-checkline"><span>Arguments de matching</span><strong>3 sélectionnés</strong></div>
            <button type="button" className="rocky-primary-button" onClick={() => { setApplicationPrepared(true); onFeature('jobs', 'prepare_application_demo') }}>{applicationPrepared ? '✓ Dossier prêt pour la démo' : 'Préparer le dossier'}</button>
          </article>
          <aside className="rocky-card-panel rocky-action-card">
            <span className="rocky-small-label">Contrôle utilisateur</span>
            <h3>Rien ne part automatiquement.</h3>
            <p>Rocky prépare, explique et propose. L’envoi reste une action explicite de l’utilisateur.</p>
            <button type="button" className="rocky-secondary-button" onClick={() => onFeature('applications', 'open_application_tracking')}>Voir le suivi des candidatures</button>
          </aside>
        </div>}
      </section>
    )

    return (
      <section className="rocky-showcase">
        <div className="rocky-kicker-demo">Base d’annonces</div>
        <h1 className="rocky-page-title">Tout le flux</h1>
        <p className="rocky-page-caption">Toutes les annonces du scénario, avec statut, source et score de matching.</p>

        <div className="rocky-flow-summary">
          <div><span>Annonces en base</span><strong>12</strong></div>
          <div><span>À enrichir</span><strong>2</strong></div>
          <div><span>Sources</span><strong>6</strong></div>
          <div><span>Score moyen</span><strong>81 %</strong></div>
        </div>

        <div className="rocky-flow-toolbar">
          <div><span className="rocky-small-label">Recherche</span><input defaultValue="Data" aria-label="Recherche fictive" /></div>
          <div><span className="rocky-small-label">Statut</span><button type="button">Toutes · 12</button></div>
          <div><span className="rocky-small-label">Tri</span><button type="button">Meilleur score ↓</button></div>
        </div>

        <div className="rocky-flow-list">
          {jobs.map((item, index) => (
            <article key={item.id} className="rocky-flow-row">
              <div className="rocky-flow-company"><span>{item.company.slice(0, 1)}</span><div><strong>{item.company}</strong><small>{item.source} · #{item.id}</small></div></div>
              <div className="rocky-flow-role"><strong>{item.role}</strong><small>{item.city} · {item.remote}</small></div>
              <span className={`rocky-status-pill ${index === 2 ? 'needs-data' : ''}`}>{item.status}</span>
              <strong className="rocky-flow-score">{item.score}%</strong>
              <button type="button" className="rocky-secondary-button" onClick={() => openJob(index)}>Ouvrir</button>
            </article>
          ))}
        </div>
        <div className="rocky-demo-note">Démo showroom : 3 annonces sont affichées, mais les compteurs simulent un flux complet de 12 offres.</div>
      </section>
    )
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

      <div className="rocky-pipeline">
        <div><span>À préparer</span><strong>1</strong></div>
        <i />
        <div><span>Envoyées</span><strong>2</strong></div>
        <i />
        <div><span>Réponses</span><strong>1</strong></div>
        <i />
        <div><span>Entretiens</span><strong>1</strong></div>
      </div>

      <div className="rocky-section-head"><div><span>Dossiers récents</span><strong>3 candidatures</strong></div><small>sélectionne une carte pour ouvrir son suivi</small></div>
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
          <div className="rocky-status-line"><span>Dernière action</span><strong>{selectedApplication === 1 ? 'Envoyée il y a 6 j' : 'Aujourd’hui'}</strong></div>
          <button type="button" className="rocky-primary-button" onClick={() => onFeature('applications', 'prepare_application')}>Préparer / revoir le dossier</button>
        </div>
        <div className="rocky-card-panel rocky-mail-card">
          <span className="rocky-small-label">Réponses recruteurs · simulation</span>
          <h3>1 réponse à vérifier</h3>
          <p><strong>Novadata</strong> · “Suite à votre candidature”</p>
          <p>Classification fictive : <b>ENTRETIEN</b> · confiance 94 %</p>
          <button type="button" onClick={() => onFeature('applications', 'review_email')}>Ouvrir la réponse simulée</button>
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
      <div className="rocky-two-columns">
        <div className="rocky-card-panel"><span className="rocky-small-label">Sources</span><h3>D’où viennent les opportunités ?</h3><div className="rocky-source-bars"><div><span>Apec</span><i style={{ width: '82%' }} /><strong>5</strong></div><div><span>Adzuna</span><i style={{ width: '58%' }} /><strong>3</strong></div><div><span>LinkedIn</span><i style={{ width: '42%' }} /><strong>2</strong></div><div><span>Autres</span><i style={{ width: '28%' }} /><strong>2</strong></div></div></div>
        <div className="rocky-card-panel"><span className="rocky-small-label">Lecture rapide</span><h3>La qualité passe avant le volume.</h3><p className="rocky-insight-copy">Les candidatures les mieux scorées concentrent les retours. Rocky aide surtout à prioriser les bonnes annonces et à garder le suivi à jour.</p></div>
      </div>
    </section>
  )

  if (feature === 'chat') return (
    <section className="rocky-showcase rocky-assistant-page">
      <div className="rocky-kicker-demo">Copilote personnel</div>
      <h1 className="rocky-page-title">Assistant Rocky</h1>
      <p className="rocky-page-caption">Rocky lit uniquement le jeu de données de la démo et propose des actions explicables.</p>
      <div className="rocky-hero-demo"><strong>Un copilote, pas un pilote automatique.</strong><span>Demande un comparatif, une priorité de candidature ou un point rapide sur ton suivi.</span></div>

      <div className="rocky-mascot-stage">
        <div className="rocky-mascot-orbit" aria-hidden="true"><i /><span>R</span></div>
        <div><strong>Rocky</strong><small>assistant emploi · mode démo</small></div>
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

  const visibleJobs = cockpitView === 'suggestions' ? jobs : cockpitView === 'enrichment' ? jobs.slice(2) : jobs
  const resultCount = cockpitView === 'suggestions' ? 3 : cockpitView === 'new' ? 8 : cockpitView === 'enrichment' ? 2 : cockpitView === 'mine' ? 5 : 12

  return (
    <section className="rocky-showcase">
      <div className="rocky-kicker-demo">Recherche & décisions</div>
      <h1 className="rocky-page-title">Rocky Assistant Recherche d’emploi</h1>
      <p className="rocky-page-caption">Cockpit personnel · veille, matching et prochaines actions</p>

      <div className="rocky-hero-demo"><strong>Ton terrain de jeu pour la prochaine bonne opportunité.</strong><span>Explore les suggestions, comprends le matching, prépare tes dossiers et garde la main sur chaque action.</span></div>

      <div className="rocky-command-grid">
        <div className="rocky-profile-card"><span className="rocky-small-label">Profil actif</span><strong>Data / IA · Junior</strong><small>Python · SQL · BI · automatisation · impact</small><button type="button" onClick={() => onFeature('dashboard', 'profile_demo')}>Profil prêt · 87 %</button></div>
        <div className="rocky-source-strip"><div><span>Sources actives</span><strong>6 / 7</strong></div><div className="rocky-source-dots"><i /><i /><i /><i /><i /><i /><i className="muted" /></div><small>Apec · Adzuna · LinkedIn · Indeed · Wellfound · autres</small></div>
        <div className="rocky-cockpit-kpis"><div><span>Suggestions</span><strong>3</strong></div><div><span>Nouvelles</span><strong>8</strong></div><div><span>À enrichir</span><strong>2</strong></div></div>
      </div>

      <div className="rocky-watch-card">
        <div className="rocky-watch-title"><div><span className="rocky-small-label">Veille manuelle</span><strong>Relancer la recherche maintenant</strong></div><span>Dernière veille · 02:42</span></div>
        <label>Postes recherchés pour cette veille</label>
        <div className="rocky-watch-row"><input defaultValue="Data Analyst, Data Ops, Automation" /><button type="button" onClick={() => { setWatchRun(true); onFeature('dashboard', 'run_watch') }}>Lancer la veille</button><button type="button" className="rocky-threshold">Seuil · 75 %</button></div>
        <small>La démo simule l’import et le matching : aucun site d’emploi n’est appelé.</small>
      </div>
      {watchRun && <div className="rocky-success"><strong>✓ Veille terminée</strong><span>8 nouvelles annonces ajoutées · 3 recommandations à 80 % ou plus · données figées pour le showroom.</span></div>}

      <div className="rocky-view-tabs">
        {views.map(view => <button key={view.id} type="button" className={cockpitView === view.id ? 'active' : ''} onClick={() => { setCockpitView(view.id); onFeature('dashboard', `view_${view.id}`) }}>{view.label}<span>{view.count}</span></button>)}
      </div>

      <div className="rocky-next-action">
        <div><span className="rocky-small-label">Prochaine action</span><strong>1 réponse recruteur à vérifier</strong><small>Novadata attend une confirmation pour un premier échange.</small></div>
        <button type="button" onClick={() => onFeature('applications', 'open_pending_email')}>Ouvrir le suivi →</button>
      </div>

      <div className="rocky-section-head rocky-results-head"><div><span>Vue active</span><strong>{views.find(view => view.id === cockpitView)?.label}</strong></div><small>{resultCount} résultat(s) dans le scénario</small></div>
      <div className="rocky-jobs-grid">
        {visibleJobs.map(item => {
          const index = jobs.findIndex(job => job.id === item.id)
          return (
            <article key={item.role} className="rocky-job-card">
              <div className="rocky-job-head"><div><span className="rocky-status-pill">{item.status}</span><h3>{item.role}</h3></div><div><small>Score</small><strong>{item.score} %</strong></div></div>
              <strong>{item.company}</strong>
              <p>{item.city} · {item.remote}</p>
              <div className="rocky-job-meta"><span>{item.contract}</span><span>{item.salary}</span><span>{item.source}</span></div>
              <p className="rocky-job-summary">{item.summary}</p>
              <div className="rocky-job-actions"><button type="button" className="rocky-primary-button" onClick={() => openJob(index)}>Fiche complète</button><button type="button" className="rocky-secondary-button" onClick={() => openJob(index, 'matching')}>Pourquoi {item.score} % ?</button></div>
            </article>
          )
        })}
      </div>
      <button type="button" className="rocky-open-flow" onClick={() => { setJobView('list'); onFeature('jobs', 'open_full_flow') }}>Voir tout le flux simulé →</button>
    </section>
  )
}


function BasketView({ feature, onFeature }: { feature: string; onFeature: (feature: string, action?: string) => void }) {
  const [planningFilter, setPlanningFilter] = useState<'Tous' | 'Entraînements' | 'Matchs'>('Tous')
  const [selectedTeam, setSelectedTeam] = useState(1)
  const [selectedConversation, setSelectedConversation] = useState(0)
  const [matchTab, setMatchTab] = useState<'summary' | 'stats' | 'sheet'>('summary')
  const [clubTaskDone, setClubTaskDone] = useState(false)
  const [assistantInput, setAssistantInput] = useState('')
  const [assistantMessages, setAssistantMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: 'Bonjour ! Je peux organiser un planning, préparer un message, retrouver une information ou analyser les données fictives du club.' }
  ])

  const teams = [
    { name: 'U13 Garçons', coach: 'Julien Morel', players: 14, wins: 8, losses: 3, diff: '+74' },
    { name: 'U15 Féminines', coach: 'Sophie Martin', players: 18, wins: 12, losses: 6, diff: '+48' },
    { name: 'Seniors Masculins', coach: 'Karim Diallo', players: 16, wins: 9, losses: 4, diff: '+61' }
  ]

  const schedule = [
    { day: '19 SEP.', time: '17h00 – 18h30', title: 'U13 Garçons', place: 'Gymnase Épernon', type: 'Entraînements' as const },
    { day: '19 SEP.', time: '18h30 – 20h00', title: 'U15 Filles', place: 'Gymnase Épernon', type: 'Entraînements' as const },
    { day: '20 SEP.', time: '10h00', title: 'U13 Garçons vs Chartres', place: 'Gymnase Épernon', type: 'Matchs' as const },
    { day: '20 SEP.', time: '14h30', title: 'U15 Filles vs Rambouillet', place: 'Gymnase Épernon', type: 'Matchs' as const },
    { day: '21 SEP.', time: '16h00', title: 'Seniors M vs Dreux', place: 'Gymnase Épernon', type: 'Matchs' as const }
  ]

  const conversations = [
    { name: 'Staff entraîneurs', preview: 'Réunion lundi 20h', time: '14:32', unread: 2 },
    { name: 'U13 Garçons', preview: 'Prochain entraînement', time: '11:04', unread: 1 },
    { name: 'Parents U11', preview: 'Organisation plateau', time: 'Hier', unread: 0 },
    { name: 'Bureau HGSE', preview: 'Point licences', time: 'Hier', unread: 0 },
    { name: 'Bénévoles', preview: 'Table de marque', time: '17 sept.', unread: 0 }
  ]

  function assistantReply(input: string): string {
    const value = input.toLowerCase()
    if (value.includes('planning') || value.includes('créneau')) return 'Planning fictif vérifié : aucun conflit samedi matin. Je suggère de conserver le créneau U13 à 10h et de réserver 30 minutes de battement avant le match U15 F.'
    if (value.includes('message') || value.includes('parent')) return 'Proposition : « Bonjour à tous, rappel : rendez-vous samedi à 13h45 au gymnase pour U15 F. Merci de confirmer votre présence avant vendredi soir. »'
    if (value.includes('stat') || value.includes('analyse')) return 'Signal principal : les U15 F progressent de 18 % sur l’écart de points depuis janvier, avec une défense plus régulière sur les trois derniers matchs.'
    if (value.includes('document') || value.includes('licence')) return 'Dans ce scénario, le dossier Licences 2026 contient 4 pièces et 7 inscriptions restent à compléter avant la clôture.'
    return 'Je peux agir sur le scénario de démonstration : planning, messages, équipes, matchs, statistiques et documents du club. Essaie « analyse les stats U15 ».'
  }

  function sendAssistant(event: FormEvent) {
    event.preventDefault()
    const cleaned = assistantInput.trim()
    if (!cleaned) return
    const next = [...assistantMessages, { role: 'visitor' as const, text: cleaned }, { role: 'assistant' as const, text: assistantReply(cleaned) }]
    setAssistantMessages(next)
    setAssistantInput('')
    void trackEvent('message_count', { demo: 'basket', count: next.length - 1 })
  }

  const SectionHead = ({ eyebrow, title, note }: { eyebrow: string; title: string; note?: string }) => (
    <div className="hgse-page-head"><div><span>{eyebrow}</span><h1>{title}</h1>{note && <p>{note}</p>}</div><div className="hgse-mark">🏀</div></div>
  )

  if (feature === 'planning') return (
    <section className="hgse-showcase">
      <SectionHead eyebrow="Organisation sportive" title="Planning" note="Entraînements, matchs, créneaux gymnase et événements du club." />
      <div className="hgse-toolbar"><div className="hgse-month"><button type="button">‹</button><strong>Septembre 2026</strong><button type="button">›</button></div><div className="hgse-filter-row">{(['Tous', 'Entraînements', 'Matchs'] as const).map(filter => <button key={filter} type="button" className={planningFilter === filter ? 'active' : ''} onClick={() => { setPlanningFilter(filter); onFeature('planning', `filter_${filter}`) }}>{filter}</button>)}</div></div>
      <div className="hgse-planning-grid">
        <div className="hgse-calendar-card">
          <div className="hgse-weekdays">{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
          <div className="hgse-days">{Array.from({ length: 28 }, (_, index) => index + 1).map(day => <button key={day} type="button" className={day === 19 ? 'selected' : day === 20 || day === 21 ? 'event' : ''}>{day}</button>)}</div>
        </div>
        <div className="hgse-schedule-list">
          {schedule.filter(item => planningFilter === 'Tous' || item.type === planningFilter).map(item => <article key={`${item.day}-${item.title}`}><div className={`hgse-event-dot ${item.type === 'Matchs' ? 'match' : ''}`} /><div><small>{item.day} · {item.time}</small><strong>{item.title}</strong><span>{item.place}</span></div><b>{item.type === 'Matchs' ? 'Match' : 'Entraînement'}</b></article>)}
        </div>
      </div>
    </section>
  )

  if (feature === 'messages') return (
    <section className="hgse-showcase">
      <SectionHead eyebrow="Communication interne" title="Messagerie" note="Équipes, parents, staff, bénévoles et bureau dans un même espace." />
      <div className="hgse-message-layout">
        <div className="hgse-conversation-list">
          <div className="hgse-mini-tabs"><button className="active" type="button">Tous</button><button type="button">Équipes</button><button type="button">Staff</button><button type="button">Association</button></div>
          {conversations.map((conversation, index) => <button key={conversation.name} type="button" className={selectedConversation === index ? 'active' : ''} onClick={() => { setSelectedConversation(index); onFeature('messages', 'open_conversation') }}><div className="hgse-avatar">{conversation.name.slice(0, 2).toUpperCase()}</div><div><strong>{conversation.name}</strong><span>{conversation.preview}</span></div><small>{conversation.time}{conversation.unread > 0 && <b>{conversation.unread}</b>}</small></button>)}
        </div>
        <div className="hgse-thread">
          <div className="hgse-thread-head"><div><strong>{conversations[selectedConversation].name}</strong><span>Groupe interne · scénario de démo</span></div><button type="button" onClick={() => onFeature('assistant', 'draft_message')}>✨ Rédiger avec l’IA</button></div>
          <div className="hgse-thread-body"><div className="incoming"><span>Sophie · 14:20</span><p>Pour lundi, on garde 20h pour le point des entraîneurs ?</p></div><div className="outgoing"><span>Vous · 14:27</span><p>Oui, et je mets le bilan des matchs du week-end à l’ordre du jour.</p></div><div className="incoming"><span>Julien · 14:32</span><p>Parfait. J’ajoute le point sur les créneaux vacances.</p></div></div>
          <div className="hgse-compose"><input placeholder="Écrivez un message…" /><button type="button" onClick={() => onFeature('messages', 'send_mock_message')}>Envoyer</button></div>
        </div>
      </div>
    </section>
  )

  if (feature === 'teams') return (
    <section className="hgse-showcase">
      <SectionHead eyebrow="Gestion sportive" title="Équipes" note="Effectifs, staff, résultats et progression par catégorie." />
      <div className="hgse-team-selector">{teams.map((team, index) => <button key={team.name} type="button" className={selectedTeam === index ? 'active' : ''} onClick={() => { setSelectedTeam(index); onFeature('teams', 'select_team') }}><span>{team.name}</span><small>{team.players} licenciés</small></button>)}</div>
      <div className="hgse-team-hero"><div><span>Saison 2026–2027</span><h2>{teams[selectedTeam].name}</h2><p>Coach · <strong>{teams[selectedTeam].coach}</strong></p></div><div className="hgse-team-record"><div><strong>{teams[selectedTeam].wins}</strong><span>Victoires</span></div><div><strong>{teams[selectedTeam].losses}</strong><span>Défaites</span></div><div><strong>{teams[selectedTeam].diff}</strong><span>Diff. pts</span></div></div></div>
      <div className="hgse-team-detail-grid">
        <article className="hgse-panel"><span className="hgse-label">Évolution des performances</span><div className="hgse-line-chart"><svg viewBox="0 0 500 150" preserveAspectRatio="none"><polyline points="10,115 90,98 170,78 250,72 330,54 410,42 490,22" /><polyline className="opponent" points="10,122 90,116 170,103 250,96 330,83 410,80 490,72" /></svg></div><div className="hgse-legend"><span><i />Points marqués</span><span><i className="orange" />Points encaissés</span></div></article>
        <article className="hgse-panel"><span className="hgse-label">Joueuses / joueurs repères</span>{['Léa D. · 14,8 pts', 'Maya R. · 8,2 reb', 'Inès B. · 5,6 ast', 'Camille T. · 2,4 int'].map((player, index) => <div className="hgse-player-row" key={player}><div className="hgse-avatar">{index + 7}</div><strong>{player}</strong><span>{index === 0 ? 'Forme ↗' : 'Saison'}</span></div>)}</article>
      </div>
    </section>
  )

  if (feature === 'match') return (
    <section className="hgse-showcase">
      <SectionHead eyebrow="Gestion des matchs" title="Fiche match" note="Résumé, statistiques et feuille de match dans une même vue." />
      <div className="hgse-scoreboard"><div><div className="hgse-team-logo">HG</div><strong>HGSE Basket</strong></div><div className="hgse-score-center"><span>U15 F · Championnat</span><strong>68 <em>–</em> 52</strong><small>Sam. 20 sept. 2026 · 14h30 · Gymnase Épernon</small></div><div><div className="hgse-team-logo away">RB</div><strong>Rambouillet</strong></div></div>
      <div className="hgse-tab-row">{([['summary', 'Résumé'], ['stats', 'Stats'], ['sheet', 'Feuille de match']] as const).map(([id, label]) => <button key={id} type="button" className={matchTab === id ? 'active' : ''} onClick={() => { setMatchTab(id); onFeature('match', `tab_${id}`) }}>{label}</button>)}</div>
      {matchTab === 'summary' && <div className="hgse-match-grid"><article className="hgse-panel"><span className="hgse-label">Résumé</span><h3>Une victoire construite par la défense.</h3><p>Très belle solidarité des U15 F, avec une forte pression sur le porteur et une meilleure maîtrise du rebond en seconde période.</p><div className="hgse-mvp"><div className="hgse-avatar">LD</div><div><span>Joueuse du match</span><strong>Léa D.</strong><small>18 points · 7 rebonds · 4 passes</small></div></div></article><article className="hgse-panel"><span className="hgse-label">Temps forts</span><div className="hgse-quarter"><span>Q1</span><strong>16–14</strong></div><div className="hgse-quarter"><span>Q2</span><strong>17–13</strong></div><div className="hgse-quarter"><span>Q3</span><strong>20–10</strong></div><div className="hgse-quarter"><span>Q4</span><strong>15–15</strong></div></article></div>}
      {matchTab === 'stats' && <div className="hgse-kpi-grid"><div><span>eFG %</span><strong>54,8 %</strong><small>+5,2 vs adversaire</small></div><div><span>Rebonds</span><strong>41</strong><small>12 offensifs</small></div><div><span>Passes</span><strong>18</strong><small>ballon bien partagé</small></div><div><span>Turnovers</span><strong>9</strong><small>meilleur total saison</small></div></div>}
      {matchTab === 'sheet' && <div className="hgse-roster-table"><div className="head"><span>Joueuse</span><span>PTS</span><span>REB</span><span>AST</span><span>MIN</span></div>{[['Léa D.',18,7,4,29],['Maya R.',13,9,2,27],['Inès B.',11,4,6,31],['Camille T.',9,5,3,24],['Zoé M.',7,6,1,22]].map(row => <div key={String(row[0])}>{row.map((value, index) => <span key={`${row[0]}-${index}`}>{value}</span>)}</div>)}</div>}
    </section>
  )

  if (feature === 'statistics') return (
    <section className="hgse-showcase">
      <SectionHead eyebrow="Data & performance" title="Statistiques" note="Lecture club, équipes et progression des jeunes sur la saison." />
      <div className="hgse-kpi-grid"><div><span>Licenciés</span><strong>180</strong><small className="positive">+12 % vs N-1</small></div><div><span>Taux de victoire</span><strong>65 %</strong><small>toutes équipes</small></div><div><span>Points / match</span><strong>71,4</strong><small>+4,8 depuis janvier</small></div><div><span>Progression jeunes</span><strong>+32 %</strong><small>U11 → U15</small></div></div>
      <div className="hgse-stats-layout"><article className="hgse-panel"><span className="hgse-label">Progression des équipes jeunes</span><div className="hgse-line-chart large"><svg viewBox="0 0 500 170" preserveAspectRatio="none"><polyline points="10,142 90,128 170,115 250,89 330,73 410,45 490,20" /><polyline className="opponent" points="10,136 90,132 170,121 250,116 330,102 410,94 490,84" /></svg></div><div className="hgse-axis"><span>Jan.</span><span>Fév.</span><span>Mars</span><span>Avr.</span><span>Mai</span><span>Juin</span></div></article><article className="hgse-panel"><span className="hgse-label">Répartition saison</span><div className="hgse-donut"><div><strong>65%</strong><span>victoires</span></div></div><div className="hgse-stat-lines"><div><span>Victoires</span><strong>42</strong></div><div><span>Défaites</span><strong>23</strong></div><div><span>Matchs joués</span><strong>65</strong></div></div></article></div>
      <div className="hgse-team-progress"><span className="hgse-label">Efficacité collective</span>{[['U13 G', 78], ['U15 F', 86], ['U18 M', 72], ['Seniors M', 82]].map(([name, value]) => <div key={String(name)}><strong>{name}</strong><div><i style={{ width: `${value}%` }} /></div><span>{value}</span></div>)}</div>
    </section>
  )

  if (feature === 'club') return (
    <section className="hgse-showcase">
      <SectionHead eyebrow="Pilotage association" title="Club / Association" note="Licences, bénévoles, documents, événements et actions administratives." />
      <div className="hgse-kpi-grid"><div><span>Licences validées</span><strong>173 / 180</strong><small>7 dossiers à compléter</small></div><div><span>Bénévoles actifs</span><strong>32</strong><small>6 missions ce week-end</small></div><div><span>Documents</span><strong>48</strong><small>4 modifiés cette semaine</small></div><div><span>Événements</span><strong>5</strong><small>sur les 30 prochains jours</small></div></div>
      <div className="hgse-club-grid"><article className="hgse-panel"><span className="hgse-label">Actions à faire</span><div className={`hgse-task ${clubTaskDone ? 'done' : ''}`}><button type="button" onClick={() => { setClubTaskDone(true); onFeature('club', 'complete_task') }}>{clubTaskDone ? '✓' : '○'}</button><div><strong>Relancer 7 dossiers licences</strong><span>Échéance · 24 septembre</span></div></div><div className="hgse-task"><button type="button">○</button><div><strong>Confirmer les bénévoles table de marque</strong><span>3 réponses manquantes</span></div></div><div className="hgse-task"><button type="button">○</button><div><strong>Publier les horaires du week-end</strong><span>Site + groupes équipes</span></div></div></article><article className="hgse-panel"><span className="hgse-label">Documents récents</span>{[['Règlement intérieur 2026', 'PDF · Bureau'], ['Planning gymnase septembre', 'XLSX · Sportif'], ['Dossier licences 2026', '7 incomplets'], ['Charte bénévoles', 'PDF · Association']].map(([name, meta]) => <button className="hgse-document" type="button" key={name} onClick={() => onFeature('club', 'open_document')}><span>▤</span><div><strong>{name}</strong><small>{meta}</small></div><b>→</b></button>)}</article></div>
    </section>
  )

  if (feature === 'assistant') return (
    <section className="hgse-showcase hgse-assistant-page">
      <SectionHead eyebrow="Assistant agentique" title="Assistant HGSE" note="Un copilote de club capable de retrouver, analyser, rédiger et proposer des actions." />
      <div className="hgse-agent-status"><div className="hgse-agent-orb">HG</div><div><strong>Assistant HGSE</strong><span><i /> En ligne · données de démonstration</span></div><em>IA</em></div>
      <div className="hgse-agent-actions">{[['▣', 'Créer un planning'], ['✎', 'Rédiger un message'], ['▥', 'Analyser les statistiques'], ['⌕', 'Rechercher un joueur'], ['▤', 'Trouver un document'], ['✓', 'Aide à la gestion du club']].map(([icon, label]) => <button key={label} type="button" onClick={() => { setAssistantInput(label); onFeature('assistant', `quick_${label}`) }}><span>{icon}</span>{label}</button>)}</div>
      <div className="hgse-agent-chat">{assistantMessages.map((message, index) => <div key={index} className={message.role === 'visitor' ? 'visitor' : 'assistant'}><span>{message.role === 'visitor' ? 'Vous' : 'Assistant HGSE'}</span><p>{message.text}</p></div>)}</div>
      <form className="hgse-agent-form" onSubmit={sendAssistant}><input value={assistantInput} onChange={event => setAssistantInput(event.target.value)} placeholder="Écrivez votre demande…" /><button type="submit">Envoyer</button></form>
    </section>
  )

  return (
    <section className="hgse-showcase">
      <div className="hgse-dashboard-top"><div className="hgse-search">⌕ <input placeholder="Rechercher un joueur, un match, un document…" /></div><div className="hgse-admin"><span className="hgse-notification">♟<b>3</b></span><div className="hgse-avatar">NB</div><div><strong>Nicolas</strong><small>Administrateur</small></div></div></div>
      <div className="hgse-hero"><div><span>HGSE BASKET · ÉPERNON</span><h1>Bienvenue au HGSE Basket</h1><p>Sport <i>·</i> Partage <i>·</i> Respect <i>·</i> Progression</p></div><div className="hgse-hero-ball">🏀</div><strong>Plus qu’un club,<br />une famille !</strong></div>
      <div className="hgse-kpi-grid dashboard"><div><span>Équipes</span><strong>12</strong><small>U7 → Seniors</small></div><div><span>Licenciés</span><strong>180</strong><small className="positive">+12 % cette saison</small></div><div><span>Matchs ce mois-ci</span><strong>28</strong><small>11 à domicile</small></div><div><span>Bénévoles actifs</span><strong>32</strong><small>6 mobilisés ce week-end</small></div></div>
      <div className="hgse-dashboard-grid">
        <div className="hgse-dashboard-main">
          <div className="hgse-home-columns"><article className="hgse-panel"><div className="hgse-panel-head"><strong>Prochains événements</strong><button type="button" onClick={() => onFeature('planning', 'view_all')}>Voir tout →</button></div>{schedule.slice(2, 5).map(item => <div className="hgse-event-row" key={item.title}><time>{item.day.replace(' SEP.', '')}<small>SEP.</small></time><div><strong>{item.title}</strong><span>{item.time} · {item.place}</span></div><b>Match</b></div>)}</article><article className="hgse-panel"><div className="hgse-panel-head"><strong>Actualités du club</strong><button type="button" onClick={() => onFeature('club', 'news')}>Voir tout →</button></div><div className="hgse-news"><span>15 sept.</span><strong>Reprise des entraînements</strong><p>La saison 2026–2027 est lancée : tous les créneaux sont en ligne.</p></div><div className="hgse-news"><span>12 sept.</span><strong>Inscriptions encore ouvertes</strong><p>Quelques places restent disponibles en U13 et U15.</p></div><div className="hgse-news"><span>8 sept.</span><strong>Tournoi de rentrée</strong><p>Un grand merci à tous les bénévoles.</p></div></article></div>
          <article className="hgse-panel hgse-global-stats"><div className="hgse-panel-head"><strong>Statistiques globales · 2025–2026</strong><button type="button" onClick={() => onFeature('statistics', 'open_stats')}>Explorer →</button></div><div className="hgse-global-row"><div><strong>180</strong><span>Licenciés</span><small>+12 %</small></div><div className="hgse-mini-bars">{[24, 34, 44, 55, 68, 82, 96].map(value => <i key={value} style={{ height: `${value}%` }} />)}</div><div><strong>65 %</strong><span>Taux de victoires</span></div><div className="hgse-mini-donut" /><div><strong>+32 %</strong><span>Progression jeunes</span><small>U11 → U15</small></div></div></article>
        </div>
        <aside className="hgse-assistant-card"><div className="hgse-agent-status compact"><div className="hgse-agent-orb">HG</div><div><strong>Assistant HGSE</strong><span><i /> En ligne</span></div><em>IA</em></div><div className="hgse-assistant-welcome"><div className="hgse-agent-orb tiny">HG</div><p>Bonjour ! 👋<br />Je peux gérer les plannings, retrouver des informations, analyser les statistiques ou rédiger un message aux licenciés.</p></div><span className="hgse-question">Que puis-je faire pour vous aujourd’hui ?</span>{['Créer un planning', 'Rédiger un message', 'Analyser les statistiques', 'Rechercher un joueur', 'Trouver un document'].map(label => <button key={label} type="button" onClick={() => onFeature('assistant', `dashboard_${label}`)}>{label}<span>→</span></button>)}</aside>
      </div>
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
  const members = ['Tous', 'Parent 1', 'Parent 2', 'Enfants'] as const
  const [selectedMember, setSelectedMember] = useState<(typeof members)[number]>('Tous')
  const [lightsOn, setLightsOn] = useState(true)
  const [homeMode, setHomeMode] = useState<'Soirée' | 'Film' | 'Départ' | 'Nuit'>('Soirée')
  const [routineFeedback, setRoutineFeedback] = useState('Maison calme · aucune alerte')
  const [groceries, setGroceries] = useState([
    { label: 'Lait', done: false },
    { label: 'Pain', done: true },
    { label: 'Pommes', done: false },
    { label: 'Pâtes', done: false },
    { label: 'Produit vaisselle', done: false }
  ])
  const [newItem, setNewItem] = useState('')
  const [extraTask, setExtraTask] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_JARVIS_CHAT)
  const chatStarted = useRef(false)

  const familyEvents = [
    { time: '08:30', member: 'Enfants', title: 'École', note: 'Dépose du matin' },
    { time: '14:00', member: 'Parent 2', title: 'Rendez-vous', note: 'Centre-ville · 45 min' },
    { time: '17:30', member: 'Enfants', title: 'Activité enfant', note: 'Sport · sac à prévoir' },
    { time: '19:30', member: 'Tous', title: 'Dîner', note: 'Repas en famille' }
  ]

  function addGrocery(label: string) {
    const clean = label.trim()
    if (!clean) return
    setGroceries(items => items.some(item => item.label.toLowerCase() === clean.toLowerCase()) ? items : [...items, { label: clean, done: false }])
    setNewItem('')
  }

  function runRoutine(mode: 'Film' | 'Départ' | 'Nuit' | 'Soirée') {
    setHomeMode(mode)
    if (mode === 'Film') {
      setLightsOn(true)
      setRoutineFeedback('Mode Film · lumière salon tamisée · volets fermés')
    } else if (mode === 'Départ') {
      setLightsOn(false)
      setRoutineFeedback('Mode Départ · lumières coupées · portes vérifiées')
    } else if (mode === 'Nuit') {
      setLightsOn(false)
      setRoutineFeedback('Mode Nuit · maison sécurisée · température abaissée')
    } else {
      setLightsOn(true)
      setRoutineFeedback('Mode Soirée · éclairage doux · confort activé')
    }
    onFeature('home', `routine_${mode.toLowerCase()}`)
  }

  function answerJarvis(cleaned: string): string {
    const value = cleaned.toLowerCase()
    if (value.includes('film')) {
      runRoutine('Film')
      return 'Mode Film activé. J’ai tamisé l’éclairage du salon et fermé les volets dans cette démo.'
    }
    if (value.includes('café') || value.includes('cafe')) {
      addGrocery('Café')
      return 'Café ajouté à la liste de courses. La liste partagée est à jour.'
    }
    if ((value.includes('éteins') || value.includes('eteins')) && value.includes('salon')) {
      setLightsOn(false)
      setRoutineFeedback('Salon · lumières éteintes sur demande')
      return 'C’est fait. Les lumières du salon sont éteintes dans la simulation.'
    }
    if (value.includes('départ') || value.includes('depart')) {
      runRoutine('Départ')
      return 'Mode Départ prêt : lumières coupées, portes vérifiées et maison passée en économie.'
    }
    if (value.includes('poubelle')) {
      setExtraTask(true)
      return 'J’ai ajouté « Sortir les poubelles » aux tâches de demain.'
    }
    if (value.includes('demain') || value.includes('enfant')) return 'Demain : école à 8 h 30, activité à 17 h 30 et un rappel pour le sac de sport. Le créneau le plus chargé est entre 16 h 30 et 19 h.'
    if (value.includes('course')) return `Il reste ${groceries.filter(item => !item.done).length} article(s) à prendre. Les priorités sont le lait, les pâtes et les pommes.`
    if (value.includes('dépense') || value.includes('depense') || value.includes('budget')) return 'Le budget commun simulé est maîtrisé : 1 245 € dépensés sur 1 800 € ce mois-ci. Les courses représentent le premier poste.'
    if (value.includes('journ') || value.includes('résume') || value.includes('resume')) return 'Tu as quatre temps forts aujourd’hui. Le prochain est à 14 h, quatre tâches restent ouvertes et la maison est en mode Soirée.'
    return 'Je peux résumer l’agenda, agir sur la maison, mettre à jour les courses ou te donner une synthèse du foyer. Tout reste local à cette démonstration.'
  }

  function send(e: FormEvent) {
    e.preventDefault()
    const cleaned = input.trim()
    if (!cleaned) return
    const reply = answerJarvis(cleaned)
    const next = [...messages, { role: 'visitor' as const, text: cleaned }, { role: 'assistant' as const, text: reply }]
    setMessages(next)
    setInput('')
    if (!chatStarted.current) {
      chatStarted.current = true
      void trackEvent('chat_started', { demo: 'jarvis' })
    }
    void trackEvent('message_count', { demo: 'jarvis', count: next.length - 1 })
  }

  const Core = ({ compact = false }: { compact?: boolean }) => (
    <div className={`jarvis-core ${compact ? 'compact' : ''}`} aria-hidden="true">
      <i className="jarvis-ring ring-one" /><i className="jarvis-ring ring-two" /><i className="jarvis-ring ring-three" />
      <div className="jarvis-core-center"><span>|||</span><strong>JARVIS</strong></div>
    </div>
  )

  if (feature === 'family') {
    const visibleEvents = familyEvents.filter(event => selectedMember === 'Tous' || event.member === selectedMember || event.member === 'Tous')
    return (
      <section className="jarvis-page">
        <div className="jarvis-page-head"><div><span>FAMILLE</span><h1>Planning partagé</h1><p>La journée de chacun, réunie sans surcharge.</p></div><div className="jarvis-status-pill">Dim. 20 sept. · 4 événements</div></div>
        <div className="jarvis-filter-row">{members.map(member => <button key={member} type="button" className={selectedMember === member ? 'active' : ''} onClick={() => { setSelectedMember(member); onFeature('family', `filter_${member}`) }}>{member}</button>)}</div>
        <div className="jarvis-family-layout">
          <div className="jarvis-panel">
            <div className="jarvis-panel-title"><span>AUJOURD’HUI</span><strong>Dimanche 20 septembre</strong></div>
            <div className="jarvis-family-timeline">{visibleEvents.map(event => <article key={`${event.time}-${event.title}`}><time>{event.time}</time><i /><div><strong>{event.title}</strong><span>{event.member} · {event.note}</span></div></article>)}</div>
          </div>
          <div className="jarvis-side-stack">
            <div className="jarvis-panel"><div className="jarvis-panel-title"><span>À NE PAS OUBLIER</span><strong>3 rappels</strong></div><ul className="jarvis-reminders"><li>🎒 Sac de sport · 17 h 30</li><li>✉️ Autorisation scolaire · demain</li><li>🎂 Anniversaire · samedi</li></ul></div>
            <div className="jarvis-ai-note"><Core compact /><div><span>SYNTHÈSE JARVIS</span><strong>Fin de journée dense</strong><p>Deux événements se suivent entre 17 h 30 et 19 h 30. Prévoir le départ à 17 h 05.</p></div></div>
          </div>
        </div>
      </section>
    )
  }

  if (feature === 'home') return (
    <section className="jarvis-page">
      <div className="jarvis-page-head"><div><span>MAISON</span><h1>Maison connectée</h1><p>Des commandes simples, avec un état immédiatement lisible.</p></div><div className="jarvis-status-pill good">● Sécurisée · {homeMode}</div></div>
        <div className="jarvis-room-grid">
          <button type="button" className={lightsOn ? 'active' : ''} onClick={() => { setLightsOn(value => !value); onFeature('home', 'toggle_living_room') }}><span>Salon</span><strong>21 °C</strong><small>{lightsOn ? '💡 Lumière 60 %' : '○ Lumières éteintes'}</small></button>
          <article><span>Cuisine</span><strong>20.5 °C</strong><small>Volets ouverts · prise café OFF</small></article>
          <article><span>Chambre</span><strong>19.2 °C</strong><small>Volets 80 % · calme</small></article>
          <article><span>Entrée</span><strong>Portes OK</strong><small>Alarme veille · aucun mouvement</small></article>
        </div>
        <div className="jarvis-section-title"><div><span>ROUTINES</span><h2>Un geste, plusieurs actions</h2></div><small>{routineFeedback}</small></div>
        <div className="jarvis-routine-grid">
          {[['Soirée', '☾', 'Éclairage doux · confort'], ['Film', '▶', 'Lumières tamisées · volets'], ['Départ', '↗', 'Extinction · sécurité'], ['Nuit', '✦', 'Verrouillage · économie']].map(([mode, icon, note]) => <button key={mode} type="button" className={homeMode === mode ? 'active' : ''} onClick={() => runRoutine(mode as 'Film' | 'Départ' | 'Nuit' | 'Soirée')}><b>{icon}</b><strong>{mode}</strong><span>{note}</span></button>)}
        </div>
      </section>
    )

  if (feature === 'organization') return (
    <section className="jarvis-page">
      <div className="jarvis-page-head"><div><span>ORGANISATION</span><h1>Le quotidien partagé</h1><p>Courses, tâches et budget dans une vue légère.</p></div><div className="jarvis-status-pill">4 tâches · {groceries.filter(item => !item.done).length} courses</div></div>
        <div className="jarvis-organization-grid">
          <div className="jarvis-panel">
            <div className="jarvis-panel-title"><span>COURSES</span><strong>Liste familiale</strong></div>
            <div className="jarvis-grocery-list">{groceries.map((item, index) => <label key={item.label} className={item.done ? 'done' : ''}><input type="checkbox" checked={item.done} onChange={() => setGroceries(items => items.map((current, i) => i === index ? { ...current, done: !current.done } : current))} /><span>{item.label}</span></label>)}</div>
            <form className="jarvis-add-row" onSubmit={event => { event.preventDefault(); addGrocery(newItem); onFeature('organization', 'add_grocery') }}><input value={newItem} onChange={event => setNewItem(event.target.value)} placeholder="Ajouter un article…" /><button type="submit">＋</button></form>
          </div>
          <div className="jarvis-panel">
            <div className="jarvis-panel-title"><span>TÂCHES</span><strong>À faire</strong></div>
            <div className="jarvis-task-list"><div><i>✓</i><span><strong>Commander les courses</strong><small>Famille · aujourd’hui</small></span></div><div><i>○</i><span><strong>Ranger la chambre</strong><small>Enfants · ce soir</small></span></div><div><i>○</i><span><strong>Préparer les sacs</strong><small>Parent 1 · demain</small></span></div>{extraTask && <div className="new"><i>○</i><span><strong>Sortir les poubelles</strong><small>Parent 2 · demain</small></span></div>}</div>
          </div>
          <div className="jarvis-panel jarvis-budget-panel">
            <div className="jarvis-panel-title"><span>BUDGET DU FOYER</span><strong>Septembre</strong></div>
            <div className="jarvis-budget-total"><strong>1 245 €</strong><span>/ 1 800 €</span></div>
            <div className="jarvis-budget-bar"><i style={{ width: '69%' }} /></div>
            <div className="jarvis-budget-lines"><div><span>Courses</span><strong>420 €</strong></div><div><span>Maison</span><strong>315 €</strong></div><div><span>Loisirs</span><strong>190 €</strong></div></div>
          </div>
        </div>
      </section>
    )

  if (feature === 'assistant') return (
    <section className="jarvis-page jarvis-assistant-page">
      <div className="jarvis-assistant-head"><Core /><div><span>JARVIS · ASSISTANT FAMILIAL</span><h1>Que puis-je simplifier ?</h1><p>Je consulte le scénario du foyer et je peux déclencher des actions locales dans la démo.</p></div></div>
      <div className="jarvis-command-chips"><button type="button" onClick={() => setInput('Résume ma journée')}>Résume ma journée</button><button type="button" onClick={() => setInput('Active le mode film')}>Mode film</button><button type="button" onClick={() => setInput('Ajoute du café aux courses')}>Ajouter du café</button><button type="button" onClick={() => setInput('Qu’est-ce qu’on a demain ?')}>Demain ?</button></div>
      <div className="jarvis-chat">{messages.map((message, index) => <div key={index} className={message.role}><span>{message.role === 'assistant' ? 'JARVIS' : 'VOUS'}</span><p>{message.text}</p></div>)}</div>
      <form className="jarvis-chat-form" onSubmit={send}><Core compact /><input value={input} onChange={event => setInput(event.target.value)} placeholder="Demandez à Jarvis…" /><button type="submit">Envoyer</button></form>
      <div className="jarvis-agent-strip"><span>Exemples d’actions</span><button type="button" onClick={() => { runRoutine('Film'); onFeature('assistant', 'quick_film') }}>▶ Mode Film</button><button type="button" onClick={() => { addGrocery('Café'); onFeature('assistant', 'quick_grocery') }}>＋ Café aux courses</button><button type="button" onClick={() => { setLightsOn(false); onFeature('assistant', 'quick_lights') }}>○ Éteindre le salon</button></div>
    </section>
  )

  return (
    <section className="jarvis-page jarvis-home-page">
      <div className="jarvis-welcome"><div><span>DIMANCHE 20 SEPTEMBRE 2026 · 20:42</span><h1>Bonsoir.<br /><strong>Tout est sous contrôle.</strong></h1><p>Une maison plus douce. Une famille mieux organisée.</p></div><div className="jarvis-weather">☁︎ <strong>12 °C</strong><span>Ciel dégagé</span></div></div>
      <div className="jarvis-dashboard-grid">
        <div className="jarvis-panel jarvis-today-card"><div className="jarvis-panel-title"><span>AUJOURD’HUI</span><button type="button" onClick={() => onFeature('family', 'open_family')}>Voir tout →</button></div>{familyEvents.slice(0, 3).map(event => <div className="jarvis-mini-event" key={event.time}><time>{event.time}</time><i /><div><strong>{event.title}</strong><span>{event.member}</span></div></div>)}</div>
        <div className="jarvis-core-stage"><Core /><span>ÉCOUTE · ANTICIPE · SIMPLIFIE</span></div>
        <div className="jarvis-panel jarvis-home-summary"><div className="jarvis-panel-title"><span>MAISON</span><button type="button" onClick={() => onFeature('home', 'open_home')}>Tout voir →</button></div><div className="jarvis-home-mini-grid"><div><span>Salon</span><strong>21 °C</strong><small>Confort optimal</small></div><div><span>Lumières</span><strong>{lightsOn ? '3 actives' : 'Éteintes'}</strong><small>{lightsOn ? 'mode doux' : 'économie'}</small></div><div><span>Portes</span><strong className="good">Sécurisées</strong><small>Aucune alerte</small></div><div><span>Mode</span><strong>{homeMode}</strong><small>Routine active</small></div></div></div>
        <div className="jarvis-panel jarvis-org-summary"><div className="jarvis-panel-title"><span>ORGANISATION</span><button type="button" onClick={() => onFeature('organization', 'open_organization')}>Voir tout →</button></div><div className="jarvis-summary-line"><b>✓</b><div><strong>{extraTask ? 5 : 4} tâches restantes</strong><span>2 prioritaires aujourd’hui</span></div></div><div className="jarvis-summary-line"><b>🛒</b><div><strong>{groceries.filter(item => !item.done).length} articles à prendre</strong><span>liste partagée</span></div></div></div>
        <div className="jarvis-suggestion"><Core compact /><div><span>SUGGESTION JARVIS</span><strong>Vous partez dans 20 minutes.</strong><p>Je peux préparer la maison et vérifier les points essentiels.</p><button type="button" onClick={() => runRoutine('Départ')}>{homeMode === 'Départ' ? '✓ Mode Départ activé' : 'Activer le mode Départ'}</button></div></div>
      </div>
      <div className="jarvis-quickbar"><Core compact /><span>Demandez à Jarvis…</span><button type="button" onClick={() => onFeature('assistant', 'ask_day')}>Résume ma journée</button><button type="button" onClick={() => onFeature('assistant', 'ask_courses')}>Liste de courses</button><button type="button" onClick={() => onFeature('assistant', 'ask_evening')}>Prépare ce soir</button></div>
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

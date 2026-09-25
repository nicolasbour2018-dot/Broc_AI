import { FormEvent, useEffect, useState } from 'react'
import { downloadAdminExport, fetchAdminJourneys, fetchAdminMetrics, updateAdminRouting } from './api'
import type { AdminJourneys, AdminMetrics, AiJobStatus, AiRoutingMode, JourneyContext, JourneyStage, JourneyWindow } from './types'
import './admin.css'

const ADMIN_TOKEN_KEY = 'brocai-admin-token'

function metric(value: number | null, suffix = ''): string {
  if (value === null) return '—'
  return `${Math.round(value * 10) / 10}${suffix}`
}

function ms(value: number | null): string {
  if (value === null) return '—'
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(1)} s`
}

function opsIcon(level: AdminMetrics['ops']['level']): string {
  if (level === 'critical') return '🔴'
  if (level === 'warning') return '⚠️'
  return '✅'
}

function statusLabel(status: AiJobStatus): string {
  if (status === 'queued') return 'en attente'
  if (status === 'running') return 'en cours'
  if (status === 'success') return 'succès'
  if (status === 'timeout') return 'timeout'
  return 'erreur'
}

const JOURNEY_STAGES: Array<[JourneyStage, string]> = [
  ['session_started', 'Session démarrée'],
  ['onboarding_viewed', 'Accueil initial vu'],
  ['onboarding_marketplace_clicked', 'Marché choisi depuis l’accueil'],
  ['marketplace_opened', 'Marché ouvert'],
  ['marketplace_category_selected', 'Catégorie choisie'],
  ['search_performed', 'Recherche saisie'],
  ['listing_viewed', 'Fiche ouverte'],
]

const JOURNEY_CONTEXTS: Array<[JourneyContext, string]> = [
  ['visitor', 'Visiteur'],
  ['seller', 'Vendeur'],
  ['unknown', 'Non classé'],
]

function JourneySummary({ title, window }: { title: string; window: JourneyWindow }) {
  const { segments, batches } = window
  return <article className="admin-journey-card">
    <h4>{title}</h4>
    <div className="admin-journey-table-wrap"><table className="admin-journey-table">
      <thead><tr><th>Étape · sessions distinctes</th>{JOURNEY_CONTEXTS.map(([context, label]) => <th key={context}>{label}</th>)}</tr></thead>
      <tbody>{JOURNEY_STAGES.map(([stage, label]) => <tr key={stage}><th>{label}</th>{JOURNEY_CONTEXTS.map(([context]) => <td key={context}>{segments[context].sessions[stage]}</td>)}</tr>)}</tbody>
    </table></div>
    <p className="admin-journey-detail">Fiches qualifiées : {segments.visitor.views.other + segments.seller.views.other} · propres fiches : {segments.seller.views.own} · contexte inconnu : {segments.unknown.views.unknown}</p>
    <p className="admin-journey-detail">Séries : {batches.started} lancée(s) · {batches.completed} analysée(s) · {batches.published} publiée(s) · {batches.published_items} annonce(s) publiée(s) · {batches.failed_items} échec(s)</p>
    <p className="admin-journey-detail">Le contexte est lu à chaque action : un appareil peut devenir vendeur pendant une session.</p>
  </article>
}

export default function Admin({ goHome }: { goHome: () => void }) {
  const remembered = sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''
  const [tokenInput, setTokenInput] = useState(remembered)
  const [activeToken, setActiveToken] = useState('')
  const [data, setData] = useState<AdminMetrics | null>(null)
  const [journeys, setJourneys] = useState<AdminJourneys | null>(null)
  const [journeyError, setJourneyError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [routingBusy, setRoutingBusy] = useState(false)

  async function refreshJourneys(token: string) {
    try {
      setJourneys(await fetchAdminJourneys(token))
      setJourneyError('')
    } catch (err) {
      setJourneyError(err instanceof Error ? `Parcours indisponibles : ${err.message}` : 'Parcours indisponibles.')
    }
  }

  async function authenticate(token: string, remember = true) {
    const cleaned = token.trim()
    if (!cleaned) return
    setLoading(true)
    setError('')
    try {
      const metrics = await fetchAdminMetrics(cleaned)
      setData(metrics)
      setActiveToken(cleaned)
      void refreshJourneys(cleaned)
      if (remember) sessionStorage.setItem(ADMIN_TOKEN_KEY, cleaned)
    } catch (err) {
      setData(null)
      setActiveToken('')
      setError(err instanceof Error ? err.message : 'Accès admin impossible.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (remembered) void authenticate(remembered, false)
  }, [])

  useEffect(() => {
    if (!activeToken) return
    const timer = window.setInterval(() => {
      void fetchAdminMetrics(activeToken)
        .then(metrics => {
          setData(metrics)
          setError('')
        })
        .catch(err => {
          setError(err instanceof Error ? `Actualisation impossible : ${err.message}` : 'Actualisation impossible.')
        })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [activeToken])

  useEffect(() => {
    if (!activeToken) return
    const timer = window.setInterval(() => { void refreshJourneys(activeToken) }, 15 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [activeToken])

  function submit(e: FormEvent) {
    e.preventDefault()
    void authenticate(tokenInput)
  }

  async function changeRoutingMode(mode: AiRoutingMode) {
    if (!activeToken || !data || routingBusy || data.routing_control.active_mode === mode) return

    const labels: Record<AiRoutingMode, string> = {
      auto: 'AUTO — Gemini principal avec fallback Qwen',
      gemini_only: 'GEMINI ONLY — aucun fallback Qwen automatique',
      qwen_only: 'QWEN ONLY — Gemini désactivé temporairement'
    }
    if (!window.confirm(`Passer le routage IA en ${labels[mode]} ?`)) return

    setRoutingBusy(true)
    setError('')
    try {
      await updateAdminRouting(activeToken, mode)
      setData(await fetchAdminMetrics(activeToken))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Changement de routage impossible.')
    } finally {
      setRoutingBusy(false)
    }
  }

  async function exportData(dataset: 'events' | 'ai_jobs' | 'listings', format: 'csv' | 'json') {
    if (!activeToken) return
    setError('')
    try {
      await downloadAdminExport(activeToken, dataset, format)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export impossible.')
    }
  }

  function logout() {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY)
    setTokenInput('')
    setActiveToken('')
    setData(null)
    setJourneys(null)
    setJourneyError('')
    setError('')
  }

  if (!data) return (
    <main className="screen admin-screen">
      <button className="back" type="button" onClick={goHome}>← Accueil</button>
      <p className="eyebrow">Administration</p>
      <h2>Dashboard BrocAI</h2>
      <p className="lead small">Entre le token admin configuré sur la VM. Il reste uniquement dans cette session du navigateur.</p>
      <form className="admin-login" onSubmit={submit}>
        <label>Token admin<input autoFocus type="password" autoComplete="off" value={tokenInput} onChange={e => setTokenInput(e.target.value)} /></label>
        <button className="primary" disabled={loading || !tokenInput.trim()} type="submit">{loading ? 'Vérification…' : 'Ouvrir le dashboard'}</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  )

  return (
    <main className="screen wide admin-screen">
      <div className="admin-topbar">
        <div><p className="eyebrow">Console Ops</p><h2>État BrocAI</h2></div>
        <div className="admin-top-actions"><button className="secondary compact" type="button" onClick={() => void authenticate(activeToken, false)}>Actualiser</button><button className="text-action" type="button" onClick={logout}>Fermer</button></div>
      </div>

      {error && <p className="error">{error}</p>}

      <section className={`admin-health admin-health-${data.ops.level}`}>
        <strong>{opsIcon(data.ops.level)} {data.ops.label}</strong>
        <span>{data.ops.detail}</span>
      </section>

      <section className="admin-control-panel">
        <div className="admin-section-title">
          <div><p className="eyebrow">Contrôle IA</p><h3>Routage manuel</h3></div>
          <span className={`admin-routing-badge ${data.routing_control.override_active ? 'admin-routing-badge-override' : ''}`}>
            {data.routing_control.override_active ? 'OVERRIDE RUNTIME' : 'CONFIG SERVEUR'}
          </span>
        </div>
        <div className="admin-routing-summary">
          <div><span>Mode actif</span><strong>{data.routing_control.active_mode}</strong></div>
          <div><span>Au redémarrage</span><strong>{data.routing_control.configured_mode}</strong></div>
          <div><span>Fallback Qwen</span><strong>{data.routing_control.fallback_configured ? 'configuré' : 'non configuré'}</strong></div>
        </div>
        <div className="admin-routing-buttons">
          {([
            ['auto', 'AUTO', 'Gemini 3.5 → Qwen si panne · scale-up 3.6 si nécessaire'],
            ['gemini_only', 'GEMINI ONLY', 'Gemini uniquement · aucun fallback Qwen automatique'],
            ['qwen_only', 'QWEN ONLY', 'Qwen forcé · Gemini temporairement désactivé']
          ] as Array<[AiRoutingMode, string, string]>).map(([mode, label, description]) => (
            <button
              key={mode}
              className={`admin-routing-option ${data.routing_control.active_mode === mode ? 'admin-routing-option-active' : ''}`}
              type="button"
              aria-pressed={data.routing_control.active_mode === mode}
              disabled={routingBusy || data.routing_control.active_mode === mode}
              onClick={() => void changeRoutingMode(mode)}
            >
              <strong>{data.routing_control.active_mode === mode ? '● ' : '○ '}{label}</strong>
              <small>{description}</small>
            </button>
          ))}
        </div>
        <p className="admin-routing-note">Override runtime uniquement : un redémarrage du backend revient automatiquement à <strong>{data.routing_control.configured_mode}</strong>.</p>
      </section>

      <section className="admin-grid admin-grid-ops">
        <article className="admin-card"><span>Service</span><strong className="admin-ok">LIVE {data.service.live.toUpperCase()}</strong><small>READY {data.service.ready} · DB {data.service.database} · stockage {data.service.storage}</small></article>
        <article className="admin-card"><span>Charge IA</span><strong>{data.queue.running}/{data.queue.max_in_flight}</strong><small>{data.queue.queued} en attente · slots totaux occupés</small></article>
        <article className="admin-card"><span>CORE</span><strong>{data.queue.core.running} actifs</strong><small>{data.queue.core.queued} en attente · priorité haute</small></article>
        <article className="admin-card"><span>FUN</span><strong>{data.queue.fun.running}/{data.queue.fun.max_in_flight}</strong><small>{data.queue.fun.queued} en attente · cap protégé</small></article>
        <article className="admin-card"><span>Succès IA · 1 h</span><strong>{metric(data.ai.last_hour_success_rate_percent, ' %')}</strong><small>{data.ai.last_hour_terminal} job(s) terminé(s)</small></article>
        <article className="admin-card"><span>Erreurs IA · 1 h</span><strong>{metric(data.ai.last_hour_error_rate_percent, ' %')}</strong><small>{data.ai.error} erreurs · {data.ai.timeout} timeouts au total</small></article>
        <article className="admin-card"><span>Latence IA récente</span><strong>{ms(data.ai.average_latency_ms)}</strong><small>{data.ai.recent_sample_size} job(s) échantillonné(s)</small></article>
        <article className="admin-card"><span>Attente queue</span><strong>{ms(data.ai.average_queue_wait_ms)}</strong><small>moyenne sur les derniers jobs</small></article>
        <article className="admin-card admin-provider-card"><span>Providers · 1 h</span><strong>{data.ai.providers.sample_size} analyses</strong><small>3.5 : {data.ai.providers.gemini_primary} · 3.6 : {data.ai.providers.gemini_quality} · Qwen : {data.ai.providers.qwen}</small><small>fallback Qwen auto : {data.ai.providers.fallback_qwen}</small></article>
      </section>

      <section className="admin-section">
        <div className="admin-section-title"><div><p className="eyebrow">Derniers jobs IA</p><h3>Activité récente</h3></div><small>Mise à jour automatique toutes les 5 s</small></div>
        {data.recent_jobs.length === 0 ? <p className="muted">Aucun job IA pour le moment.</p> : <div className="admin-job-list">{data.recent_jobs.map(job => <div key={job.id} className="admin-job">
          <div className="admin-job-feature"><span className={`admin-lane admin-lane-${job.lane}`}>{job.lane.toUpperCase()}</span><strong>{job.feature}</strong></div>
          <span className={`admin-status admin-status-${job.status}`}>{statusLabel(job.status)}</span>
          <span className="admin-mode" title={job.analysis_mode || undefined}>{job.analysis_mode || 'provider —'}</span>
          <span>{job.error_code || ms(job.duration_ms)}</span>
          <span className="admin-job-wait">attente {ms(job.queue_wait_ms)}</span>
        </div>)}</div>}
      </section>

      {data.recent_errors.length > 0 && <section className="admin-section">
        <div className="admin-section-title"><div><p className="eyebrow">Erreurs récentes</p><h3>À regarder si le voyant passe au rouge</h3></div></div>
        <div className="admin-error-list">{data.recent_errors.map(job => <div key={job.id} className="admin-error-row">
          <div><span className={`admin-lane admin-lane-${job.lane}`}>{job.lane.toUpperCase()}</span><strong>{job.feature}</strong></div>
          <code>{job.error_code || job.status}</code>
          <span>{job.error_message || 'Aucun message détaillé.'}</span>
        </div>)}</div>
      </section>}

      {data.ops_timeline.length > 0 && <section className="admin-section">
        <div className="admin-section-title"><div><p className="eyebrow">Timeline Ops</p><h3>Interventions manuelles</h3></div><small>8 dernières actions</small></div>
        <div className="admin-timeline">{data.ops_timeline.map(event => <div key={event.id} className="admin-timeline-row">
          <time>{new Date(event.created_at).toLocaleTimeString('fr-FR')}</time>
          <strong>{event.action || 'action'}</strong>
          <span>{event.from_mode && event.to_mode ? `${event.from_mode} → ${event.to_mode}` : event.target || '—'}</span>
          <small>{event.reason || event.result || '—'}</small>
        </div>)}</div>
      </section>}

      <section className="admin-section" aria-labelledby="admin-journeys-title">
        <div className="admin-section-title"><div><p className="eyebrow">Usage terrain</p><h3 id="admin-journeys-title">Parcours</h3></div><small>Actualisation toutes les 15 min · heure de Paris</small></div>
        {journeyError && <p className="error">{journeyError}</p>}
        {journeys ? <><div className="admin-journey-grid"><JourneySummary title="15 dernières minutes" window={journeys.recent} /><JourneySummary title="Depuis minuit" window={journeys.today} /></div><p className="admin-journey-updated">Dernière actualisation : {new Date(journeys.generated_at).toLocaleTimeString('fr-FR', { timeZone: journeys.timezone })}</p></> : !journeyError && <p className="muted">Chargement des parcours…</p>}
      </section>

      <section className="admin-section">
        <div className="admin-section-title"><div><p className="eyebrow">Usage & système</p><h3>Contexte du stand</h3></div><small>{data.ai.last_hour_calls} appel(s) IA sur la dernière heure · {data.ai.total_calls} au total</small></div>
        <div className="admin-grid admin-grid-secondary">
          <article className="admin-card"><span>Publications</span><strong>{data.product.publications}</strong><small>{data.product.listings_active} annonce(s) encore en vente</small></article>
          <article className="admin-card"><span>Recherches</span><strong>{data.product.searches}</strong><small>{data.product.listing_views} fiche(s) ouverte(s)</small></article>
          <article className="admin-card"><span>Scans assistant</span><strong>{data.product.assistant_scans}</strong><small>{data.product.assistant_questions} question(s)</small></article>
          <article className="admin-card"><span>Sessions</span><strong>{data.product.sessions}</strong><small>{data.product.errors_shown} erreur(s) affichée(s)</small></article>
          <article className="admin-card"><span>Catalogue</span><strong>{ms(data.catalogue.average_latency_ms)}</strong><small>latence navigateur · {data.catalogue.recent_sample_size} mesure(s)</small></article>
          <article className="admin-card"><span>RAM VM</span><strong>{metric(data.system.memory_usage_percent, ' %')}</strong><small>{metric(data.system.memory_used_mb, ' MB')} / {metric(data.system.memory_total_mb, ' MB')}</small></article>
          <article className="admin-card"><span>Charge CPU · 1 min</span><strong>{metric(data.system.load_percent_of_capacity, ' %')}</strong><small>load {metric(data.system.load_1m)} · {data.system.cpu_count} CPU</small></article>
        </div>
      </section>

      <section className="admin-section">
        <p className="eyebrow">Exports</p><h3>Données post-brocante</h3>
        <div className="admin-export-grid">
          {(['events', 'ai_jobs', 'listings'] as const).map(dataset => <div key={dataset}><strong>{dataset}</strong><div><button className="secondary compact" type="button" onClick={() => void exportData(dataset, 'csv')}>CSV</button><button className="secondary compact" type="button" onClick={() => void exportData(dataset, 'json')}>JSON</button></div></div>)}
        </div>
      </section>

      <p className="admin-generated">Dernière mesure : {new Date(data.generated_at).toLocaleTimeString('fr-FR')}</p>
    </main>
  )
}

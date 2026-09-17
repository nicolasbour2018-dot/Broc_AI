import { FormEvent, useEffect, useState } from 'react'
import { downloadAdminExport, fetchAdminMetrics } from './api'
import type { AdminMetrics } from './types'
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

export default function Admin({ goHome }: { goHome: () => void }) {
  const remembered = sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''
  const [tokenInput, setTokenInput] = useState(remembered)
  const [activeToken, setActiveToken] = useState('')
  const [data, setData] = useState<AdminMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function authenticate(token: string, remember = true) {
    const cleaned = token.trim()
    if (!cleaned) return
    setLoading(true)
    setError('')
    try {
      const metrics = await fetchAdminMetrics(cleaned)
      setData(metrics)
      setActiveToken(cleaned)
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
      void fetchAdminMetrics(activeToken).then(setData).catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [activeToken])

  function submit(e: FormEvent) {
    e.preventDefault()
    void authenticate(tokenInput)
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
        <div><p className="eyebrow">Administration</p><h2>État BrocAI</h2></div>
        <div className="admin-top-actions"><button className="secondary compact" type="button" onClick={() => void authenticate(activeToken, false)}>Actualiser</button><button className="text-action" type="button" onClick={logout}>Fermer</button></div>
      </div>

      {error && <p className="error">{error}</p>}

      <section className="admin-grid">
        <article className="admin-card"><span>Service</span><strong className="admin-ok">{data.service.status === 'ok' ? 'OK' : data.service.status}</strong><small>PostgreSQL {data.service.database}</small></article>
        <article className="admin-card"><span>Queue</span><strong>{data.queue.queued}</strong><small>{data.queue.running} en cours / {data.queue.max_in_flight} max</small></article>
        <article className="admin-card"><span>Appels IA</span><strong>{data.ai.total_calls}</strong><small>{data.ai.last_hour_calls} sur la dernière heure</small></article>
        <article className="admin-card"><span>Latence IA récente</span><strong>{ms(data.ai.average_latency_ms)}</strong><small>{data.ai.recent_sample_size} job(s) échantillonné(s)</small></article>
        <article className="admin-card"><span>Attente queue</span><strong>{ms(data.ai.average_queue_wait_ms)}</strong><small>moyenne récente</small></article>
        <article className="admin-card"><span>Erreurs IA · 1 h</span><strong>{metric(data.ai.last_hour_error_rate_percent, ' %')}</strong><small>{data.ai.error} erreurs · {data.ai.timeout} timeouts au total</small></article>
        <article className="admin-card"><span>Publications</span><strong>{data.product.publications}</strong><small>{data.product.listings_active} annonce(s) encore en vente</small></article>
        <article className="admin-card"><span>Recherches</span><strong>{data.product.searches}</strong><small>{data.product.listing_views} fiche(s) ouverte(s)</small></article>
        <article className="admin-card"><span>Scans assistant</span><strong>{data.product.assistant_scans}</strong><small>{data.product.assistant_questions} question(s)</small></article>
        <article className="admin-card"><span>Sessions</span><strong>{data.product.sessions}</strong><small>{data.product.errors_shown} erreur(s) affichée(s)</small></article>
        <article className="admin-card"><span>Catalogue</span><strong>{ms(data.catalogue.average_latency_ms)}</strong><small>latence navigateur · {data.catalogue.recent_sample_size} mesure(s)</small></article>
        <article className="admin-card"><span>RAM VM</span><strong>{metric(data.system.memory_usage_percent, ' %')}</strong><small>{metric(data.system.memory_used_mb, ' MB')} / {metric(data.system.memory_total_mb, ' MB')}</small></article>
        <article className="admin-card"><span>Charge CPU · 1 min</span><strong>{metric(data.system.load_percent_of_capacity, ' %')}</strong><small>load {metric(data.system.load_1m)} · {data.system.cpu_count} CPU</small></article>
      </section>

      <section className="admin-section">
        <div className="admin-section-title"><div><p className="eyebrow">Derniers jobs IA</p><h3>Activité récente</h3></div><small>Mise à jour automatique toutes les 5 s</small></div>
        {data.recent_jobs.length === 0 ? <p className="muted">Aucun job terminé pour le moment.</p> : <div className="admin-job-list">{data.recent_jobs.map(job => <div key={job.id} className="admin-job"><span>{job.feature}</span><strong>{job.status}</strong><span>{ms(job.duration_ms)}</span><span>attente {ms(job.queue_wait_ms)}</span></div>)}</div>}
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

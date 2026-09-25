import { useEffect, useState } from 'react'

// French display price: "8 €" for whole euros, "8,50 €" otherwise (API sends decimal strings like "8.00").
const PRICE_FORMAT_WHOLE = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const PRICE_FORMAT_CENTS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

export function formatPrice(value: string | number): string {
  const amount = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  if (!Number.isFinite(amount) || String(value).trim() === '') return `${value} €`
  return (Number.isInteger(amount) ? PRICE_FORMAT_WHOLE : PRICE_FORMAT_CENTS).format(amount)
}

const RELATIVE = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })

// "à l’instant", "il y a 12 min", "il y a 2 h", then the day for anything older.
export function formatRelative(iso: string, now: number): string {
  // The backend stores UTC; a timestamp without offset (SQLite in development) is read as UTC too.
  const time = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`)
  if (!Number.isFinite(time)) return ''
  const minutes = Math.round((now - time) / 60000)
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  return RELATIVE.format(-Math.round(hours / 24), 'day')
}

// A clock that ticks every minute, so freshness labels stay true while the page is open.
export function useNow(intervalMs = 60000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}

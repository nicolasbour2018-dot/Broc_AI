import type { ReactNode } from 'react'
import { EVENT_LABEL } from '../event'
import { Icon } from './icons'

export function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={`brand brand--${size}`}>
      <span aria-hidden="true">Broc<em>AI</em></span>
      <span className="sr-only">BrocAI</span>
    </span>
  )
}

export function EventLine() {
  return EVENT_LABEL ? <p className="event-line">{EVENT_LABEL}</p> : null
}

// Screen header: an explicit back action (the phone's back button does the same) and the brand.
export function TopBar({ onBack, backLabel = 'Retour' }: { onBack?: () => void; backLabel?: string }) {
  return (
    <div className="top-bar">
      {onBack ? (
        <button type="button" className="top-bar__back" onClick={onBack}>
          <Icon name="back" /> {backLabel}
        </button>
      ) : <span />}
      <Brand />
    </div>
  )
}

export function Page({ children, className = '', wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <main className={`page${wide ? ' page--wide' : ''} ${className}`}>{children}</main>
}

export function Kicker({ children }: { children: ReactNode }) {
  return <p className="kicker">{children}</p>
}

export function Alert({ tone = 'info', title, children, action }: { tone?: 'info' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'error' ? 'warning' : tone === 'success' ? 'check' : 'info'} className="alert__icon" />
      <div>
        {title && <strong>{title}</strong>}
        {children && <p>{children}</p>}
        {action}
      </div>
    </div>
  )
}

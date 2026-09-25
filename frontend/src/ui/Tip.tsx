import { useState } from 'react'
import type { ReactNode } from 'react'
import { trackEvent } from '../api'
import { Icon } from './icons'

const TIPS_KEY = 'brocai-tips-v1'

function dismissedTips(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(TIPS_KEY) || '[]')
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

// A one-line hint shown the first time a feature is used, until the person closes it.
export function Tip({ id, children }: { id: string; children: ReactNode }) {
  const [visible, setVisible] = useState(() => !dismissedTips().includes(id))
  if (!visible) return null

  function dismiss() {
    setVisible(false)
    void trackEvent('feature_clicked', { feature: 'tip', action: 'dismissed', tip: id })
    try {
      localStorage.setItem(TIPS_KEY, JSON.stringify([...dismissedTips(), id]))
    } catch {
      // The tip simply comes back next visit.
    }
  }

  return (
    <aside className="tip">
      <Icon name="bulb" className="tip__icon" />
      <p>{children}</p>
      <button type="button" onClick={dismiss}>Compris</button>
    </aside>
  )
}

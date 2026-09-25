import { useEffect, useState } from 'react'
import { Icon } from './icons'
import type { IconName } from './icons'

export type Tab = 'home' | 'market' | 'assistant' | 'seller'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Accueil', icon: 'home' },
  { id: 'market', label: 'Chercher', icon: 'search' },
  { id: 'assistant', label: 'Analyser', icon: 'scan' },
  { id: 'seller', label: 'Vendre', icon: 'stand' }
]

// Hide the bar while a field has focus: on phones the keyboard would push it over the form.
function useTyping(): boolean {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const isField = (target: EventTarget | null) => target instanceof HTMLElement && target.matches('input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select')
    const onIn = (event: FocusEvent) => setTyping(isField(event.target))
    const onOut = () => setTyping(false)
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
    }
  }, [])
  return typing
}

export function TabBar({ active, sellerLabel, onSelect }: { active: Tab | null; sellerLabel: string; onSelect: (tab: Tab) => void }) {
  const typing = useTyping()
  return (
    <nav className={`tab-bar${typing ? ' is-hidden' : ''}`} aria-label="Navigation principale">
      {TABS.map(tab => (
        <button key={tab.id} type="button" className="tab-bar__item" aria-current={active === tab.id ? 'page' : undefined} onClick={() => onSelect(tab.id)}>
          <Icon name={tab.icon} size={26} strokeWidth={active === tab.id ? 2.4 : 1.9} />
          <span>{tab.id === 'seller' ? sellerLabel : tab.label}</span>
        </button>
      ))}
    </nav>
  )
}

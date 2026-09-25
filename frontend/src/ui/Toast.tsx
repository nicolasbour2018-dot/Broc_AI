import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type ToastInput = {
  message: string
  actionLabel?: string
  onAction?: () => void
  // Runs once when the toast leaves without its action: time out, replaced, page hidden.
  onExpire?: () => void
  duration?: number
}

type ActiveToast = ToastInput & { id: number }

const ToastContext = createContext<(toast: ToastInput) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

// A single toast at a time, above the tab bar. Undoable actions (sold, deleted draft) commit in
// onExpire, so a new toast or leaving the page settles the previous one instead of dropping it.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null)
  const current = useRef<ActiveToast | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const nextId = useRef(1)

  const settle = useCallback((runExpire: boolean) => {
    const active = current.current
    window.clearTimeout(timer.current)
    current.current = null
    setToast(null)
    if (active && runExpire) active.onExpire?.()
  }, [])

  const show = useCallback((input: ToastInput) => {
    settle(true)
    const next = { ...input, id: nextId.current++ }
    current.current = next
    setToast(next)
    timer.current = window.setTimeout(() => settle(true), input.duration ?? 5000)
  }, [settle])

  useEffect(() => {
    const flush = () => settle(true)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [settle])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast && (
          <div className="toast" key={toast.id}>
            <span>{toast.message}</span>
            {toast.actionLabel && (
              <button type="button" onClick={() => { const action = toast.onAction; settle(false); action?.() }}>{toast.actionLabel}</button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}

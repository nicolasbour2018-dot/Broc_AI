// Device-local seller onboarding. The legacy `brocai-seller-stand` key from the 2026-09-20 event is
// deliberately ignored: only an explicitly confirmed onboarding unlocks the stand shortcut on the home.
export const SELLER_ONBOARDING_KEY = 'brocai-seller-onboarding-v1'

export type SellerOnboarding = {
  stand: string
  alias: string
  confirmedAt: string
}

let currentOnboarding: SellerOnboarding | null = null

export function readSellerOnboarding(): SellerOnboarding | null {
  try {
    const raw = localStorage.getItem(SELLER_ONBOARDING_KEY)
    if (!raw) return currentOnboarding
    const value = JSON.parse(raw) as Partial<SellerOnboarding>
    const stand = typeof value.stand === 'string' ? value.stand.trim() : ''
    if (!stand || typeof value.confirmedAt !== 'string') return null
    currentOnboarding = { stand, alias: typeof value.alias === 'string' ? value.alias : '', confirmedAt: value.confirmedAt }
    return currentOnboarding
  } catch {
    return currentOnboarding
  }
}

export function saveSellerOnboarding(stand: string, alias: string): SellerOnboarding {
  const value: SellerOnboarding = { stand: stand.trim(), alias: alias.trim(), confirmedAt: new Date().toISOString() }
  currentOnboarding = value
  try {
    localStorage.setItem(SELLER_ONBOARDING_KEY, JSON.stringify(value))
  } catch {
    // ignore
  }
  return value
}

export function clearSellerOnboarding(): void {
  currentOnboarding = null
  try {
    localStorage.removeItem(SELLER_ONBOARDING_KEY)
  } catch {
    // ignore
  }
}

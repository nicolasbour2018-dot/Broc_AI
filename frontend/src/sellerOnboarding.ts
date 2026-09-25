// Device-local seller onboarding. Older keys (`brocai-seller-stand`, `brocai-seller-onboarding-v1`) are
// deliberately ignored: only an onboarding holding a stand token from the server unlocks the stand.
export const SELLER_ONBOARDING_KEY = 'brocai-seller-onboarding-v2'

export type SellerOnboarding = {
  stand: string
  alias: string
  // Proves to the server that this device entered the stand code; sent as `X-Stand-Token` on writes.
  token: string
  confirmedAt: string
}

let currentOnboarding: SellerOnboarding | null = null

export function readSellerOnboarding(): SellerOnboarding | null {
  try {
    const raw = localStorage.getItem(SELLER_ONBOARDING_KEY)
    if (!raw) return currentOnboarding
    const value = JSON.parse(raw) as Partial<SellerOnboarding>
    const stand = typeof value.stand === 'string' ? value.stand.trim() : ''
    if (!stand || typeof value.token !== 'string' || !value.token || typeof value.confirmedAt !== 'string') return null
    currentOnboarding = { stand, alias: typeof value.alias === 'string' ? value.alias : '', token: value.token, confirmedAt: value.confirmedAt }
    return currentOnboarding
  } catch {
    return currentOnboarding
  }
}

export function saveSellerOnboarding(stand: string, alias: string, token: string): SellerOnboarding {
  const value: SellerOnboarding = { stand: stand.trim(), alias: alias.trim(), token, confirmedAt: new Date().toISOString() }
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

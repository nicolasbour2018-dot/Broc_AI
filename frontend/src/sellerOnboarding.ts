// Device-local seller onboarding. The legacy `brocai-seller-stand` key from the 2026-09-20 event is
// deliberately ignored: only an explicitly confirmed onboarding unlocks the stand shortcut on the home.
export const SELLER_ONBOARDING_KEY = 'brocai-seller-onboarding-v1'

export type SellerOnboarding = {
  stand: string
  alias: string
  confirmedAt: string
}

export function readSellerOnboarding(): SellerOnboarding | null {
  try {
    const raw = localStorage.getItem(SELLER_ONBOARDING_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<SellerOnboarding>
    const stand = typeof value.stand === 'string' ? value.stand.trim() : ''
    if (!stand || typeof value.confirmedAt !== 'string') return null
    return { stand, alias: typeof value.alias === 'string' ? value.alias : '', confirmedAt: value.confirmedAt }
  } catch {
    return null
  }
}

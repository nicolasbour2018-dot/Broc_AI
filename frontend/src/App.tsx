import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { trackEvent, trackSessionStarted } from './api'
import type { EntrySource } from './api'
import FunLab from './FunLab'
import { marketRoute, navigate, openSeriesCamera, routeView, useRoute } from './navigation'
import type { ViewName } from './navigation'
import Assistant from './screens/Assistant'
import Home from './screens/Home'
import type { HomeActions } from './screens/Home'
import Market from './screens/Market'
import Seller from './screens/seller/Seller'
import Welcome from './screens/Welcome'
import type { WelcomeChoice } from './screens/Welcome'
import { readSellerOnboarding } from './sellerOnboarding'
import type { SellerOnboarding } from './sellerOnboarding'
import { useSellerBatch } from './sellerBatch'
import { TabBar } from './ui/TabBar'
import type { Tab } from './ui/TabBar'
import { ToastProvider } from './ui/Toast'

// Admin and showroom are out of the redesign: they load lazily with the pre-redesign stylesheet.
const Admin = lazy(() => import('./legacy/AdminEntry'))
const Showroom = lazy(() => import('./legacy/ShowroomEntry'))

const APP_ONBOARDING_KEY = 'brocai-app-onboarding-v1'
const PAPER = '#fbf7ef'

type View = ViewName | 'welcome'

function readAppOnboarded(): boolean {
  try {
    return localStorage.getItem(APP_ONBOARDING_KEY) === 'complete'
  } catch {
    return false
  }
}

function saveAppOnboarded(): void {
  try {
    localStorage.setItem(APP_ONBOARDING_KEY, 'complete')
  } catch {
    // The welcome may show again next visit.
  }
}

// Leaving the legacy screens reloads the app so their stylesheet does not linger.
function leaveLegacy() {
  window.location.assign('/')
}

export default function App() {
  const route = useRoute()
  const [onboarded, setOnboarded] = useState(readAppOnboarded)
  const [sellerOnboarding, setSellerOnboarding] = useState<SellerOnboarding | null>(readSellerOnboarding)
  const sellerBatch = useSellerBatch()
  const entrySource = useRef<EntrySource>('direct')
  const previousView = useRef<View | null>(null)
  // The welcome question only greets a first visit on the home address; shared links go straight in.
  const view: View = route.name === 'home' && !onboarded ? 'welcome' : routeView(route)
  const legacy = view === 'admin' || view === 'showroom'

  function chooseWelcome(choice: WelcomeChoice) {
    void trackEvent('feature_clicked', { feature: 'welcome_role', action: choice })
    if (choice === 'visitor') void trackEvent('onboarding_marketplace_clicked', { entry_source: 'welcome' })
    saveAppOnboarded()
    setOnboarded(true)
    if (choice === 'seller') navigate({ name: 'seller' })
  }

  function openMarket(source: EntrySource, options: Parameters<typeof marketRoute>[0] = {}) {
    entrySource.current = source
    navigate(marketRoute(options))
  }

  const homeActions: HomeActions = {
    search: q => {
      void trackEvent('feature_clicked', { feature: 'home_search', action: q.trim() ? 'submitted' : 'empty' })
      openMarket('home', { q, all: true })
    },
    pickCategory: category => {
      void trackEvent('feature_clicked', { feature: 'home_category', action: 'selected', category })
      void trackEvent('marketplace_category_selected', { category, entry_source: 'home' })
      openMarket('home', { category })
    },
    openMarket: all => openMarket('home', { all }),
    openListing: item => {
      entrySource.current = 'home_listing'
      navigate({ name: 'listing', id: item.id })
    },
    openAssistant: () => navigate({ name: 'assistant' }),
    openFunLab: () => navigate({ name: 'funlab' }),
    openSeller: () => navigate({ name: 'seller' }),
    addObjects: openSeriesCamera
  }

  function selectTab(tab: Tab) {
    void trackEvent('feature_clicked', { feature: 'tab_bar', action: tab, from: view })
    if (tab === 'market') openMarket(view === 'home' ? 'home' : view === 'seller' ? 'seller_dashboard' : 'marketplace')
    else if (tab === 'home') navigate({ name: 'home' })
    else navigate({ name: tab })
  }

  // Paint the page and browser chrome in paper so overscroll and safe areas match the app.
  useEffect(() => {
    const color = legacy ? '' : PAPER
    document.documentElement.style.backgroundColor = color
    document.body.style.background = color
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (meta) meta.content = legacy ? '#ffffff' : PAPER
  }, [legacy])

  useEffect(() => {
    if (view !== 'market') window.scrollTo(0, 0)
  }, [view, route.name])

  useEffect(() => {
    if (view === 'admin') return
    const previous = previousView.current
    const source = entrySource.current
    previousView.current = view
    void (async () => {
      await trackSessionStarted(view === 'welcome' ? 'direct' : view === 'market' ? source : 'home')
      if (view === 'welcome' && previous !== 'welcome') await trackEvent('onboarding_viewed', { entry_source: 'direct' })
      if (view === 'market' && previous !== 'market') await trackEvent('marketplace_opened', { entry_source: source })
      await trackEvent('nav_opened', { screen: view, previous_screen: previous })
    })()
  }, [view])

  if (legacy) return (
    <div className={`app-shell view-${view}`}>
      <Suspense fallback={null}>
        {view === 'admin' ? <Admin goHome={leaveLegacy} /> : <Showroom exitShowroom={leaveLegacy} />}
      </Suspense>
    </div>
  )

  const activeTab: Tab | null = view === 'home' || view === 'market' || view === 'assistant' || view === 'seller' ? view : null
  const showTabs = view !== 'welcome' && !(route.name === 'series' && route.camera)

  let content
  if (view === 'welcome') content = <Welcome choose={chooseWelcome} />
  else if (route.name === 'market' || route.name === 'listing') content = <Market route={route} entrySource={entrySource.current} />
  else if (route.name === 'assistant') content = <Assistant />
  else if (route.name === 'funlab') content = <FunLab />
  else if (route.name === 'seller' || route.name === 'series' || route.name === 'editListing') content = <Seller route={route} onboarding={sellerOnboarding} onOnboardingChange={setSellerOnboarding} batch={sellerBatch} />
  else content = <Home onboarding={sellerOnboarding} actions={homeActions} />

  return (
    <ToastProvider>
      <div className={`brocai view-${view}${showTabs ? ' has-tabs' : ''}`}>
        {content}
        {view !== 'welcome' && (
          <footer className="product-footer"><strong>BrocAI</strong> · Une expérience Gaia Vector Studio</footer>
        )}
        {showTabs && <TabBar active={activeTab} sellerLabel={sellerOnboarding ? 'Mon stand' : 'Vendre'} onSelect={selectTab} />}
      </div>
    </ToastProvider>
  )
}

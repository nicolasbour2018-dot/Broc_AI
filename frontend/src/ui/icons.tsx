import type { ListingCategory } from '../categories'

// One stroke icon set for the public app: 24×24, currentColor, no emoji. Paths stay simple so they read
// at arm's length in daylight.
const PATHS = {
  home: <><path d="M3.5 11 12 4l8.5 7" /><path d="M5.5 9.5V20h5v-5.5h3V20h5V9.5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  scan: <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><circle cx="12" cy="12" r="3.5" /></>,
  stand: <><path d="M4 10h16v10H4z" /><path d="M3 10 5 4h14l2 6" /><path d="M9.5 20v-5h5v5" /></>,
  camera: <><path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2.5L9 5h6l1.5 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" /><circle cx="12" cy="13" r="3.5" /></>,
  gallery: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><circle cx="9" cy="9.5" r="1.6" /><path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4" /></>,
  tag: <><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8L21 12l-9 9z" /><circle cx="8.5" cy="8.5" r="1.5" /></>,
  trash: <><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /><path d="M10 11v5.5M14 11v5.5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="M15 5 8 12l7 7" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  eye: <><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.6" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.2" /></>,
  warning: <><path d="M12 4 21 19.5H3z" /><path d="M12 10v4.5M12 17v.2" /></>,
  sparkle: <path d="M12 3c1 4.5 3.5 7 8 8-4.5 1-7 3.5-8 8-1-4.5-3.5-7-8-8 4.5-1 7-3.5 8-8Z" />,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19.5h14" /></>,
  bulb: <><path d="M9 17.5h6M10 20.5h4" /><path d="M12 3.5a5.5 5.5 0 0 0-3.3 9.9c.7.6 1.3 1.4 1.3 2.3v.3h4v-.3c0-.9.6-1.7 1.3-2.3A5.5 5.5 0 0 0 12 3.5Z" /></>,
  euro: <><path d="M17.5 6.5a6.5 6.5 0 1 0 0 11" /><path d="M4.5 10.5h9M4.5 13.5h9" /></>,
  book: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" /></>,
  handshake: <><path d="M2.5 11 6 7.5l3 1.5 3-2 3.5 1L21.5 11" /><path d="m6 13 4.5 4.5a1.4 1.4 0 0 0 2-2M11 15l2.5 2.5a1.4 1.4 0 0 0 2-2L12 12M14 13.5l1.5 1.5a1.4 1.4 0 0 0 2-2l-4-4" /></>,
  chat: <><path d="M4.5 5.5h15v10h-9l-4.5 4v-4h-1.5z" /></>,
  shutter: <circle cx="12" cy="12" r="8.5" />,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />,
  bolt: <path d="M13.5 3 5 13.5h6L10 21l9-11h-6.5z" />,
  compass: <><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  flip: <><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" /><path d="M18 3v3.7h-3.7M6 21v-3.7h3.7" /></>,
  // Rayons
  furniture: <><path d="M9 3.5h6l2.5 6h-11z" /><path d="M12 9.5V19M8 20.5h8" /></>,
  dishes: <><path d="M4 9.5h13v2.5a6.5 6.5 0 0 1-13 0z" /><path d="M17 10.5h1.5a2.5 2.5 0 0 1 0 5H16" /><path d="M8 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3" /></>,
  clothes: <><path d="M9 3.5 4 6l1.5 4.5 2.5-1V20.5h8V9.5l2.5 1L20 6l-5-2.5a3 3 0 0 1-6 0Z" /></>,
  books: <><path d="M5 4h4v16H5zM10 4h4v16h-4z" /><path d="m15 5 3.8-1 3 15.4-3.8 1z" /></>,
  toys: <><circle cx="12" cy="13.5" r="6" /><circle cx="7" cy="6.5" r="2.5" /><circle cx="17" cy="6.5" r="2.5" /><path d="M10 12.5v.1M14 12.5v.1M10.5 16a2.5 2.5 0 0 0 3 0" /></>,
  electronics: <><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M9 20h6M12 16v4" /></>,
  tools: <><path d="M14.5 4.5a4 4 0 0 0-4.8 5.3L4 15.5 6.5 18l5.7-5.7a4 4 0 0 0 5.3-4.8L15 10l-2-2z" /><path d="M16 20.5h4.5" /></>,
  sport: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M3.5 12h17M6 6c3 2.5 3 9.5 0 12M18 6c-3 2.5-3 9.5 0 12" /></>,
  vintage: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /><path d="M12 3.5v1.5M20.5 12H19M12 20.5V19M3.5 12H5" /></>,
  baby: <><path d="M9.5 3.5h5v3h-5z" /><path d="M8.5 6.5h7l.5 3v9.5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 19V9.5z" /><path d="M8 12.5h3M8 15.5h3" /></>,
  jewel: <><path d="M6.5 4h11l3 5-8.5 11L3.5 9z" /><path d="M3.5 9h17M9 4l3 16 3-16" /></>,
  box: <><path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" /><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" /></>
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 24, className, strokeWidth = 1.9 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  )
}

// Rayon presentation: an icon and a short label that fits a tile at 320 px. The API keeps the full names.
export const CATEGORY_DISPLAY: Record<ListingCategory, { icon: IconName; short: string }> = {
  'Meubles & décoration': { icon: 'furniture', short: 'Meubles & déco' },
  'Vaisselle & cuisine': { icon: 'dishes', short: 'Vaisselle' },
  'Vêtements & accessoires': { icon: 'clothes', short: 'Vêtements' },
  'Livres & médias': { icon: 'books', short: 'Livres & médias' },
  'Jeux & jouets': { icon: 'toys', short: 'Jeux & jouets' },
  'Électronique': { icon: 'electronics', short: 'Électronique' },
  'Bricolage & jardin': { icon: 'tools', short: 'Bricolage' },
  'Sport & loisirs': { icon: 'sport', short: 'Sport & loisirs' },
  'Collection & vintage': { icon: 'vintage', short: 'Vintage' },
  'Enfant & puériculture': { icon: 'baby', short: 'Enfant' },
  'Bijoux & montres': { icon: 'jewel', short: 'Bijoux' },
  'Autre': { icon: 'box', short: 'Divers' }
}

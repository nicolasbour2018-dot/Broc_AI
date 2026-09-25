import { formatPrice, formatRelative } from '../format'
import type { Listing } from '../types'
import { Icon } from './icons'
import { PriceTag, StandBadge } from './Tags'

// A listing as a visitor needs it: photo with its price tag, name, where to find it and how fresh it is.
export function ListingCard({ item, now, onOpen, variant = 'grid' }: { item: Listing; now: number; onOpen: () => void; variant?: 'grid' | 'rail' }) {
  const freshness = formatRelative(item.created_at, now)
  return (
    <button type="button" className={`listing-tile listing-tile--${variant}`} onClick={onOpen} aria-label={`${item.title}, ${formatPrice(item.price_eur)}, stand ${item.stand_number}, publié ${freshness}`}>
      <span className="listing-tile__photo">
        <img src={item.image_url} alt="" loading="lazy" />
        <PriceTag price={item.price_eur} className="listing-tile__price" />
      </span>
      <span className="listing-tile__body">
        <strong className="listing-tile__title">{item.title}</strong>
        <StandBadge stand={item.stand_number} />
        {freshness && <small className="listing-tile__meta"><Icon name="clock" size={16} /> {freshness}</small>}
      </span>
    </button>
  )
}

export function ListingSkeletons({ count, variant = 'grid' }: { count: number; variant?: 'grid' | 'rail' }) {
  return <>{Array.from({ length: count }, (_, index) => <span key={index} className={`listing-tile listing-tile--${variant} skeleton`} aria-hidden="true" />)}</>
}

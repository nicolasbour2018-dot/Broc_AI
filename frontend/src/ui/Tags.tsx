import { formatPrice } from '../format'

// The price as a swing tag, the object every visitor recognises from a brocante table.
export function PriceTag({ price, size = 'md', className = '' }: { price: string | number; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <span className={`price-tag price-tag--${size} ${className}`}>{formatPrice(price)}</span>
}

// The stand number as a painted pitch marker: the one thing a visitor needs to find the object.
export function StandBadge({ stand, size = 'md', className = '' }: { stand: string; size?: 'md' | 'xl'; className?: string }) {
  return (
    <span className={`stand-badge stand-badge--${size} ${className}`}>
      <span className="stand-badge__label">Stand</span>
      <b>{stand}</b>
    </span>
  )
}

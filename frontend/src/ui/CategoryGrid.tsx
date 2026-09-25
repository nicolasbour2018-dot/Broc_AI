import type { ListingCategory } from '../categories'
import { plural } from '../format'
import type { ListingCategoryCounts } from '../types'
import { CATEGORY_DISPLAY, Icon } from './icons'

// The brocante's "rayons": one tile per category that has objects. `limit` keeps the fullest ones
// (home); without it every non-empty rayon shows in the usual order (market).
export function CategoryGrid({ counts, error, onRetry, onPick, limit, onShowAll }: {
  counts: ListingCategoryCounts | null
  error?: string
  onRetry?: () => void
  onPick: (category: ListingCategory) => void
  limit?: number
  onShowAll?: () => void
}) {
  if (error) return (
    <div className="inline-error" role="status">
      <span>{error}</span>
      {onRetry && <button type="button" className="btn-link" onClick={onRetry}>Réessayer</button>}
    </div>
  )
  if (!counts) return (
    <div className="category-grid" aria-hidden="true">
      {Array.from({ length: limit ?? 6 }, (_, index) => <span key={index} className="category-tile skeleton" />)}
    </div>
  )

  const filled = counts.categories.filter(item => item.count > 0)
  const shown = limit ? [...filled].sort((a, b) => b.count - a.count).slice(0, limit) : filled
  if (shown.length === 0) return null

  return (
    <ul className="category-grid">
      {shown.map(item => {
        const display = CATEGORY_DISPLAY[item.category]
        return (
          <li key={item.category}>
            <button type="button" className="category-tile" onClick={() => onPick(item.category)} aria-label={`${item.category}, ${plural(item.count, 'objet')}`}>
              <span className="category-tile__icon"><Icon name={display.icon} size={28} /></span>
              <strong>{display.short}</strong>
              <small>{plural(item.count, 'objet')}</small>
            </button>
          </li>
        )
      })}
      {onShowAll && limit && filled.length > shown.length && (
        <li>
          <button type="button" className="category-tile category-tile--all" onClick={onShowAll}>
            <span className="category-tile__icon"><Icon name="chevron" size={28} /></span>
            <strong>Tous les rayons</strong>
            <small>{plural(filled.length, 'rayon')}</small>
          </button>
        </li>
      )}
    </ul>
  )
}

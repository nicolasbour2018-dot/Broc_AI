import { useId } from 'react'
import { LISTING_CATEGORIES } from '../../categories'
import type { ListingCategory } from '../../categories'

export type DraftValues = {
  title: string
  description: string
  fun_line: string
  category: ListingCategory
  price_eur: string
  seller_alias: string
}

// What must be fixed before a draft can go online; null when it is publishable.
export function draftProblem(values: Pick<DraftValues, 'title' | 'description' | 'price_eur'>): string | null {
  const price = Number(String(values.price_eur).replace(',', '.'))
  if (!values.title.trim()) return 'Ajoutez un titre pour publier.'
  if (!values.description.trim()) return 'Ajoutez une description pour publier.'
  if (String(values.price_eur).trim() === '' || !Number.isFinite(price) || price < 0) return 'Indiquez un prix pour publier.'
  return null
}

// The fields of a listing, shared by series drafts and the edit screen. The essentials (title, price,
// rayon) stay visible; description, little line and alias fold away once the AI has filled them.
export function DraftFields({ values, onChange, suggestion, expanded = false }: {
  values: DraftValues
  onChange: (values: DraftValues) => void
  suggestion?: string
  expanded?: boolean
}) {
  const id = useId()
  const set = (patch: Partial<DraftValues>) => onChange({ ...values, ...patch })
  return (
    <div className="draft-fields">
      <label className="field" htmlFor={`${id}-title`}>
        <span className="field__label">Titre</span>
        <input id={`${id}-title`} maxLength={160} value={values.title} onChange={e => set({ title: e.target.value })} />
      </label>
      <div className="draft-fields__row">
        <label className="field field--price" htmlFor={`${id}-price`}>
          <span className="field__label">Prix</span>
          <span className="field__input-euro">
            <input id={`${id}-price`} inputMode="decimal" type="number" min="0" step="0.5" value={values.price_eur} onChange={e => set({ price_eur: e.target.value })} />
            <span aria-hidden="true">€</span>
          </span>
        </label>
        <label className="field" htmlFor={`${id}-category`}>
          <span className="field__label">Rayon</span>
          <select id={`${id}-category`} value={values.category} onChange={e => set({ category: e.target.value as ListingCategory })}>
            {LISTING_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
      </div>
      {suggestion && <small className="field__help">{suggestion} Pour un lot, indiquez le prix de l’ensemble.</small>}
      <details className="draft-fields__more" open={expanded || undefined}>
        <summary>Description, petite phrase et pseudo</summary>
        <label className="field" htmlFor={`${id}-description`}>
          <span className="field__label">Description</span>
          <textarea id={`${id}-description`} maxLength={1200} rows={4} value={values.description} onChange={e => set({ description: e.target.value })} />
        </label>
        <label className="field" htmlFor={`${id}-fun`}>
          <span className="field__label">Petite phrase sympa <span className="field__optional">(facultatif)</span></span>
          <input id={`${id}-fun`} maxLength={180} value={values.fun_line} onChange={e => set({ fun_line: e.target.value })} />
        </label>
        <label className="field" htmlFor={`${id}-alias`}>
          <span className="field__label">Pseudo vendeur <span className="field__optional">(facultatif)</span></span>
          <input id={`${id}-alias`} maxLength={80} value={values.seller_alias} onChange={e => set({ seller_alias: e.target.value })} />
        </label>
      </details>
    </div>
  )
}

import type { FloorLevelType } from '../../../lib/levelCompatibility'
import {
  bindingRoleForRef,
  type CatalogueQtyRole,
} from './resolveCatalogueQty'

const ROLE_RATE: Record<CatalogueQtyRole, string> = {
  rebar: 'rebar',
  concrete: 'concrete',
  formwork: 'formwork',
  excavation: 'excavation',
  disposal: 'disposal',
  masonry: 'stoneMasonry',
  blinding: 'blinding',
}

function normUnit(u: string): string {
  return String(u ?? '')
    .trim()
    .toLowerCase()
    .replace('³', '3')
    .replace('²', '2')
}

/**
 * Pick a pricing.boq rate-book key for a selected / manual BOQ line.
 * Core catalogue bindings win; otherwise infer from work category, unit, description.
 */
export function rateKeyForBoqLine(args: {
  elementKey: string
  catalogueRef?: string
  workCategory?: string
  unit?: string
  description?: string
  floorLevelTypes?: readonly FloorLevelType[] | 'all'
}): string | null {
  const unit = normUnit(args.unit || '')
  const role = bindingRoleForRef(
    args.elementKey,
    args.catalogueRef || '',
    args.floorLevelTypes,
  )
  if (role) {
    if (role === 'formwork' && unit === 'm') return 'formworkLm'
    return ROLE_RATE[role]
  }

  const cat = (args.workCategory || '').trim()
  const d = (args.description || '').toLowerCase()

  if (cat === 'Reinforcement' || unit === 't') return 'rebar'
  if (cat === 'Concrete') return 'concrete'
  if (cat === 'Formwork') return unit === 'm' ? 'formworkLm' : 'formwork'
  if (cat === 'Blinding') return 'blinding'
  if (cat === 'Masonry') return unit === 'm2' ? 'masonryWall' : 'stoneMasonry'
  if (cat === 'Floor Finishes') {
    if (/\bscreed\b/.test(d)) return 'floorScreed'
    if (/\btile|\btiling\b/.test(d)) return 'floorTiling'
    return 'floorFinish'
  }
  if (cat === 'Wall Finishes') return 'wallFinish'
  if (cat === 'Ceiling Finishes') return 'ceilingFinish'
  if (cat === 'Doors & Windows') return 'doorsWindows'
  if (cat === 'Lintels') return 'lintels'
  if (cat === 'Earthworks') {
    if (/\bdispos|\bcart away|\bspoil|\bhaul/.test(d)) return 'disposal'
    return 'excavation'
  }
  if (cat === 'Waterproofing') return 'waterproofing'
  if (cat === 'Insulation' && /\bpipe\b/.test(d)) return 'pipeInsulation'

  if (/\bexcavat/.test(d)) return 'excavation'
  if (/\bdispos|\bcart away|\bspoil/.test(d)) return 'disposal'
  if (/\bblind/.test(d)) return 'blinding'
  if (/\bformwork|\bshutter/.test(d)) return unit === 'm' ? 'formworkLm' : 'formwork'
  if (/\brebar|\breinforc/.test(d)) return 'rebar'
  if (/\bconcrete\b/.test(d) && unit === 'm3') return 'concrete'
  if (/\bwaterproof/.test(d)) return 'waterproofing'

  return null
}

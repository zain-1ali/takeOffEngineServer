/**
 * Resolve measured qty for a catalogue ref from engine summary / extras.
 * Used when user Add-to-BOQ selections should pick up schedule quantities.
 */
import { normalizeRef } from './index'
import { CORE_QTY_BINDINGS } from './types'
import type { FloorLevelType } from '../../../lib/levelCompatibility'

export type CatalogueQtyRole =
  | 'rebar'
  | 'concrete'
  | 'formwork'
  | 'excavation'
  | 'disposal'
  | 'masonry'
  | 'blinding'

export type CatalogueQtyContext = {
  concrete?: number
  formwork?: number
  /** Steel kg (not tonnes). */
  steel?: number
  excavation?: number
  disposal?: number
  masonry?: number
  blinding?: number
}

function preferRoof(
  floorLevelTypes: readonly FloorLevelType[] | 'all' | undefined,
): boolean {
  if (!floorLevelTypes || floorLevelTypes === 'all') return false
  return (
    floorLevelTypes.includes('Roof') &&
    !floorLevelTypes.includes('Above-Grade') &&
    !floorLevelTypes.includes('Below-Grade') &&
    !floorLevelTypes.includes('Foundation')
  )
}

/** Which binding role (if any) does this catalogue ref play for the element? */
export function bindingRoleForRef(
  elementKey: string,
  catalogueRef: string,
  floorLevelTypes?: readonly FloorLevelType[] | 'all',
): CatalogueQtyRole | null {
  const bindings = CORE_QTY_BINDINGS[elementKey]
  if (!bindings) return null
  const want = normalizeRef(catalogueRef)
  const roof = preferRoof(floorLevelTypes)

  const match = (normal?: string, roofAlt?: string) => {
    if (roof && roofAlt && normalizeRef(roofAlt) === want) return true
    if (normal && normalizeRef(normal) === want) return true
    // Also accept the non-preferred variant so selections still fill
    if (roofAlt && normalizeRef(roofAlt) === want) return true
    return false
  }

  if (match(bindings.rebar, bindings.rebarRoof)) return 'rebar'
  if (match(bindings.concrete, bindings.concreteRoof)) return 'concrete'
  if (match(bindings.formwork, bindings.formworkRoof)) return 'formwork'
  if (bindings.excavation && normalizeRef(bindings.excavation) === want) {
    return 'excavation'
  }
  if (bindings.disposal && normalizeRef(bindings.disposal) === want) {
    return 'disposal'
  }
  if (bindings.masonry && normalizeRef(bindings.masonry) === want) {
    return 'masonry'
  }
  if (bindings.blinding && normalizeRef(bindings.blinding) === want) {
    return 'blinding'
  }
  return null
}

export type ResolvedCatalogueQty = {
  qty: number
  unit: string
  rateKey: string
  isRebar?: boolean
  dec?: number
}

/**
 * Map a selected catalogue ref → qty from schedule/engine context.
 * Returns null when the ref is not a known measurable binding for this element.
 */
export function resolveCatalogueQty(args: {
  elementKey: string
  catalogueRef: string
  ctx: CatalogueQtyContext
  floorLevelTypes?: readonly FloorLevelType[] | 'all'
}): ResolvedCatalogueQty | null {
  const role = bindingRoleForRef(
    args.elementKey,
    args.catalogueRef,
    args.floorLevelTypes,
  )
  if (!role) return null

  switch (role) {
    case 'rebar': {
      const kg = Number(args.ctx.steel) || 0
      return {
        qty: kg > 0 ? kg / 1000 : 0,
        unit: 't',
        rateKey: 'rebar',
        isRebar: true,
        dec: 3,
      }
    }
    case 'concrete':
      return {
        qty: Number(args.ctx.concrete) || 0,
        unit: 'm³',
        rateKey: 'concrete',
      }
    case 'formwork':
      return {
        qty: Number(args.ctx.formwork) || 0,
        unit: 'm²',
        rateKey: 'formwork',
      }
    case 'excavation':
      return {
        qty: Number(args.ctx.excavation) || 0,
        unit: 'm³',
        rateKey: 'excavation',
      }
    case 'disposal':
      return {
        qty: Number(args.ctx.disposal) || 0,
        unit: 'm³',
        rateKey: 'disposal',
      }
    case 'masonry':
      return {
        qty: Number(args.ctx.masonry) || 0,
        unit: 'm³',
        rateKey: 'stoneMasonry',
      }
    case 'blinding':
      return {
        qty: Number(args.ctx.blinding) || 0,
        unit: 'm³',
        rateKey: 'blinding',
      }
    default:
      return null
  }
}

/** Build qty context from an element report summary bag. */
export function qtyContextFromSummary(
  summary: Record<string, number> | undefined,
): CatalogueQtyContext {
  const s = summary || {}
  return {
    concrete: s.concrete,
    formwork: s.formwork,
    steel: s.steel,
    excavation: s.excavation,
    disposal: s.disposal,
    masonry: s.masonry,
    blinding: s.blinding,
  }
}

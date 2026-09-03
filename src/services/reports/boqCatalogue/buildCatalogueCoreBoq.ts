/**
 * Bind high-confidence engine aggregates to client catalogue descriptions.
 */
import { lineAmount, type RateAccessors } from '../pricing'
import type { ReportLine } from '../types'
import {
  catalogueItemAppliesToFloor,
  findCatalogueItem,
} from './index'
import { CORE_QTY_BINDINGS } from './types'
import type { FloorLevelType } from '../../../lib/levelCompatibility'

export type StructuralAggForCatalogue = {
  concreteByGrade: Record<string, number>
  totalFormwork: number
  steelByDia: Record<string, number>
  totalConcrete: number
  totalSteel: number
}

function group(description: string, workCategory?: string): ReportLine {
  return { kind: 'group', description, workCategory }
}

function itemLine(args: {
  ref: string
  description: string
  qty: number
  unit: string
  rate: number | null
  nrm2Ref?: string
  quantityBasis?: ReportLine['quantityBasis']
  workCategory?: string
  isRebar?: boolean
  dec?: number
}): ReportLine {
  return {
    kind: 'item',
    ref: args.ref,
    description: args.description,
    qty: args.qty,
    unit: args.unit,
    rate: args.rate,
    amount: lineAmount(args.qty, args.rate),
    nrm2Ref: args.nrm2Ref,
    quantityBasis: args.quantityBasis,
    workCategory: args.workCategory,
    isRebar: args.isRebar,
    dec: args.dec,
  }
}

/**
 * Build BOQ lines for structural (and similar) elements using catalogue wording
 * for concrete / formwork / rebar (and stone/earthworks when bindings exist).
 * Returns null when catalogue is disabled or no bindings for this key.
 */
export function buildCatalogueCoreBoq(args: {
  elementKey: string
  agg: StructuralAggForCatalogue
  rates: RateAccessors
  floorLevelTypes: readonly FloorLevelType[] | 'all'
  /** Extra qtys for earthworks / stone */
  extras?: {
    excavationM3?: number
    disposalM3?: number
    masonryM3?: number
    blindingM3?: number
  }
}): { lines: ReportLine[]; boqTot: number } | null {
  const bindings = CORE_QTY_BINDINGS[args.elementKey]
  if (!bindings) return null

  const floor = args.floorLevelTypes
  const preferRoof =
    floor !== 'all' &&
    floor.includes('Roof') &&
    !floor.includes('Above-Grade') &&
    !floor.includes('Below-Grade') &&
    !floor.includes('Foundation')

  const pickRef = (normal?: string, roof?: string) =>
    preferRoof && roof ? roof : normal

  const lines: ReportLine[] = []
  let boqTot = 0

  const pushFromCatalogue = (
    ref: string | undefined,
    qty: number,
    unit: string,
    rateKey: string,
    opts?: { isRebar?: boolean; dec?: number; gradeNote?: string },
  ) => {
    if (!ref || !(qty > 0)) return
    const cat = findCatalogueItem(args.elementKey, ref)
    if (!cat) return
    if (!catalogueItemAppliesToFloor(cat, floor)) return

    if (!lines.some((l) => l.kind === 'group' && l.workCategory === cat.workCategory)) {
      lines.push(group(cat.workCategory, cat.workCategory))
    }

    let description = cat.description
    if (opts?.gradeNote) description = `${description} (${opts.gradeNote})`

    const rate = args.rates.boqRate(rateKey)
    const line = itemLine({
      ref: cat.ref,
      description,
      qty,
      unit: cat.unit || unit,
      rate,
      nrm2Ref: cat.nrm2Ref,
      quantityBasis: cat.quantityBasis,
      workCategory: cat.workCategory,
      isRebar: opts?.isRebar,
      dec: opts?.dec,
    })
    lines.push(line)
    if (line.amount != null) boqTot += line.amount
  }

  // Reinforcement by diameter
  const rebarRef = pickRef(bindings.rebar, bindings.rebarRoof)
  Object.keys(args.agg.steelByDia)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((dia) => {
      const kg = args.agg.steelByDia[String(dia)]
      if (!(kg > 0)) return
      pushFromCatalogue(rebarRef, kg / 1000, 't', 'rebar', {
        isRebar: true,
        dec: 3,
        gradeNote: `H${dia}`,
      })
    })

  // Concrete by grade
  const concreteRef = pickRef(bindings.concrete, bindings.concreteRoof)
  Object.keys(args.agg.concreteByGrade)
    .sort()
    .forEach((grade) => {
      const q = args.agg.concreteByGrade[grade]
      if (!(q > 0)) return
      pushFromCatalogue(concreteRef, q, 'm³', 'concrete', { gradeNote: grade })
    })

  // Formwork
  const formworkRef = pickRef(bindings.formwork, bindings.formworkRoof)
  pushFromCatalogue(formworkRef, args.agg.totalFormwork, 'm²', 'formwork')

  // Earthworks / stone extras
  if (bindings.excavation && args.extras?.excavationM3) {
    pushFromCatalogue(bindings.excavation, args.extras.excavationM3, 'm³', 'excavation')
  }
  if (bindings.disposal && args.extras?.disposalM3) {
    pushFromCatalogue(bindings.disposal, args.extras.disposalM3, 'm³', 'disposal')
  }
  if (bindings.masonry && args.extras?.masonryM3) {
    pushFromCatalogue(bindings.masonry, args.extras.masonryM3, 'm³', 'stoneMasonry')
  }
  if (bindings.blinding && args.extras?.blindingM3) {
    pushFromCatalogue(bindings.blinding, args.extras.blindingM3, 'm³', 'blinding')
  }

  if (!lines.some((l) => l.kind === 'item')) return null

  lines.push({
    kind: 'total',
    description: 'Element total (excl. prelims & OH&P)',
    amount: boqTot,
  })
  return { lines, boqTot }
}

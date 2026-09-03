/**
 * Client BOQ catalogue (from info.xlsx Module 1 + MODULE 2).
 * Regenerate: node scripts that read tmp-info.xlsx → catalogue.json
 */

export type BoqQuantityBasis = 'independent' | 'derived' | 'conditional'

export type BoqApplicableLevel =
  | 'Foundation'
  | 'Below-Grade'
  | 'Above-Grade'
  | 'Roof'
  | 'All'

export type BoqCatalogueItem = {
  ref: string
  elementKey: string
  elementLabel: string
  applicableLevels: BoqApplicableLevel[]
  description: string
  unit: string
  formulaText: string
  quantityBasis: BoqQuantityBasis
  nrm2Ref: string
  workCategory: string
  sheet: string
  sortOrder: number
}

export type BoqCatalogueFile = {
  source: string
  importedAt: string
  itemCount: number
  items: BoqCatalogueItem[]
}

/** Off when BOQ_CATALOGUE=0. On by default. */
export function isBoqCatalogueEnabled(): boolean {
  return process.env.BOQ_CATALOGUE !== '0'
}

/**
 * Core measured lines we can bind with high confidence to existing engine aggregates.
 * Values are catalogue `ref` strings from info.xlsx.
 */
export const CORE_QTY_BINDINGS: Record<
  string,
  {
    rebar?: string
    concrete?: string
    /** Prefer this concrete ref when floor includes Roof (Roof Slab family). */
    concreteRoof?: string
    formwork?: string
    formworkRoof?: string
    rebarRoof?: string
    excavation?: string
    disposal?: string
    masonry?: string
    blinding?: string
  }
> = {
  PAD_FOOTING: { rebar: '1.06', concrete: '1.07', formwork: '1.08' },
  STRIP_FOOTING: { rebar: '2.06', concrete: '2.07', formwork: '2.08' },
  STONE_STRIP: { masonry: '3.05', blinding: '3.04' },
  RAFT: { rebar: '4.1', concrete: '4.11', formwork: '4.12' },
  PILE_CAP: { rebar: '5.05', concrete: '5.06', formwork: '5.07' },
  PILES: { rebar: '6.06', concrete: '6.07' },
  EARTHWORKS: { excavation: '7.03', disposal: '7.1' },
  COLUMNS: { rebar: '8.01', concrete: '8.02', formwork: '8.03' },
  WALLS: { rebar: '9.01', concrete: '9.02', formwork: '9.03' },
  BEAMS: { rebar: '10.01', concrete: '10.02', formwork: '10.04' },
  SLABS: {
    rebar: '11.08',
    concrete: '11.1',
    formwork: '11.11',
    rebarRoof: '14.01',
    concreteRoof: '14.02',
    formworkRoof: '14.03',
  },
  STAIRS: { rebar: '12.01', concrete: '12.02', formwork: '12.03' },
  RAMPS: { rebar: '13.01', concrete: '13.02', formwork: '13.03' },
}

/** Bar bending schedule — BS 8666 subset from takeoff-demo.html */

import { evalNumber, normUnit, numOr, type DimValue } from './measurement'

export const BAR_SIZES = [6, 8, 10, 12, 14, 16, 20, 25, 28, 32, 40] as const

export type BbsBar = {
  id: string
  mark: string
  member: string
  shapeCode: string
  dims: Record<string, DimValue>
  dia: DimValue
  r: DimValue
  hook: DimValue
  cutManual: boolean
  cutOverride: DimValue
  mbrs: DimValue
  each: DimValue
}

export type BarShapeDef = {
  code: string
  name: string
  legs: string[]
  bends: number
  link?: boolean
  helix?: boolean
  manual?: boolean
  legLabels?: Record<string, string>
  cut: (dm: Record<string, DimValue>, d: number, r: number, hook: number) => number
}

export function unitMass(d: unknown): number {
  const dia = numOr(d, 0)
  return dia > 0 ? 0.006165 * dia * dia : 0
}

const nMM = (v: unknown) => numOr(v, 0)
const sumL = (dm: Record<string, DimValue> | undefined, keys: string[]) =>
  keys.reduce((t, k) => t + nMM(dm?.[k]), 0)

export function formerRadius(dia: unknown): number {
  const d = nMM(dia)
  return d <= 0 ? 0 : d <= 16 ? 2 * d : 3.5 * d
}

export function linkHook(dia: unknown): number {
  const d = nMM(dia)
  return Math.max(10 * d, 75)
}

const bend90 = (d: number, r: number) => 0.5 * r + d

export const BAR_SHAPES: Record<string, BarShapeDef> = {
  '00': {
    code: '00',
    name: 'Straight',
    legs: ['A'],
    bends: 0,
    cut: (dm) => nMM(dm.A),
  },
  '11': {
    code: '11',
    name: 'One bend (L)',
    legs: ['A', 'B'],
    bends: 1,
    cut: (dm, d, r) => sumL(dm, ['A', 'B']) - bend90(d, r),
  },
  '21': {
    code: '21',
    name: 'Two bends (U / channel)',
    legs: ['A', 'B', 'C'],
    bends: 2,
    cut: (dm, d, r) => sumL(dm, ['A', 'B', 'C']) - 2 * bend90(d, r),
  },
  '31': {
    code: '31',
    name: 'Three bends (crank / Z)',
    legs: ['A', 'B', 'C', 'D'],
    bends: 3,
    cut: (dm, d, r) => sumL(dm, ['A', 'B', 'C', 'D']) - 3 * bend90(d, r),
  },
  '41': {
    code: '41',
    name: 'Four bends',
    legs: ['A', 'B', 'C', 'D', 'E'],
    bends: 4,
    cut: (dm, d, r) => sumL(dm, ['A', 'B', 'C', 'D', 'E']) - 4 * bend90(d, r),
  },
  '51': {
    code: '51',
    name: 'Closed link / stirrup',
    legs: ['A', 'B'],
    bends: 3,
    link: true,
    cut: (dm, d, r, hook) =>
      2 * nMM(dm.A) + 2 * nMM(dm.B) + 2 * (hook ?? linkHook(d)) - 3 * bend90(d, r),
  },
  '67': {
    code: '67',
    name: 'Helix / spiral',
    legs: ['D', 'p', 'H'],
    legLabels: { D: 'Coil Ø', p: 'Pitch', H: 'Height' },
    bends: 0,
    helix: true,
    cut: (dm) => {
      const D = nMM(dm.D)
      const p = nMM(dm.p)
      const H = nMM(dm.H)
      if (D <= 0 || p <= 0 || H <= 0) return 0
      const turns = H / p + 1
      return turns * Math.sqrt(Math.pow(Math.PI * D, 2) + p * p)
    },
  },
  manual: {
    code: '—',
    name: 'Manual (type cutting length)',
    legs: [],
    bends: 0,
    manual: true,
    cut: () => 0,
  },
}

export const SHAPE_CODES = Object.keys(BAR_SHAPES)

export function cuttingLength(bar: BbsBar): number {
  const shape = BAR_SHAPES[bar?.shapeCode] || BAR_SHAPES['00']
  const d = nMM(bar?.dia)
  const r =
    bar?.r !== undefined && bar?.r !== '' ? nMM(bar.r) : formerRadius(d)
  const hook =
    bar?.hook !== undefined && bar?.hook !== '' ? nMM(bar.hook) : linkHook(d)
  if (shape.manual) return nMM(bar?.cutOverride)
  if (bar?.cutManual && bar?.cutOverride !== '') return nMM(bar.cutOverride)
  return Math.max(0, shape.cut(bar?.dims || {}, d, r, hook))
}

export function newBarId() {
  return `b_${Math.random().toString(36).slice(2, 10)}`
}

export function emptyBar(patch: Partial<BbsBar> = {}): BbsBar {
  return {
    id: newBarId(),
    mark: '',
    member: '',
    shapeCode: '00',
    dims: {},
    dia: '',
    r: '',
    hook: '',
    cutManual: false,
    cutOverride: '',
    mbrs: '',
    each: '',
    ...patch,
  }
}

export function barCalc(bar: BbsBar) {
  const totalNo = numOr(bar.mbrs, 1) * numOr(bar.each, 1)
  const cut = cuttingLength(bar)
  const totalLenM = (totalNo * cut) / 1000
  const um = unitMass(bar.dia)
  return { totalNo, cut, totalLenM, unitMass: um, massKg: totalLenM * um }
}

export function bbsQuantity(unit: string, bars: BbsBar[], wastePct = 0) {
  let kg = 0
  for (const bar of bars) kg += barCalc(bar).massKg
  const netKg = kg * (1 + numOr(wastePct, 0) / 100)
  const isKg = normUnit(unit) === 'kg'
  const decimals = isKg ? 2 : 3
  const total = isKg ? netKg : netKg / 1000
  return {
    total: +total.toFixed(decimals),
    totalKg: +netKg.toFixed(2),
    decimals,
  }
}

const STARTER_BARS: Record<string, Partial<BbsBar>[]> = {
  PILES: [
    { mark: 'M1', member: 'Main bars', shapeCode: '00', dia: '20' },
    { mark: 'H1', member: 'Helical link', shapeCode: '67', dia: '10' },
  ],
  COLUMNS: [
    { mark: 'M1', member: 'Main bars', shapeCode: '00', dia: '25' },
    { mark: 'L1', member: 'Links', shapeCode: '51', dia: '10' },
  ],
  PAD_FOOTING: [{ mark: 'B1', member: 'Bottom bars', shapeCode: '21', dia: '16' }],
  WALLS: [
    { mark: 'V1', member: 'Vertical', shapeCode: '00', dia: '16' },
    { mark: 'L1', member: 'Links', shapeCode: '51', dia: '10' },
  ],
  BEAMS: [
    { mark: 'T1', member: 'Top', shapeCode: '00', dia: '20' },
    { mark: 'B1', member: 'Bottom', shapeCode: '11', dia: '20' },
    { mark: 'L1', member: 'Links', shapeCode: '51', dia: '10' },
  ],
}

export function starterBars(elementKey?: string): BbsBar[] {
  const seeds = (elementKey && STARTER_BARS[elementKey]) || []
  if (!seeds.length) return [emptyBar()]
  return seeds.map((s) => emptyBar({ ...s, dims: { ...(s.dims || {}) } }))
}

export function sanitizeBars(raw: unknown): BbsBar[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 200).map((row) => {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
    const dims =
      r.dims && typeof r.dims === 'object' && !Array.isArray(r.dims)
        ? Object.fromEntries(
            Object.entries(r.dims as Record<string, unknown>).map(([k, v]) => [
              k,
              typeof v === 'number' || typeof v === 'string' ? v : '',
            ]),
          )
        : {}
    const shapeCode =
      typeof r.shapeCode === 'string' && BAR_SHAPES[r.shapeCode] ? r.shapeCode : '00'
    const dimVal = (v: unknown): DimValue =>
      typeof v === 'number' || typeof v === 'string' ? v : ''
    return {
      id: typeof r.id === 'string' && r.id ? r.id : newBarId(),
      mark: typeof r.mark === 'string' ? r.mark : '',
      member: typeof r.member === 'string' ? r.member : '',
      shapeCode,
      dims,
      dia: dimVal(r.dia),
      r: dimVal(r.r),
      hook: dimVal(r.hook),
      cutManual: Boolean(r.cutManual),
      cutOverride: dimVal(r.cutOverride),
      mbrs: dimVal(r.mbrs),
      each: dimVal(r.each),
    }
  })
}

export { evalNumber }

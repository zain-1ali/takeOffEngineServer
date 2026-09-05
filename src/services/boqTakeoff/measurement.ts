/** Dimensioned takeoff engine — mirrors takeoff-demo.html */

export type TakeoffPrim = 'count' | 'linear' | 'area' | 'volume'
export type DimValue = string | number

export type TakeoffLine = {
  id: string
  label?: string
  ded?: boolean
  nr?: DimValue
  shape: string
  dims?: Record<string, DimValue>
  depth?: DimValue
  direct?: { value?: DimValue; prim?: TakeoffPrim }
}

export type ShapeDef = {
  name: string
  fields: [string, string][]
  compute: (d: Record<string, DimValue>) => {
    area: number
    perimeter: number
    length: number
  }
}

const PI = Math.PI

export function evalNumber(v: unknown, fb = 0): number {
  if (v === '' || v == null) return fb
  if (typeof v === 'number') return Number.isFinite(v) ? v : fb
  let s = String(v).trim()
  if (s === '') return fb
  s = s.replace(/,/g, '.')
  if (!/^[0-9+\-*/().\s]+$/.test(s)) return fb
  try {
    let i = 0
    const skip = () => {
      while (i < s.length && s[i] === ' ') i++
    }
    const number = () => {
      skip()
      const st = i
      while (i < s.length && /[0-9.]/.test(s[i])) i++
      const t = s.slice(st, i)
      if (t === '' || t === '.' || (t.match(/\./g) || []).length > 1) throw 0
      const n = parseFloat(t)
      if (!Number.isFinite(n)) throw 0
      return n
    }
    const factor = (): number => {
      skip()
      if (s[i] === '(') {
        i++
        const v2 = expr()
        skip()
        if (s[i] !== ')') throw 0
        i++
        return v2
      }
      if (s[i] === '-') {
        i++
        return -factor()
      }
      if (s[i] === '+') {
        i++
        return factor()
      }
      return number()
    }
    const term = (): number => {
      let v2 = factor()
      skip()
      while (s[i] === '*' || s[i] === '/') {
        const op = s[i++]
        const r = factor()
        v2 = op === '*' ? v2 * r : v2 / r
        skip()
      }
      return v2
    }
    const expr = (): number => {
      let v2 = term()
      skip()
      while (s[i] === '+' || s[i] === '-') {
        const op = s[i++]
        const r = term()
        v2 = op === '+' ? v2 + r : v2 - r
        skip()
      }
      return v2
    }
    const val = expr()
    skip()
    if (i !== s.length) throw 0
    return Number.isFinite(val) ? val : fb
  } catch {
    return fb
  }
}

export const numOr = (v: unknown, fb = 0) => evalNumber(v, fb)

export const isFormula = (v: unknown) =>
  typeof v === 'string' && /[+\-*/()]/.test(v.trim().replace(/^-/, ''))

export function normUnit(u: unknown): string {
  return String(u ?? '')
    .trim()
    .toLowerCase()
    .replace('³', '3')
    .replace('²', '2')
}

export const PRIMS: TakeoffPrim[] = ['count', 'linear', 'area', 'volume']
export const PRIM_LABEL: Record<TakeoffPrim, string> = {
  count: 'Count',
  linear: 'Linear',
  area: 'Area',
  volume: 'Volume',
}
export const PRIM_UNIT: Record<TakeoffPrim, string> = {
  count: 'nr',
  linear: 'm',
  area: 'm²',
  volume: 'm³',
}

export const SHAPES: Record<string, ShapeDef> = {
  rect: {
    name: 'Rectangle',
    fields: [
      ['a', 'Length'],
      ['b', 'Breadth'],
    ],
    compute: (d) => {
      const a = numOr(d.a, 0)
      const b = numOr(d.b, 0)
      return { area: a * b, perimeter: 2 * (a + b), length: 0 }
    },
  },
  rtri: {
    name: 'Right triangle',
    fields: [
      ['a', 'Leg a'],
      ['b', 'Leg b'],
    ],
    compute: (d) => {
      const a = numOr(d.a, 0)
      const b = numOr(d.b, 0)
      return { area: (a * b) / 2, perimeter: a + b + Math.hypot(a, b), length: 0 }
    },
  },
  tri: {
    name: 'Triangle (3 sides)',
    fields: [
      ['a', 'Side a'],
      ['b', 'Side b'],
      ['c', 'Side c'],
    ],
    compute: (d) => {
      const a = numOr(d.a, 0)
      const b = numOr(d.b, 0)
      const c = numOr(d.c, 0)
      const s = (a + b + c) / 2
      return {
        area: Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c))),
        perimeter: a + b + c,
        length: 0,
      }
    },
  },
  trap: {
    name: 'Trapezoid (isosceles)',
    fields: [
      ['a', 'Parallel a'],
      ['b', 'Parallel b'],
      ['h', 'Height'],
    ],
    compute: (d) => {
      const a = numOr(d.a, 0)
      const b = numOr(d.b, 0)
      const h = numOr(d.h, 0)
      const leg = Math.hypot(h, (a - b) / 2)
      return { area: ((a + b) / 2) * h, perimeter: a + b + 2 * leg, length: 0 }
    },
  },
  circle: {
    name: 'Circle',
    fields: [['dia', 'Diameter']],
    compute: (d) => {
      const D = numOr(d.dia, 0)
      return { area: (PI * D * D) / 4, perimeter: PI * D, length: 0 }
    },
  },
  semicircle: {
    name: 'Semicircle',
    fields: [['dia', 'Diameter']],
    compute: (d) => {
      const D = numOr(d.dia, 0)
      return { area: (PI * D * D) / 8, perimeter: (PI * D) / 2 + D, length: 0 }
    },
  },
  ring: {
    name: 'Ring / annulus',
    fields: [
      ['dia', 'Outer Ø'],
      ['dia2', 'Inner Ø'],
    ],
    compute: (d) => {
      const D = numOr(d.dia, 0)
      const inner = numOr(d.dia2, 0)
      return {
        area: (PI * (D * D - inner * inner)) / 4,
        perimeter: PI * (D + inner),
        length: 0,
      }
    },
  },
  sector: {
    name: 'Sector',
    fields: [
      ['dia', 'Diameter'],
      ['ang', 'Angle°'],
    ],
    compute: (d) => {
      const D = numOr(d.dia, 0)
      const t = numOr(d.ang, 0)
      const arc = (PI * D * t) / 360
      return { area: ((PI * D * D) / 4) * (t / 360), perimeter: arc + D, length: arc }
    },
  },
  polygon: {
    name: 'Regular polygon',
    fields: [
      ['n', 'No. sides'],
      ['s', 'Side length'],
    ],
    compute: (d) => {
      const n = numOr(d.n, 0)
      const s = numOr(d.s, 0)
      return {
        area: n >= 3 && s > 0 ? (n * s * s) / (4 * Math.tan(PI / n)) : 0,
        perimeter: n * s,
        length: 0,
      }
    },
  },
  linear: {
    name: 'Linear (run)',
    fields: [['a', 'Length']],
    compute: (d) => {
      const a = numOr(d.a, 0)
      return { area: 0, perimeter: 0, length: a }
    },
  },
  direct: {
    name: 'Direct entry',
    fields: [],
    compute: () => ({ area: 0, perimeter: 0, length: 0 }),
  },
}

export const SHAPE_KEYS = Object.keys(SHAPES)

export function lineOutputs(line: TakeoffLine): Record<TakeoffPrim, number> {
  const nr = numOr(line.nr, 1)
  const sign = line.ded ? -1 : 1
  const q = nr * sign
  const out: Record<TakeoffPrim, number> = {
    count: 0,
    linear: 0,
    area: 0,
    volume: 0,
  }
  if (line.shape === 'direct') {
    const prim = line.direct?.prim || 'area'
    out[prim] = q * numOr(line.direct?.value, 0)
    if (prim !== 'count') out.count = q
    return out
  }
  const g = (SHAPES[line.shape] || SHAPES.rect).compute(line.dims || {})
  const depth = numOr(line.depth, 0)
  out.count = q
  out.linear = q * (g.length + g.perimeter)
  out.area = q * g.area
  out.volume = q * g.area * depth
  return out
}

export function setTotals(lines: TakeoffLine[] | undefined) {
  const t: Record<TakeoffPrim, number> = {
    count: 0,
    linear: 0,
    area: 0,
    volume: 0,
  }
  for (const l of lines || []) {
    const o = lineOutputs(l)
    for (const k of PRIMS) t[k] += o[k]
  }
  return t
}

const UNIT_PRIM: Record<string, TakeoffPrim> = {
  m3: 'volume',
  m2: 'area',
  m: 'linear',
  lm: 'linear',
  rm: 'linear',
  nr: 'count',
  no: 'count',
  item: 'count',
  sum: 'count',
}

export const autoPrim = (u: unknown): TakeoffPrim =>
  UNIT_PRIM[normUnit(u)] || 'area'

export const decimalsForPrim = (p: TakeoffPrim) => (p === 'count' ? 0 : 2)

export function itemQuantity(unit: string, lines: TakeoffLine[], wastePct = 0) {
  const prim = autoPrim(unit)
  const base = setTotals(lines)[prim]
  const waste = numOr(wastePct, 0)
  const dp = decimalsForPrim(prim)
  return {
    prim,
    base: +base.toFixed(dp),
    total: +(base * (1 + waste / 100)).toFixed(dp),
    decimals: dp,
  }
}

export function newTakeoffLineId() {
  return `m_${Math.random().toString(36).slice(2, 10)}`
}

export function emptyLine(shape = 'rect'): TakeoffLine {
  return {
    id: newTakeoffLineId(),
    label: '',
    ded: false,
    nr: '',
    shape,
    dims: {},
    depth: '',
    direct: { value: '', prim: 'area' },
  }
}

export function takeoffKindFor(unit: string): 'bbs' | 'dim' {
  const u = normUnit(unit)
  return u === 't' || u === 'kg' ? 'bbs' : 'dim'
}

export function clampQty(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

const STARTER_SHAPE: Record<string, string> = {
  PILES: 'circle',
  PAD_FOOTING: 'rect',
  COLUMNS: 'rect',
  WALLS: 'rect',
  BEAMS: 'rect',
}

export function starterLines(elementKey?: string, label = ''): TakeoffLine[] {
  const shape = (elementKey && STARTER_SHAPE[elementKey]) || 'rect'
  return [{ ...emptyLine(shape), label }]
}

export function sanitizeLines(raw: unknown): TakeoffLine[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 200).map((row) => {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
    const shape = typeof r.shape === 'string' && SHAPES[r.shape] ? r.shape : 'rect'
    const dims =
      r.dims && typeof r.dims === 'object' && !Array.isArray(r.dims)
        ? Object.fromEntries(
            Object.entries(r.dims as Record<string, unknown>).map(([k, v]) => [
              k,
              typeof v === 'number' || typeof v === 'string' ? v : '',
            ]),
          )
        : {}
    const directObj =
      r.direct && typeof r.direct === 'object' && !Array.isArray(r.direct)
        ? (r.direct as Record<string, unknown>)
        : {}
    const prim = PRIMS.includes(directObj.prim as TakeoffPrim)
      ? (directObj.prim as TakeoffPrim)
      : 'area'
    return {
      id: typeof r.id === 'string' && r.id ? r.id : newTakeoffLineId(),
      label: typeof r.label === 'string' ? r.label : '',
      ded: Boolean(r.ded),
      nr: typeof r.nr === 'number' || typeof r.nr === 'string' ? r.nr : '',
      shape,
      dims,
      depth: typeof r.depth === 'number' || typeof r.depth === 'string' ? r.depth : '',
      direct: {
        value:
          typeof directObj.value === 'number' || typeof directObj.value === 'string'
            ? directObj.value
            : '',
        prim,
      },
    }
  })
}

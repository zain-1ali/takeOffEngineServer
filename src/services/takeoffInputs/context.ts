import { calcDuct } from '../../engines/ducts'
import { calcDuctFitting } from '../../engines/ductFittings'
import { calcElectrical } from '../../engines/electrical'
import { calcFinish } from '../../engines/finishes'
import { calcMasonry } from '../../engines/masonry'
import { calcPipe } from '../../engines/pipes'
import type { HeadingContext } from './types'

export type InstanceLike = {
  floorId?: string
  elementKey?: string
  count?: number
  geometry?: Record<string, unknown> | null
}

const n = (value: unknown, fallback = 0): number => {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : fallback
}

export const sharedNum = (shared: Record<string, unknown>, key: string, fallback = 0) =>
  n(shared[key], fallback)

export const sharedOn = (shared: Record<string, unknown>, key: string): boolean => {
  const value = shared[key]
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  if (value == null) return false
  return Boolean(value)
}

function geo(geometry: Record<string, unknown> | null | undefined, keys: string[]): number {
  if (!geometry) return 0
  for (const key of keys) {
    const value = n(geometry[key])
    if (value > 0) return value
  }
  return 0
}

export function emptyHeadingContext(
  shared: Record<string, unknown> = {},
): HeadingContext {
  return {
    units: 0,
    planArea: 0,
    length: 0,
    width: 0,
    thickness: 0,
    height: 0,
    perimeter: 0,
    openingArea: 0,
    excavationM3: 0,
    concrete: 0,
    formwork: 0,
    faceArea: 0,
    area: 0,
    nos: 0,
    surface: 0,
    joints: 0,
    insulation: 0,
    fittings: 0,
    screed: 0,
    tiles: 0,
    riserLm: 0,
    sideLm: 0,
    cable: 0,
    equivalentLength: 0,
    shared,
  }
}

export function buildHeadingContext(
  elementKey: string,
  instances: InstanceLike[],
  shared: Record<string, unknown> = {},
): HeadingContext {
  const ctx = emptyHeadingContext(shared)
  const ws = sharedNum(shared, 'workingSpaceM')
  const excavDepth = sharedNum(shared, 'excavationDepthM')
  const trenchWs = sharedNum(shared, 'trenchWorkingSpaceM', ws)

  for (const inst of instances) {
    const count = Math.max(1, n(inst.count, 1))
    const g = inst.geometry || {}
    const length = geo(g, ['length', 'spanLength', 'run', 'wallLength', 'roomLength'])
    const width = geo(g, ['width', 'breadth', 'roomWidth'])
    const thickness = geo(g, [
      'thickness',
      'baseThickness',
      'depth',
      'waistThickness',
    ])
    const height = geo(g, ['height', 'rise', 'wallHeight'])
    const opening = geo(g, ['openingArea'])
    const override = geo(g, ['areaOverride'])
    ctx.units += count
    ctx.length += length * count
    ctx.width += width * count
    ctx.thickness += thickness * count
    ctx.height += height * count
    ctx.openingArea += opening * count
    ctx.planArea += length * width * count
    ctx.perimeter += 2 * (length + width) * count
    ctx.concrete += length * width * (thickness || height) * count
    const face = override || Math.max(0, length * height - opening)
    ctx.faceArea += face * count
    ctx.area += (override || length * width - opening) * count
    ctx.nos += count

    const family = elementKey.toUpperCase()
    if (family.includes('STRIP') || family === 'BEAMS' || family === 'LINTELS') {
      ctx.excavationM3 += length * (width + 2 * trenchWs) * excavDepth * count
    } else if (family === 'EARTHWORKS') {
      const trenchW = width || geo(g, ['trenchWidth'])
      const depth = thickness || geo(g, ['depth'])
      ctx.excavationM3 += length * trenchW * depth * count
    } else {
      ctx.excavationM3 +=
        (length + 2 * ws) * (width + 2 * ws) * excavDepth * count
    }
    ctx.formwork += 2 * (length + width) * (thickness || height) * count
  }

  if (elementKey === 'EARTHWORKS' && ctx.excavationM3 === 0) {
    ctx.excavationM3 =
      sharedNum(shared, 'siteAreaM2') * excavDepth ||
      sharedNum(shared, 'cutVolumeM3')
  }
  overlayEngineTotals(elementKey, instances, ctx)
  return ctx
}

/** Prefer live engine totals (finish area, MEP length, …) over L×W guesses. */
function overlayEngineTotals(
  elementKey: string,
  instances: InstanceLike[],
  ctx: HeadingContext,
): void {
  const family = elementKey.toUpperCase()
  let area = 0
  let length = 0
  let surface = 0
  let joints = 0
  let insulation = 0
  let fittings = 0
  let screed = 0
  let tiles = 0
  let cable = 0
  let equivalentLength = 0
  let nos = 0
  let faceArea = 0
  let applied = false

  for (const inst of instances) {
    const count = Math.max(1, n(inst.count, 1))
    const g: Record<string, unknown> = { ...(inst.geometry || {}), count }
    try {
      if (family === 'DUCTS') {
        const r = calcDuct(g as any)
        length += r.totalLengthM
        surface += r.totalSurfaceM2
        joints += r.totalJoints
        applied = true
      } else if (family === 'DUCT_FITTINGS') {
        const r = calcDuctFitting(g as any)
        nos += r.totalNos
        equivalentLength += r.totalEquivalentLengthM
        applied = true
      } else if (family === 'PIPES') {
        const r = calcPipe(g as any)
        length += r.totalLengthM
        insulation += r.totalInsulationM
        fittings += r.totalFittingsNos
        applied = true
      } else if (family === 'ELECTRICAL') {
        const r = calcElectrical({
          ...g,
          shape: (g.shape as 'CONDUIT' | 'TRAY' | 'CABLE') || 'CONDUIT',
        } as any)
        length += r.totalLengthM
        cable += r.totalCableM
        applied = true
      } else if (family === 'FLOOR_FINISH' || family === 'CEILING_FINISH') {
        const r = calcFinish(family === 'FLOOR_FINISH' ? 'FLOOR' : 'CEILING', {
          spec: String(g.spec || ''),
          roomLength: n(g.roomLength, n(g.length)),
          roomWidth: n(g.roomWidth, n(g.width)),
          openingArea: n(g.openingArea),
          areaOverride: g.areaOverride as number | null,
          count,
        } as any)
        area += r.totalAreaM2
        screed += r.totalScreedM3
        tiles += r.totalTilesM2
        applied = true
      } else if (family === 'WALL_FINISH') {
        const r = calcFinish('WALL', {
          spec: String(g.spec || ''),
          wallLength: n(g.wallLength, n(g.length)),
          wallHeight: n(g.wallHeight, n(g.height)),
          openingArea: n(g.openingArea),
          areaOverride: g.areaOverride as number | null,
          count,
        } as any)
        area += r.totalAreaM2
        faceArea += r.totalAreaM2
        applied = true
      } else if (family === 'MASONRY' || family === 'STONE_STRIP') {
        const r = calcMasonry({
          wallLength: n(g.wallLength, n(g.length)),
          wallHeight: n(g.wallHeight, n(g.height)),
          thickness: n(g.thickness),
          openingArea: n(g.openingArea),
          areaOverride: g.areaOverride as number | null,
          count,
        } as any)
        faceArea += r.totalAreaM2
        area += r.totalAreaM2
        applied = true
      }
    } catch {
      /* keep geometry-derived totals */
    }
  }

  if (!applied) return
  if (area > 0) ctx.area = area
  if (faceArea > 0) ctx.faceArea = faceArea
  if (length > 0) ctx.length = length
  if (surface > 0) ctx.surface = surface
  if (joints > 0) ctx.joints = joints
  if (insulation > 0) ctx.insulation = insulation
  if (fittings > 0) ctx.fittings = fittings
  if (screed > 0) ctx.screed = screed
  if (tiles > 0) ctx.tiles = tiles
  if (cable > 0) ctx.cable = cable
  if (equivalentLength > 0) ctx.equivalentLength = equivalentLength
  if (nos > 0) ctx.nos = nos
}

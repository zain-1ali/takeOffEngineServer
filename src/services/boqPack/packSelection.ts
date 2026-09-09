import { PROJECT_SCOPE_FLOOR_ID } from './scope'

export type PackItemMatch = {
  _id: unknown
  moduleNo: number
  ref: string
  lineKey: string
  elementKey: string
  unit: string
  description: string
  formulaText?: string
  quantityBasis?: string
  applicableLevelRaw?: string
  scope: 'PROJECT' | 'FLOOR'
}

export type SelectedMatchInput = {
  catalogueRef: string
  elementKey: string
  unit?: string
  lineKey?: string
  moduleNo?: number
  scope?: 'PROJECT' | 'FLOOR' | ''
  floorId?: string
}

export function moduleRefKey(moduleNo: number, ref: string): string {
  return `${moduleNo}\0${String(ref || '').trim()}`
}

export function elementRefKey(elementKey: string, ref: string): string {
  return `${elementKey}\0${String(ref || '').trim()}`
}

export function inferredScope(
  scope: string | undefined,
  floorId: string | undefined,
): 'PROJECT' | 'FLOOR' {
  if (scope === 'PROJECT' || scope === 'FLOOR') return scope
  return floorId === PROJECT_SCOPE_FLOOR_ID ? 'PROJECT' : 'FLOOR'
}

export type PackMatchIndexes = {
  byLineKey: Map<string, PackItemMatch>
  byModuleRef: Map<string, PackItemMatch>
  byElementRef: Map<string, PackItemMatch>
}

export function buildPackMatchIndexes(items: PackItemMatch[]): PackMatchIndexes {
  const byLineKey = new Map()
  const byModuleRef = new Map()
  const byElementRef = new Map()
  for (const it of items) {
    if (it.lineKey && !byLineKey.has(it.lineKey)) byLineKey.set(it.lineKey, it)
    const mk = moduleRefKey(it.moduleNo, it.ref)
    if (!byModuleRef.has(mk)) byModuleRef.set(mk, it)
    const ek = elementRefKey(it.elementKey, it.ref)
    if (!byElementRef.has(ek)) byElementRef.set(ek, it)
  }
  return { byLineKey, byModuleRef, byElementRef }
}

/** Match overlay row to a pack line. Catalogue.json migration uses (elementKey, ref). */
export function findPackMatch(
  selected: SelectedMatchInput,
  indexes: PackMatchIndexes,
): PackItemMatch | null {
  const lineKey = String(selected.lineKey || '').trim()
  if (lineKey) {
    const hit = indexes.byLineKey.get(lineKey)
    if (hit) return hit
  }
  if (selected.moduleNo != null && Number.isFinite(selected.moduleNo)) {
    const hit = indexes.byModuleRef.get(
      moduleRefKey(selected.moduleNo, selected.catalogueRef),
    )
    if (hit) return hit
  }
  return (
    indexes.byElementRef.get(
      elementRefKey(selected.elementKey, selected.catalogueRef),
    ) || null
  )
}

export function bindingNeedsReview(
  selected: SelectedMatchInput,
  packItem: PackItemMatch,
): boolean {
  const prevScope = inferredScope(selected.scope, selected.floorId)
  const unit = String(selected.unit || '').trim()
  const nextUnit = String(packItem.unit || '').trim()
  return (
    selected.elementKey !== packItem.elementKey ||
    prevScope !== packItem.scope ||
    unit !== nextUnit
  )
}

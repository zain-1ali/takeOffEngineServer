import catalogueJson from './catalogue.json'
import type { BoqApplicableLevel, BoqCatalogueFile, BoqCatalogueItem } from './types'
import type { FloorLevelType } from '../../../lib/levelCompatibility'

const file = catalogueJson as BoqCatalogueFile

const byElement = new Map<string, BoqCatalogueItem[]>()
for (const item of file.items) {
  const list = byElement.get(item.elementKey) || []
  list.push(item)
  byElement.set(item.elementKey, list)
}
for (const list of byElement.values()) {
  list.sort((a, b) => a.sortOrder - b.sortOrder)
}

export function getCatalogueMeta(): Pick<BoqCatalogueFile, 'source' | 'importedAt' | 'itemCount'> {
  return {
    source: file.source,
    importedAt: file.importedAt,
    itemCount: file.itemCount,
  }
}

export function catalogueItemsForElement(elementKey: string): BoqCatalogueItem[] {
  return byElement.get(elementKey) || []
}

export function findCatalogueItem(
  elementKey: string,
  ref: string,
): BoqCatalogueItem | undefined {
  const want = normalizeRef(ref)
  return catalogueItemsForElement(elementKey).find(
    (i) => normalizeRef(i.ref) === want,
  )
}

export function normalizeRef(ref: string): string {
  // 1.1 and 1.10 are distinct in Excel; only trim
  return String(ref || '').trim()
}

/**
 * Include catalogue row when:
 * - applicableLevels includes All, or
 * - floorFilter is 'all' (project scope), or
 * - any floor level type intersects applicableLevels
 */
export function catalogueItemAppliesToFloor(
  item: BoqCatalogueItem,
  floorLevelTypes: readonly FloorLevelType[] | 'all',
): boolean {
  if (item.applicableLevels.includes('All')) return true
  if (floorLevelTypes === 'all') return true
  const floorSet = new Set(floorLevelTypes)
  return item.applicableLevels.some((lvl) => {
    if (lvl === 'All') return true
    return floorSet.has(lvl as FloorLevelType)
  })
}

export function resolveApplicableLevelsLabel(
  levels: BoqApplicableLevel[],
): string {
  return levels.join(', ')
}

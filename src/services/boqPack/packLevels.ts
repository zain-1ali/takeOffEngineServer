import type { FloorLevelType } from '../../lib/levelCompatibility'
import { PROJECT_SCOPE_FLOOR_ID } from './scope'

export function isProjectScopedLevel(levelRaw: string, moduleNo: number): boolean {
  if (moduleNo === 0) return true
  const s = String(levelRaw || '').toLowerCase()
  return /project-wide|site-wide|external/.test(s)
}

export function packItemAppliesToFloor(
  levelRaw: string,
  floorLevelTypes: readonly FloorLevelType[] | 'all',
): boolean {
  if (floorLevelTypes === 'all') return true
  const s = String(levelRaw || '').toLowerCase().trim()
  if (!s || /all levels/.test(s) || /^all$/.test(s)) return true
  if (/plant/.test(s)) return true
  if (/foundation/.test(s)) return floorLevelTypes.includes('Foundation')
  if (/below/.test(s)) return floorLevelTypes.includes('Below-Grade')
  if (/roof/.test(s)) return floorLevelTypes.includes('Roof')
  if (/above/.test(s)) return floorLevelTypes.includes('Above-Grade')
  return true
}

export { PROJECT_SCOPE_FLOOR_ID }

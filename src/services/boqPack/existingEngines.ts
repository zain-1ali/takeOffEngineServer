/**
 * Engine keys that MUST keep 3D/schedule. Uploaded headings map here —
 * they must never become catalogue-only stubs.
 * Keep in sync with backend/src/elementEngines.ts ELEMENT_ENGINES.
 */
export const EXISTING_ENGINE_KEYS = [
  'PAD_FOOTING',
  'STRIP_FOOTING',
  'STONE_STRIP',
  'RAFT',
  'PILE_CAP',
  'PILES',
  'EARTHWORKS',
  'COLUMNS',
  'WALLS',
  'BEAMS',
  'SLABS',
  'STAIRS',
  'RAMPS',
  'MASONRY',
  'DOORS_WINDOWS',
  'LINTELS',
  'FLOOR_FINISH',
  'WALL_FINISH',
  'CEILING_FINISH',
  'SKIRTING',
  'DUCTS',
  'DUCT_FITTINGS',
  'PIPES',
  'ELECTRICAL',
] as const

export type ExistingEngineKey = (typeof EXISTING_ENGINE_KEYS)[number]

export const EXISTING_ENGINE_KEY_SET = new Set(EXISTING_ENGINE_KEYS)

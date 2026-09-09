import {
  EXISTING_ENGINE_KEY_SET,
  type ExistingEngineKey,
} from './existingEngines'

export type ElementBinding =
  | { bindingKind: 'ENGINE'; elementKey: ExistingEngineKey; engineKey: ExistingEngineKey }
  | { bindingKind: 'CATALOGUE'; elementKey: string }

/** Unicode NFKC, lower, &→and, punctuation → space. */
export function normalizeLabel(raw: string): string {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Approved aliases only — no fuzzy match.
 * Ambiguous labels must not be listed twice with different keys.
 */
const ALIAS_TO_ENGINE: Record<string, ExistingEngineKey> = {
  'pad foundations': 'PAD_FOOTING',
  'pad foundation': 'PAD_FOOTING',
  'strip foundations': 'STRIP_FOOTING',
  'strip foundation': 'STRIP_FOOTING',
  'strip foundation rc': 'STRIP_FOOTING',
  'stone strip foundations': 'STONE_STRIP',
  'stone strip foundation': 'STONE_STRIP',
  'raft foundations': 'RAFT',
  'raft foundation': 'RAFT',
  'pile caps': 'PILE_CAP',
  'pile cap': 'PILE_CAP',
  piles: 'PILES',
  earthworks: 'EARTHWORKS',
  columns: 'COLUMNS',
  'rc walls': 'WALLS',
  walls: 'WALLS',
  beams: 'BEAMS',
  slabs: 'SLABS',
  'roof slab': 'SLABS',
  'roof slabs': 'SLABS',
  stairs: 'STAIRS',
  ramps: 'RAMPS',
  'masonry infill walls': 'MASONRY',
  masonry: 'MASONRY',
  'doors and windows': 'DOORS_WINDOWS',
  lintels: 'LINTELS',
  'floor finishes': 'FLOOR_FINISH',
  'wall finishes': 'WALL_FINISH',
  'ceiling finishes': 'CEILING_FINISH',
  'skirting baseboards': 'SKIRTING',
  skirting: 'SKIRTING',
  'ductwork and air distribution': 'DUCTS',
  ducts: 'DUCTS',
  'air distribution ducts': 'DUCTS',
  'duct fittings': 'DUCT_FITTINGS',
  'duct fittings and hvac': 'DUCT_FITTINGS',
  'pipes and plumbing': 'PIPES',
  'cable containment': 'ELECTRICAL',
  'conduits and cable trays': 'ELECTRICAL',
  'cable containment systems': 'ELECTRICAL',
}

export function catalogueElementKey(moduleNo: number, elementRef: string): string {
  const m = String(moduleNo).padStart(2, '0')
  const e = String(elementRef || '0').replace(/\D+/g, '').padStart(3, '0') || '000'
  return `CAT_M${m}_E${e}`
}

export function parseCatalogueElementKey(
  key: string,
): { moduleNo: number; elementNo: number } | null {
  const m = /^CAT_M(\d{2})_E(\d{3})$/.exec(String(key || '').trim())
  if (!m) return null
  return { moduleNo: Number(m[1]), elementNo: Number(m[2]) }
}

export function isCatalogueElementKey(key: string): boolean {
  return parseCatalogueElementKey(key) != null
}

export function resolveElementBinding(args: {
  label: string
  moduleNo: number
  elementRef: string
}): ElementBinding {
  const norm = normalizeLabel(args.label)
  const engine = ALIAS_TO_ENGINE[norm]
  if (engine) {
    if (!EXISTING_ENGINE_KEY_SET.has(engine)) {
      throw new Error(`Alias maps to unknown engine ${engine}`)
    }
    return { bindingKind: 'ENGINE', elementKey: engine, engineKey: engine }
  }
  return {
    bindingKind: 'CATALOGUE',
    elementKey: catalogueElementKey(args.moduleNo, args.elementRef),
  }
}

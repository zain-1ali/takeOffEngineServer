/**
 * Instance mark auto-numbering — same convention as new schedule rows,
 * IFC accept, and blueprint promotion: `{prefix}{n}` (C1, C2, FF3, …).
 */

/** Matches frontend ELEMENT_SCHEMAS.markPrefix. */
export const MARK_PREFIX_BY_ELEMENT: Record<string, string> = {
  PAD_FOOTING: 'F',
  RAFT: 'RF',
  PILE_CAP: 'PC',
  PILES: 'P',
  EARTHWORKS: 'EW',
  COLUMNS: 'C',
  BEAMS: 'B',
  SLABS: 'S',
  STAIRS: 'ST',
  RAMPS: 'R',
  STRIP_FOOTING: 'SF',
  WALLS: 'W',
  STONE_STRIP: 'STF',
  FLOOR_FINISH: 'FF',
  WALL_FINISH: 'WF',
  CEILING_FINISH: 'CF',
  MASONRY: 'MW',
  DOORS_WINDOWS: 'DW',
  LINTELS: 'LN',
  SKIRTING: 'SK',
  DUCTS: 'DU',
  DUCT_FITTINGS: 'DF',
  PIPES: 'PP',
  ELECTRICAL: 'EL',
};

const GRID_KEYS = ['gridRef', 'gridX', 'gridY', 'gridStart', 'gridEnd'] as const;

export function nextPrefixedMarkSeed(
  prefix: string,
  existingMarks: readonly string[],
): number {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}(\\d+)$`, 'i');
  let max = 0;
  for (const mark of existingMarks) {
    const match = re.exec(String(mark).trim());
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return max + 1;
}

/** Leading letters + trailing digits, e.g. C1 → C, FF12 → FF. */
export function prefixFromMark(mark: string): string | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(mark.trim());
  return match ? match[1] : null;
}

/**
 * Next unused `{prefix}{n}` given existing marks on the floor/element.
 * Prefers the source mark's letter prefix when it already follows the convention.
 */
export function nextUniqueMark(
  sourceMark: string,
  existingMarks: readonly string[],
  fallbackPrefix: string,
): string {
  const used = new Set(
    existingMarks.map((mark) => mark.trim().toUpperCase()).filter(Boolean),
  );
  const prefix =
    prefixFromMark(sourceMark) || fallbackPrefix.trim() || 'X';
  let seed = nextPrefixedMarkSeed(prefix, existingMarks);
  let candidate = `${prefix}${seed}`;
  while (used.has(candidate.toUpperCase())) {
    seed += 1;
    candidate = `${prefix}${seed}`;
  }
  return candidate;
}

export function markPrefixForElement(elementKey: string): string {
  return MARK_PREFIX_BY_ELEMENT[elementKey] || 'X';
}

/** Drop grid intersection/span refs so a same-floor copy is unplaced. */
export function clearGridPlacement(
  geometry: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...geometry };
  for (const key of GRID_KEYS) {
    delete next[key];
  }
  return next;
}

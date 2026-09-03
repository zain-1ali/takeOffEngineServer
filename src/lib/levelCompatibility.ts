/**
 * Floor level-type taxonomy + compatibility helpers.
 * Keep in sync with frontend/src/lib/levelCompatibility.ts
 */

export const FLOOR_LEVEL_TYPES = [
  'Foundation',
  'Below-Grade',
  'Above-Grade',
  'Roof',
] as const;

export type FloorLevelType = (typeof FLOOR_LEVEL_TYPES)[number];

export function isFloorLevelType(value: unknown): value is FloorLevelType {
  return (
    typeof value === 'string' &&
    (FLOOR_LEVEL_TYPES as readonly string[]).includes(value)
  );
}

export function normalizeLevelTypes(raw: unknown): FloorLevelType[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<FloorLevelType>();
  for (const item of raw) {
    if (isFloorLevelType(item)) set.add(item);
  }
  return FLOOR_LEVEL_TYPES.filter((t) => set.has(t));
}

/**
 * Client floor naming convention (sort prefix + abbreviations).
 * Below-Grade / B1–B2 are not on this sheet — kept via separate basement rules.
 */
export const CLIENT_FLOOR_NAMING = [
  {
    sortPrefix: 'RF',
    levelName: 'Roof Level',
    abbreviations: ['RF', 'ROOF', 'TOS_RF'],
    levelTypes: ['Roof'] as const,
  },
  {
    sortPrefix: '06',
    levelName: 'Sixth Floor',
    abbreviations: ['06F', 'L06'],
    levelTypes: ['Above-Grade'] as const,
  },
  {
    sortPrefix: '05',
    levelName: 'Fifth Floor',
    abbreviations: ['05F', 'L05'],
    levelTypes: ['Above-Grade'] as const,
  },
  {
    sortPrefix: '04',
    levelName: 'Fourth Floor',
    abbreviations: ['04F', 'L04'],
    levelTypes: ['Above-Grade'] as const,
  },
  {
    sortPrefix: '03',
    levelName: 'Third Floor',
    abbreviations: ['03F', 'L03'],
    levelTypes: ['Above-Grade'] as const,
  },
  {
    sortPrefix: '02',
    levelName: 'Second Floor',
    abbreviations: ['2F', 'SF', 'L02', '02F'],
    levelTypes: ['Above-Grade'] as const,
  },
  {
    sortPrefix: '01',
    levelName: 'First Floor',
    abbreviations: ['1F', 'FF', 'L01', '01F'],
    levelTypes: ['Above-Grade'] as const,
  },
  {
    sortPrefix: '00',
    levelName: 'Ground Floor',
    abbreviations: ['GF', 'L00', 'FFL', '00', '00F'],
    levelTypes: ['Above-Grade'] as const,
  },
  {
    sortPrefix: 'FND',
    levelName: 'Foundation',
    abbreviations: ['FND', 'TOF', 'BOF', 'FDN'],
    levelTypes: ['Foundation'] as const,
  },
] as const;

export function suggestedSortOrderForFloorId(floorId: string): number | null {
  const id = floorId.trim().toUpperCase();
  const idx = CLIENT_FLOOR_NAMING.findIndex(
    (row) =>
      row.sortPrefix === id ||
      row.abbreviations.some(
        (a) => a === id || id.startsWith(`${a}_`) || id.startsWith(`${a}-`),
      ),
  );
  if (idx < 0) return null;
  return CLIENT_FLOOR_NAMING.length - 1 - idx;
}

export function inferFloorLevelTypes(
  floorId: string,
  label = '',
): FloorLevelType[] {
  const id = floorId.trim().toUpperCase();
  const compact = id.replace(/[^A-Z0-9]/g, '');
  const text = `${floorId} ${label}`.toUpperCase();
  const hay = ` ${text.replace(/[^A-Z0-9]+/g, ' ')} `;

  if (
    /\bROOF\b/.test(hay) ||
    /\bTOS_?RF\b/.test(hay) ||
    id === 'RF' ||
    compact === 'RF' ||
    compact === 'TOSRF' ||
    id.startsWith('RF_') ||
    id.startsWith('RF-') ||
    id.endsWith('_RF') ||
    id.endsWith('-RF')
  ) {
    return ['Roof'];
  }

  if (
    /\bFOUNDATION\b/.test(hay) ||
    /\bFND\b/.test(hay) ||
    /\bTOF\b/.test(hay) ||
    /\bBOF\b/.test(hay) ||
    /\bFDN\b/.test(hay) ||
    id === 'FND' ||
    id === 'FDN' ||
    id === 'TOF' ||
    id === 'BOF' ||
    id.startsWith('FND') ||
    id.startsWith('FDN')
  ) {
    if (/\bBASEMENT\b/.test(hay) || /\bB2\b/.test(hay)) {
      return ['Foundation', 'Below-Grade'];
    }
    return ['Foundation'];
  }

  if (
    /\bB2\b/.test(hay) ||
    id === 'B2' ||
    id.startsWith('B2_') ||
    id.startsWith('B2-') ||
    (/\bFOUNDATION\b/.test(hay) && /\bBASEMENT\b/.test(hay))
  ) {
    return ['Foundation', 'Below-Grade'];
  }

  if (
    /\bBASEMENT\b/.test(hay) ||
    /\bBELOW\s*GRADE\b/.test(hay) ||
    /^B\d/.test(id) ||
    id.startsWith('B1')
  ) {
    return ['Below-Grade'];
  }

  for (const row of CLIENT_FLOOR_NAMING) {
    if (row.levelTypes[0] !== 'Above-Grade') continue;
    if (row.sortPrefix === id) return ['Above-Grade'];
    for (const abbr of row.abbreviations) {
      if (
        id === abbr ||
        compact === abbr.replace(/[^A-Z0-9]/g, '') ||
        id.startsWith(`${abbr}_`) ||
        id.startsWith(`${abbr}-`) ||
        new RegExp(
          `\\b${abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        ).test(hay)
      ) {
        return ['Above-Grade'];
      }
    }
  }

  if (/^L0?\d{1,2}$/.test(id) || /^\d{1,2}F$/.test(id) || /^0[0-6]$/.test(id)) {
    return ['Above-Grade'];
  }

  return ['Above-Grade'];
}

export function resolveFloorLevelTypes(args: {
  floorId: string;
  label?: string;
  levelTypes?: unknown;
}): FloorLevelType[] {
  const stored = normalizeLevelTypes(args.levelTypes);
  if (stored.length > 0) return stored;
  return inferFloorLevelTypes(args.floorId, args.label ?? '');
}

export function resolveAllowedLevelTypes(
  allowed: readonly FloorLevelType[] | null | undefined,
): FloorLevelType[] | 'all' {
  if (allowed == null) return 'all';
  const n = normalizeLevelTypes([...allowed]);
  if (n.length === 0) return 'all';
  return n;
}

export function isFloorCompatibleWithElement(
  floorLevelTypes: readonly FloorLevelType[],
  allowedLevelTypes: readonly FloorLevelType[] | null | undefined,
): boolean {
  const allowed = resolveAllowedLevelTypes(allowedLevelTypes);
  if (allowed === 'all') return true;
  const floorSet = new Set(normalizeLevelTypes([...floorLevelTypes]));
  if (floorSet.size === 0) return false;
  return allowed.some((t) => floorSet.has(t));
}

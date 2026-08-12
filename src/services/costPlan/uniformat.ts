/**
 * UniFormat II classification for Cost Plan grouping.
 * Location-dependent codes require Instance.location (user-overridable).
 */

export type UniformatLocation =
  | 'Below-grade'
  | 'Exterior'
  | 'Interior'
  | 'On-grade'
  | 'Elevated floor'
  | 'Roof';

export type UniformatCodeDef = {
  code: string;
  title: string;
  /** Level-1 group letter, e.g. A, B, C, D */
  group: string;
};

/** Standard UniFormat II Level-1 groups used in the Cost Plan. */
export const UNIFORMAT_GROUPS: { id: string; title: string }[] = [
  { id: 'A', title: 'Substructure' },
  { id: 'B', title: 'Shell' },
  { id: 'C', title: 'Interiors' },
  { id: 'D', title: 'Services' },
  { id: 'E', title: 'Equipment and Furnishings' },
  { id: 'F', title: 'Special Construction and Demolition' },
  { id: 'G', title: 'Building Sitework' },
  { id: 'Z', title: 'Unclassified' },
];

export const UNIFORMAT_CODES: Record<string, UniformatCodeDef> = {
  A1010: { code: 'A1010', title: 'Standard Foundations', group: 'A' },
  A1020: { code: 'A1020', title: 'Special Foundations', group: 'A' },
  A1030: { code: 'A1030', title: 'Slab on Grade', group: 'A' },
  A20: { code: 'A20', title: 'Basement Construction', group: 'A' },
  B10: { code: 'B10', title: 'Superstructure', group: 'B' },
  B1010: { code: 'B1010', title: 'Floor Construction', group: 'B' },
  B1020: { code: 'B1020', title: 'Roof Construction', group: 'B' },
  B2010: { code: 'B2010', title: 'Exterior Walls', group: 'B' },
  B2020: { code: 'B2020', title: 'Exterior Windows', group: 'B' },
  B2030: { code: 'B2030', title: 'Exterior Doors', group: 'B' },
  C1010: { code: 'C1010', title: 'Partitions', group: 'C' },
  C1020: { code: 'C1020', title: 'Interior Doors', group: 'C' },
  C2010: { code: 'C2010', title: 'Stair Construction', group: 'C' },
  C3010: { code: 'C3010', title: 'Wall Finishes', group: 'C' },
  C3020: { code: 'C3020', title: 'Floor Finishes', group: 'C' },
  C3030: { code: 'C3030', title: 'Ceiling Finishes', group: 'C' },
  D20: { code: 'D20', title: 'Plumbing', group: 'D' },
  D30: { code: 'D30', title: 'HVAC', group: 'D' },
  D50: { code: 'D50', title: 'Electrical', group: 'D' },
  G20: { code: 'G20', title: 'Site Improvements', group: 'G' },
  Z9990: { code: 'Z9990', title: 'Unclassified', group: 'Z' },
};

/** Fixed 1:1 element → UniFormat (no location). */
const FIXED_ELEMENT_CODES: Record<string, string> = {
  PAD_FOOTING: 'A1010',
  STRIP_FOOTING: 'A1010',
  STONE_STRIP: 'A1010',
  RAFT: 'A1010',
  PILE_CAP: 'A1020',
  PILES: 'A1020',
  COLUMNS: 'B10',
  BEAMS: 'B10',
  STAIRS: 'C2010',
  RAMPS: 'C2010',
  FLOOR_FINISH: 'C3020',
  CEILING_FINISH: 'C3030',
  EARTHWORKS: 'G20',
  PIPES: 'D20',
  DUCTS: 'D30',
  DUCT_FITTINGS: 'D30',
  ELECTRICAL: 'D50',
  // Fixtures → plumbing fixtures under D20 until a dedicated element exists
  FIXTURES: 'D20',
};

/** Elements that need a location field. */
export const LOCATION_DEPENDENT_ELEMENTS = new Set([
  'WALLS',
  'MASONRY',
  'SLABS',
  'DOORS_WINDOWS',
  'WALL_FINISH',
]);

export const LOCATION_OPTIONS: Record<string, UniformatLocation[]> = {
  WALLS: ['Below-grade', 'Exterior', 'Interior'],
  MASONRY: ['Below-grade', 'Exterior', 'Interior'],
  SLABS: ['On-grade', 'Elevated floor', 'Roof'],
  DOORS_WINDOWS: ['Exterior', 'Interior'],
  WALL_FINISH: ['Exterior', 'Interior'],
};

const WALL_LIKE_LOCATION_MAP: Record<string, string> = {
  'Below-grade': 'A20',
  Exterior: 'B2010',
  Interior: 'C1010',
};

const SLAB_LOCATION_MAP: Record<string, string> = {
  'On-grade': 'A1030',
  'Elevated floor': 'B1010',
  Roof: 'B1020',
};

const DOORS_WINDOWS_LOCATION_MAP: Record<string, string> = {
  Exterior: 'B2020',
  Interior: 'C1020',
};

const WALL_FINISH_LOCATION_MAP: Record<string, string> = {
  Exterior: 'B2010',
  Interior: 'C3010',
};

function isGroundFloorId(floorId: string): boolean {
  const id = floorId.trim().toUpperCase();
  return (
    id === 'FDN' ||
    id === 'GF' ||
    id === 'G' ||
    id === 'L00' ||
    id === '00' ||
    id.startsWith('FOUND') ||
    id.includes('GROUND')
  );
}

function isRoofFloorId(floorId: string): boolean {
  const id = floorId.trim().toUpperCase();
  return id === 'RF' || id === 'ROOF' || id.includes('ROOF');
}

/** Sensible default location; user may always override. */
export function defaultLocationForElement(
  elementKey: string,
  floorId: string,
): UniformatLocation | null {
  if (!LOCATION_DEPENDENT_ELEMENTS.has(elementKey)) return null;
  if (elementKey === 'SLABS') {
    if (isRoofFloorId(floorId)) return 'Roof';
    if (isGroundFloorId(floorId)) return 'On-grade';
    return 'Elevated floor';
  }
  if (
    elementKey === 'WALLS' ||
    elementKey === 'MASONRY' ||
    elementKey === 'DOORS_WINDOWS' ||
    elementKey === 'WALL_FINISH'
  ) {
    return 'Interior';
  }
  return null;
}

export function normalizeLocation(
  elementKey: string,
  location: string | null | undefined,
): UniformatLocation | null {
  if (location == null || location === '') return null;
  const opts = LOCATION_OPTIONS[elementKey];
  if (!opts) return null;
  const match = opts.find((o) => o.toLowerCase() === String(location).trim().toLowerCase());
  return match || null;
}

/**
 * Resolve UniFormat code for an element instance.
 * Uses location when required; falls back to defaultLocation then Unclassified.
 */
export function resolveUniformatCode(
  elementKey: string,
  opts?: {
    location?: string | null;
    floorId?: string;
  },
): { code: string; title: string; group: string; location: UniformatLocation | null } {
  const fixed = FIXED_ELEMENT_CODES[elementKey];
  if (fixed) {
    const def = UNIFORMAT_CODES[fixed];
    return { code: def.code, title: def.title, group: def.group, location: null };
  }

  if (LOCATION_DEPENDENT_ELEMENTS.has(elementKey)) {
    const floorId = opts?.floorId || '';
    const loc =
      normalizeLocation(elementKey, opts?.location) ||
      defaultLocationForElement(elementKey, floorId);

    let code: string | null = null;
    if (elementKey === 'WALLS' || elementKey === 'MASONRY') {
      code = loc ? WALL_LIKE_LOCATION_MAP[loc] || null : null;
    } else if (elementKey === 'SLABS') {
      code = loc ? SLAB_LOCATION_MAP[loc] || null : null;
    } else if (elementKey === 'DOORS_WINDOWS') {
      code = loc ? DOORS_WINDOWS_LOCATION_MAP[loc] || null : null;
    } else if (elementKey === 'WALL_FINISH') {
      code = loc ? WALL_FINISH_LOCATION_MAP[loc] || null : null;
    }

    if (code && UNIFORMAT_CODES[code]) {
      const def = UNIFORMAT_CODES[code];
      return {
        code: def.code,
        title: def.title,
        group: def.group,
        location: loc,
      };
    }
  }

  const unc = UNIFORMAT_CODES.Z9990;
  return {
    code: unc.code,
    title: unc.title,
    group: unc.group,
    location: normalizeLocation(elementKey, opts?.location),
  };
}

export function formatUniformatHeading(code: string): string {
  const def = UNIFORMAT_CODES[code] || UNIFORMAT_CODES.Z9990;
  return `${def.code} - ${def.title}`;
}

export function formatGroupHeading(groupId: string): string {
  const g = UNIFORMAT_GROUPS.find((x) => x.id === groupId);
  return g ? `${g.id} - ${g.title}` : groupId;
}

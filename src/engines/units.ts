/**
 * Display-unit conversion. Engines always compute in metric (m, m², m³).
 * Convert only at report/render time when the project uses imperial.
 */

export type UnitSystem = 'metric' | 'imperial';

/** Exact SI factors (US survey / international foot). */
export const M_TO_FT = 3.280839895;
export const M2_TO_FT2 = M_TO_FT * M_TO_FT;
/** 1 m³ ≈ 35.3147 ft³ — display tests expect 35.31 at 2 d.p. */
export const M3_TO_FT3 = M_TO_FT * M_TO_FT * M_TO_FT;

export function parseUnitSystem(units: string | null | undefined): UnitSystem {
  const s = String(units || '').toLowerCase();
  if (
    s === 'imperial' ||
    s.includes('imperial') ||
    s.includes('ft') ||
    s.includes('feet')
  ) {
    return 'imperial';
  }
  return 'metric';
}

export function unitSystemLabel(system: UnitSystem): string {
  return system === 'imperial' ? 'Imperial (ft, ft³)' : 'Metric (m, m³)';
}

export type ConvertedQuantity = {
  value: number;
  unit: string;
};

/**
 * Convert a metric quantity to the display system.
 * Non-geometric units (kg, t, L, bags, nos, day, …) pass through unchanged.
 */
export function convertQuantity(
  value: number,
  unit: string,
  system: UnitSystem,
): ConvertedQuantity {
  if (!Number.isFinite(value)) return { value, unit };
  if (system === 'metric') return { value, unit };

  const u = unit.trim();
  if (u === 'm³' || u === 'm3') {
    return { value: value * M3_TO_FT3, unit: 'ft³' };
  }
  if (u === 'm²' || u === 'm2') {
    return { value: value * M2_TO_FT2, unit: 'ft²' };
  }
  if (u === 'm') {
    return { value: value * M_TO_FT, unit: 'ft' };
  }
  return { value, unit };
}

/** Convert length stored in metres → display number. */
export function lengthToDisplay(metres: number, system: UnitSystem): number {
  return system === 'imperial' ? metres * M_TO_FT : metres;
}

/** Convert display length → metres for storage. */
export function lengthFromDisplay(display: number, system: UnitSystem): number {
  return system === 'imperial' ? display / M_TO_FT : display;
}

export function convertReportLineQty(
  qty: number | null | undefined,
  unit: string | null | undefined,
  system: UnitSystem,
): { qty: number | null | undefined; unit: string | null | undefined } {
  if (qty == null || unit == null) return { qty, unit };
  const c = convertQuantity(qty, unit, system);
  return { qty: c.value, unit: c.unit };
}

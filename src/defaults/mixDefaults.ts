/**
 * Spec §7.2 indicative concrete mixes (cement kg, sand/agg m³, water L per m³).
 * Used as factory defaults for project draft + applied mix tables.
 */
export type ConcreteMix = {
  cement: number;
  sand: number;
  agg: number;
  water: number;
};

/** Mortar BOM coefficients per m³ of mortar. */
export type MortarMix = {
  cementBagsPerM3: number;
  sandM3PerM3: number;
};

/**
 * Screed / plaster BOM coefficients per m³ of finished material
 * (cement kg + sand m³ — same dimensional style as concrete mixes).
 */
export type FinishWetMix = {
  cementKgPerM3: number;
  sandM3PerM3: number;
};

export const SPEC_CONCRETE_MIXES: Record<string, ConcreteMix> = {
  'C15/20': { cement: 220, sand: 0.52, agg: 0.9, water: 185 },
  'C16/20': { cement: 240, sand: 0.5, agg: 0.9, water: 180 },
  'C20/25': { cement: 280, sand: 0.48, agg: 0.87, water: 175 },
  'C25/30': { cement: 320, sand: 0.45, agg: 0.85, water: 170 },
  'C28/35': { cement: 340, sand: 0.44, agg: 0.84, water: 168 },
  'C30/37': { cement: 350, sand: 0.43, agg: 0.83, water: 166 },
  'C32/40': { cement: 360, sand: 0.43, agg: 0.83, water: 165 },
  'C35/45': { cement: 380, sand: 0.42, agg: 0.82, water: 163 },
  'C40/50': { cement: 400, sand: 0.41, agg: 0.8, water: 160 },
};

export const DEFAULT_MORTAR_MIX: MortarMix = {
  cementBagsPerM3: 7.2,
  sandM3PerM3: 1.0,
};

/**
 * Indicative cement:sand floor screed ~1:4 by volume (BS 8204-1 band 1:3–1:4.5).
 * Verify before procurement.
 */
export const DEFAULT_SCREED_MIX: FinishWetMix = {
  cementKgPerM3: 360,
  sandM3PerM3: 0.8,
};

/**
 * Indicative cement:sand plaster ~1:4–1:5 by volume.
 * Verify before procurement.
 */
export const DEFAULT_PLASTER_MIX: FinishWetMix = {
  cementKgPerM3: 280,
  sandM3PerM3: 1.0,
};

/**
 * Pre-fix finish BOM used mixFor('C20/25'). Seed applied_* to these so
 * existing projects do not silently change until revision bump.
 */
export const LEGACY_C20_FINISH_MIX: FinishWetMix = {
  cementKgPerM3: 280,
  sandM3PerM3: 0.48,
};

export function defaultMixForGrade(grade: string): ConcreteMix {
  if (SPEC_CONCRETE_MIXES[grade]) {
    return { ...SPEC_CONCRETE_MIXES[grade] };
  }
  const target = parseInt(String(grade).replace(/^C/, ''), 10);
  if (!Number.isNaN(target)) {
    let bestKey = 'C25/30';
    let bestDiff = Infinity;
    for (const k of Object.keys(SPEC_CONCRETE_MIXES)) {
      const v = parseInt(k.replace(/^C/, ''), 10);
      const d = Math.abs(v - target);
      if (d < bestDiff) {
        bestDiff = d;
        bestKey = k;
      }
    }
    return { ...SPEC_CONCRETE_MIXES[bestKey] };
  }
  return { ...SPEC_CONCRETE_MIXES['C25/30'] };
}

export function buildMixTable(grades: string[]): Record<string, ConcreteMix> {
  const out: Record<string, ConcreteMix> = {};
  for (const g of grades) {
    out[g] = defaultMixForGrade(g);
  }
  return out;
}

export function cloneMixTable(
  table: Record<string, ConcreteMix> | undefined | null,
): Record<string, ConcreteMix> {
  const out: Record<string, ConcreteMix> = {};
  if (!table) return out;
  for (const [k, v] of Object.entries(table)) {
    out[k] = {
      cement: Number(v.cement) || 0,
      sand: Number(v.sand) || 0,
      agg: Number(v.agg) || 0,
      water: Number(v.water) || 0,
    };
  }
  return out;
}

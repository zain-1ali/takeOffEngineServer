import { analyseRate, round } from '../../engines';
import type { RateLib } from '../../engines/rateAnalysis';
import { SPEC_CONCRETE_MIXES } from '../../defaults/mixDefaults';
import { DEFAULT_PRICING } from '../../defaults/projectDefaults';
import type { ProjectMaterials } from '../../models/Project';
import { mixFromMaterials } from '../materialsMix';

/** Spec reference table (also factory defaults for new projects). */
export const MIX_RATIOS = SPEC_CONCRETE_MIXES;

export const CEMENT_BAG_KG = 50;
export const PLY_SHEET_M2 = 2.44 * 1.22;
export const FORMWORK_WASTE = 0.15;
export const TIE_WIRE = 0.01;

export const LABOUR_RATES = {
  concrete: {
    label: 'Concrete placing (manual mix & pour)',
    perDay: 5,
    unit: 'm³',
    gang: [
      ['Concretor/Mason', 1],
      ['Labourer', 4],
    ] as [string, number][],
  },
  formwork: {
    label: 'Formwork fixing & striking',
    perDay: 8,
    unit: 'm²',
    gang: [
      ['Carpenter', 1],
      ['Labourer', 1],
    ] as [string, number][],
  },
  reinforcement: {
    label: 'Reinforcement cutting, bending & fixing',
    perDay: 200,
    unit: 'kg',
    gang: [
      ['Steel Fixer', 1],
      ['Labourer', 1],
    ] as [string, number][],
  },
};

export type PricingBook = typeof DEFAULT_PRICING;

/** Resolve mix for a grade from applied project mixes, falling back to spec table. */
export function mixFor(grade: string, materials?: ProjectMaterials | null) {
  return mixFromMaterials(grade, materials || null);
}

/** BOM pricing codes → rate-databank material codes (currency-convertible). */
const MAT_RATE_LIB_CODES: Record<string, string> = {
  formworkBracingKg: 'BRCG',
  formworkSoffitPropKg: 'SPROP',
  plywoodSheet: 'PLY',
  rebarKg: 'STL',
  tieWire: 'WIR',
  cementBag: 'CEM',
  sand: 'SND',
  aggregate: 'AGG',
  water: 'WAT',
};

export function makeRateAccessors(rateLib: RateLib, pricing: PricingBook = DEFAULT_PRICING, useRateAnalysis = true) {
  const boqRate = (code: string): number | null => {
    if (useRateAnalysis && rateLib?.analyses?.[code]) {
      const a = analyseRate(code, rateLib);
      if (a && a.rate > 0) return round(a.rate, 2);
    }
    const r = pricing.boq[code];
    return r != null && !isNaN(r) ? r : null;
  };
  const matRate = (code: string): number | null => {
    const libCode = MAT_RATE_LIB_CODES[code];
    if (libCode && rateLib?.materials?.length) {
      const row = rateLib.materials.find((m) => m.code === libCode);
      if (row && typeof row.rate === 'number' && !isNaN(row.rate)) {
        return row.rate;
      }
    }
    const r = pricing.materials[code];
    return r != null && !isNaN(r) ? r : null;
  };
  const labRate = (trade: string): number => {
    const r = pricing.labour[trade];
    return r != null && !isNaN(r) ? r : 0;
  };
  return { boqRate, matRate, labRate };
}

export type RateAccessors = ReturnType<typeof makeRateAccessors>;

export function lineAmount(qty: number, rate: number | null | undefined): number | null {
  if (rate == null || isNaN(rate) || rate <= 0 || isNaN(qty)) return null;
  // QS practice: price each line to 2 decimal places (matches client Cost Plan PDF).
  return round(qty * rate);
}

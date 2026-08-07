import { analyseRate, round } from '../../engines';
import type { RateLib } from '../../engines/rateAnalysis';
import { DEFAULT_PRICING } from '../../defaults/projectDefaults';

export const MIX_RATIOS: Record<string, { cement: number; sand: number; agg: number; water: number }> = {
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

export function mixFor(grade: string) {
  if (MIX_RATIOS[grade]) return MIX_RATIOS[grade];
  const target = parseInt(String(grade).replace(/^C/, ''), 10);
  if (!isNaN(target)) {
    let best = MIX_RATIOS['C25/30'];
    let bestDiff = Infinity;
    Object.keys(MIX_RATIOS).forEach((k) => {
      const v = parseInt(k.replace(/^C/, ''), 10);
      const d = Math.abs(v - target);
      if (d < bestDiff) {
        bestDiff = d;
        best = MIX_RATIOS[k];
      }
    });
    return best;
  }
  return MIX_RATIOS['C25/30'];
}

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
  return qty * rate;
}

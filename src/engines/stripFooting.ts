/**
 * Strip footing calculators — ported from AgileQS-Takeoff.html
 * (stripConcrete, stripRebar, calcStrip). Math unchanged.
 */
import { barCountForSpan, round, unitWeightKgPerM } from './math';
import type { BarSet, ConcreteResult, RebarGroup, StructuralCalcResult } from './types';

export type StripShape = 'FLAT' | 'TAPERED' | 'STEPPED';

export type StripFootingInput = {
  shape: StripShape;
  count?: number;
  length: number;
  width?: number;
  height?: number;
  baseWidth?: number;
  topWidth?: number;
  baseHeight?: number;
  upperWidth?: number;
  upperHeight?: number;
  cover: number;
  mainDia: number;
  mainSpacing: number;
  distDia: number;
  distSpacing: number;
  topMeshEnabled?: boolean;
  startersEnabled?: boolean;
  starterDia?: number;
  starterCount?: number;
  starterProjection?: number;
  starterEmbedment?: number;
};

export function stripBaseWidth(f: StripFootingInput): number {
  if (f.shape === 'FLAT') return f.width || 0;
  if (f.shape === 'TAPERED') return f.baseWidth || 0;
  return f.baseWidth || 0; // STEPPED
}

export function stripTotalHeight(f: StripFootingInput): number {
  if (f.shape === 'FLAT' || f.shape === 'TAPERED') return f.height || 0;
  return (f.baseHeight || 0) + (f.upperHeight || 0);
}

export function stripConcrete(f: StripFootingInput): ConcreteResult {
  if (f.shape === 'FLAT') {
    const L = f.length;
    const W = f.width || 0;
    const H = f.height || 0;
    return {
      netVolumeM3: round(L * W * H),
      formworkAreaM2: round(2 * L * H),
      breakdown: { sectionArea: round(W * H) },
    };
  }
  if (f.shape === 'TAPERED') {
    const L = f.length;
    const Wb = f.baseWidth || 0;
    const Wt = f.topWidth || 0;
    const H = f.height || 0;
    const crossArea = ((Wb + Wt) / 2) * H;
    const dW = (Wb - Wt) / 2;
    const slant = Math.sqrt(H * H + dW * dW);
    return {
      netVolumeM3: round(crossArea * L),
      formworkAreaM2: round(2 * L * slant),
      breakdown: { crossSectionArea: round(crossArea) },
    };
  }
  // STEPPED
  const L = f.length;
  const W1 = f.baseWidth || 0;
  const H1 = f.baseHeight || 0;
  const W2 = f.upperWidth || 0;
  const H2 = f.upperHeight || 0;
  const baseV = L * W1 * H1;
  const upperV = L * W2 * H2;
  return {
    netVolumeM3: round(baseV + upperV),
    formworkAreaM2: round(2 * L * H1 + 2 * L * H2),
    breakdown: { baseVolume: round(baseV), upperVolume: round(upperV) },
  };
}

export function stripRebar(f: StripFootingInput, netVolumeM3: number) {
  const c = f.cover / 1000;
  const L = f.length;
  const W = stripBaseWidth(f);
  const transCount = barCountForSpan(L - 2 * c, f.mainSpacing);
  const transLen = W - 2 * c;
  const transW = round(unitWeightKgPerM(f.mainDia) * transLen * transCount);
  const longCount = barCountForSpan(W - 2 * c, f.distSpacing);
  const longLen = L - 2 * c;
  const longW = round(unitWeightKgPerM(f.distDia) * longLen * longCount);

  const groups: RebarGroup[] = [
    { diameterMm: f.mainDia, weightKg: transW, role: 'Transverse (main)' },
    { diameterMm: f.distDia, weightKg: longW, role: 'Longitudinal (distribution)' },
  ];
  let topTransW = 0;
  let topLongW = 0;
  if (f.topMeshEnabled) {
    topTransW = transW;
    topLongW = longW;
    groups.push({ diameterMm: f.mainDia, weightKg: topTransW, role: 'Top transverse' });
    groups.push({ diameterMm: f.distDia, weightKg: topLongW, role: 'Top longitudinal' });
  }
  let starterBars: BarSet | null = null;
  if (f.startersEnabled) {
    const len = (f.starterProjection || 0) + (f.starterEmbedment || 0);
    const w = round(unitWeightKgPerM(f.starterDia || 0) * len * (f.starterCount || 0));
    starterBars = { diameterMm: f.starterDia || 0, barCount: f.starterCount || 0, weightKg: w };
    groups.push({ diameterMm: f.starterDia || 0, weightKg: w, role: 'Wall dowels' });
  }
  const totalWeightKg = round(groups.reduce((s, g) => s + g.weightKg, 0));
  return {
    transBars: { diameterMm: f.mainDia, barCount: transCount, weightKg: transW },
    longBars: { diameterMm: f.distDia, barCount: longCount, weightKg: longW },
    topMeshEnabled: !!f.topMeshEnabled,
    starterBars,
    groups,
    totalWeightKg,
    densityKgPerM3: netVolumeM3 > 0 ? round(totalWeightKg / netVolumeM3) : 0,
  };
}

export function calcStrip(f: StripFootingInput): StructuralCalcResult {
  const concrete = stripConcrete(f);
  const rebar = stripRebar(f, concrete.netVolumeM3);
  const n = f.count || 1;
  return {
    perUnit: { concrete, rebar },
    count: n,
    totalVolumeM3: round(concrete.netVolumeM3 * n),
    totalFormworkM2: round(concrete.formworkAreaM2 * n),
    totalRebarKg: round(rebar.totalWeightKg * n),
  };
}

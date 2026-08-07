import { round, unitWeightKgPerM } from './math';
import type { RebarGroup, StructuralCalcResult } from './types';

export type PileShape = 'CIRCULAR_BORED' | 'SQUARE_DRIVEN' | 'H_SECTION';

export type PileInput = {
  shape: PileShape;
  count?: number;
  pileLength: number;
  diameter?: number;
  side?: number;
  sectionDepth?: number;
  flangeWidth?: number;
  flangeThickness?: number;
  webThickness?: number;
  longBarCount: number;
  longBarDia: number;
  linkDia: number;
  linkKgPerM: number;
};

export function pileCrossSectionArea(f: PileInput): number {
  if (f.shape === 'CIRCULAR_BORED') {
    const diameter = f.diameter || 0;
    return (Math.PI * diameter * diameter) / 4;
  }
  if (f.shape === 'SQUARE_DRIVEN') {
    const side = f.side || 0;
    return side * side;
  }
  const depth = f.sectionDepth || 0;
  const flangeWidth = f.flangeWidth || 0;
  const flangeThickness = f.flangeThickness || 0;
  const webThickness = f.webThickness || 0;
  return (
    2 * flangeWidth * flangeThickness +
    webThickness * Math.max(0, depth - 2 * flangeThickness)
  );
}

export function pileRebar(f: PileInput, volumeM3: number) {
  const longitudinalWeightKg = round(
    f.longBarCount * f.pileLength * unitWeightKgPerM(f.longBarDia),
  );
  const linkWeightKg = round(f.linkKgPerM * f.pileLength);
  const groups: RebarGroup[] = [
    {
      diameterMm: f.longBarDia,
      weightKg: longitudinalWeightKg,
      role: 'Longitudinal cage',
    },
    {
      diameterMm: f.linkDia,
      weightKg: linkWeightKg,
      role: 'Helical/link allowance',
    },
  ];
  const totalWeightKg = round(longitudinalWeightKg + linkWeightKg);
  return {
    longitudinalWeightKg,
    linkWeightKg,
    groups,
    totalWeightKg,
    densityKgPerM3: volumeM3 > 0 ? round(totalWeightKg / volumeM3) : 0,
  };
}

export function calcPile(f: PileInput): StructuralCalcResult {
  const area = pileCrossSectionArea(f);
  const volume = round(area * f.pileLength);
  const concrete = {
    netVolumeM3: volume,
    formworkAreaM2: 0,
    breakdown: { crossSectionArea: round(area, 4) },
  };
  const rebar = pileRebar(f, volume);
  const n = f.count || 1;
  return {
    perUnit: { concrete, rebar },
    count: n,
    totalVolumeM3: round(volume * n),
    totalFormworkM2: 0,
    totalRebarKg: round(rebar.totalWeightKg * n),
  };
}

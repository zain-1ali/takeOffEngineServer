/**
 * Pile calculator.
 *
 * Circular-bored / Square-driven: reinforced concrete cages — bar-by-bar
 * longitudinal steel plus links at spacing (dia²/162).
 *
 * H-section: structural steel pile only — weight from section kg/m × length.
 * No concrete volume and no RC rebar cage.
 */
import { withVerticalFormworkOnly } from './formworkSplit';
import { barCountForSpan, round, unitWeightKgPerM } from './math';
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
  /** Rolled-section unit weight for H-section piles (kg/m). */
  sectionKgPerM?: number;
  longBarCount?: number;
  longBarDia?: number;
  linkDia?: number;
  linkSpacing?: number;
};

/** H-section steel area (m²) — geometry reference only; not used as concrete. */
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

export function pileLinkPerimeter(f: PileInput): number {
  if (f.shape === 'CIRCULAR_BORED') {
    return Math.PI * (f.diameter || 0);
  }
  if (f.shape === 'SQUARE_DRIVEN') {
    return 4 * (f.side || 0);
  }
  return 0;
}

export function pileRebar(f: PileInput, volumeM3: number) {
  if (f.shape === 'H_SECTION') {
    const steelWeightKg = round(
      (f.sectionKgPerM || 0) * f.pileLength,
    );
    const groups: RebarGroup[] = [
      {
        diameterMm: 0,
        weightKg: steelWeightKg,
        role: 'H-section steel pile',
      },
    ];
    return {
      longitudinalWeightKg: 0,
      linkWeightKg: 0,
      steelPileWeightKg: steelWeightKg,
      groups,
      totalWeightKg: steelWeightKg,
      densityKgPerM3: 0,
    };
  }

  const longBarCount = f.longBarCount || 0;
  const longBarDia = f.longBarDia || 0;
  const linkDia = f.linkDia || 0;
  const linkSpacing = f.linkSpacing || 0;
  const longitudinalWeightKg = round(
    longBarCount * f.pileLength * unitWeightKgPerM(longBarDia),
  );
  const linkCount = barCountForSpan(f.pileLength, linkSpacing);
  const linkPerimeterM = pileLinkPerimeter(f);
  const linkWeightKg = round(
    linkCount * linkPerimeterM * unitWeightKgPerM(linkDia),
  );
  const groups: RebarGroup[] = [
    {
      diameterMm: longBarDia,
      weightKg: longitudinalWeightKg,
      role: 'Longitudinal cage',
    },
    {
      diameterMm: linkDia,
      weightKg: linkWeightKg,
      role: 'Links/helical ties',
    },
  ];
  const totalWeightKg = round(longitudinalWeightKg + linkWeightKg);
  return {
    longitudinalWeightKg,
    linkWeightKg,
    linkCount,
    linkPerimeterM: round(linkPerimeterM, 4),
    groups,
    totalWeightKg,
    densityKgPerM3: volumeM3 > 0 ? round(totalWeightKg / volumeM3) : 0,
  };
}

export function calcPile(f: PileInput): StructuralCalcResult {
  const n = f.count || 1;

  if (f.shape === 'H_SECTION') {
    const rebar = pileRebar(f, 0);
    const concrete = {
      netVolumeM3: 0,
      formworkAreaM2: 0,
      breakdown: {
        sectionKgPerM: round(f.sectionKgPerM || 0, 4),
        steelAreaM2: round(pileCrossSectionArea(f), 6),
      },
    };
    return withVerticalFormworkOnly({
      perUnit: { concrete, rebar },
      count: n,
      volumeM3: 0,
      formworkM2: 0,
      rebarKg: rebar.totalWeightKg,
    });
  }

  const area = pileCrossSectionArea(f);
  const volume = round(area * f.pileLength);
  const concrete = {
    netVolumeM3: volume,
    formworkAreaM2: 0,
    breakdown: { crossSectionArea: round(area, 4) },
  };
  const rebar = pileRebar(f, volume);
  return withVerticalFormworkOnly({
    perUnit: { concrete, rebar },
    count: n,
    volumeM3: volume,
    formworkM2: 0,
    rebarKg: rebar.totalWeightKg,
  });
}

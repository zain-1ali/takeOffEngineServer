import { withVerticalFormworkOnly } from './formworkSplit';
import { barCountForSpan, round, unitWeightKgPerM } from './math';
import type {
  BarSet,
  ConcreteResult,
  RebarGroup,
  StructuralCalcResult,
} from './types';

export type ColumnShape =
  | 'RECTANGULAR'
  | 'CIRCULAR'
  | 'L_SHAPED'
  | 'T_SHAPED'
  | 'CRUCIFORM';

/** One longitudinal bar group (same diameter). */
export type LongBarGroup = {
  diameterMm: number;
  barCount: number;
};

export type ColumnInput = {
  shape: ColumnShape;
  count?: number;
  clearHeight: number;
  width?: number;
  depth?: number;
  diameter?: number;
  legThickness?: number;
  flangeWidth?: number;
  overallDepth?: number;
  flangeThickness?: number;
  webThickness?: number;
  armThickness?: number;
  /** Preferred: multiple diameter groups, e.g. 4×H16 + 4×H12. */
  longBars?: LongBarGroup[];
  /** Legacy single-group fields (used when longBars is absent/empty). */
  longBarCount?: number;
  longBarDia?: number;
  tieDia: number;
  tieSpacing: number;
};

export type ColumnSection = {
  areaM2: number;
  perimeterM: number;
};

/** Resolve longitudinal groups; prefer longBars, fall back to legacy scalars. */
export function resolveColumnLongBars(f: ColumnInput): LongBarGroup[] {
  if (Array.isArray(f.longBars) && f.longBars.length > 0) {
    return f.longBars
      .map((g) => ({
        diameterMm: Number(g.diameterMm) || 0,
        barCount: Number(g.barCount) || 0,
      }))
      .filter((g) => g.diameterMm > 0 && g.barCount > 0);
  }
  const dia = Number(f.longBarDia) || 0;
  const count = Number(f.longBarCount) || 0;
  if (dia > 0 && count > 0) return [{ diameterMm: dia, barCount: count }];
  return [];
}

export function columnSection(f: ColumnInput): ColumnSection {
  if (f.shape === 'CIRCULAR') {
    const diameter = f.diameter || 0;
    return {
      areaM2: (Math.PI * diameter * diameter) / 4,
      perimeterM: Math.PI * diameter,
    };
  }
  if (f.shape === 'L_SHAPED') {
    const width = f.width || 0;
    const depth = f.depth || 0;
    const thickness = f.legThickness || 0;
    return {
      areaM2:
        width * thickness + depth * thickness - thickness * thickness,
      perimeterM: 2 * (width + depth),
    };
  }
  if (f.shape === 'T_SHAPED') {
    const width = f.flangeWidth || 0;
    const depth = f.overallDepth || 0;
    const flangeThickness = f.flangeThickness || 0;
    const webThickness = f.webThickness || 0;
    return {
      areaM2:
        width * flangeThickness +
        webThickness * Math.max(0, depth - flangeThickness),
      perimeterM: 2 * (width + depth),
    };
  }
  if (f.shape === 'CRUCIFORM') {
    const width = f.width || 0;
    const depth = f.depth || 0;
    const thickness = f.armThickness || 0;
    return {
      areaM2:
        width * thickness + depth * thickness - thickness * thickness,
      perimeterM: 2 * (width + depth),
    };
  }
  const width = f.width || 0;
  const depth = f.depth || 0;
  return {
    areaM2: width * depth,
    perimeterM: 2 * (width + depth),
  };
}

export function columnConcrete(f: ColumnInput): ConcreteResult {
  const section = columnSection(f);
  return {
    netVolumeM3: round(section.areaM2 * f.clearHeight),
    formworkAreaM2: round(section.perimeterM * f.clearHeight),
    breakdown: {
      crossSectionArea: round(section.areaM2, 4),
      sectionPerimeter: round(section.perimeterM, 4),
    },
  };
}

export function columnRebar(f: ColumnInput, volumeM3: number) {
  const section = columnSection(f);
  const longBars = resolveColumnLongBars(f);

  const longitudinalSets: BarSet[] = [];
  const groups: RebarGroup[] = [];
  let longitudinalWeightKg = 0;

  for (const g of longBars) {
    const weightKg = round(
      g.barCount * f.clearHeight * unitWeightKgPerM(g.diameterMm),
    );
    longitudinalWeightKg = round(longitudinalWeightKg + weightKg);
    longitudinalSets.push({
      diameterMm: g.diameterMm,
      barCount: g.barCount,
      weightKg,
    });
    groups.push({
      diameterMm: g.diameterMm,
      weightKg,
      role: `Longitudinal bars Ø${g.diameterMm}`,
    });
  }

  const tieCount = barCountForSpan(f.clearHeight, f.tieSpacing);
  const tieWeightKg = round(
    tieCount * section.perimeterM * unitWeightKgPerM(f.tieDia),
  );
  groups.push({
    diameterMm: f.tieDia,
    weightKg: tieWeightKg,
    role: 'Transverse ties',
  });

  const totalWeightKg = round(longitudinalWeightKg + tieWeightKg);
  return {
    /** Multi-diameter longitudinal sets (preferred). */
    longitudinalBars: longitudinalSets,
    ties: {
      diameterMm: f.tieDia,
      barCount: tieCount,
      weightKg: tieWeightKg,
    },
    groups,
    totalWeightKg,
    densityKgPerM3: volumeM3 > 0 ? round(totalWeightKg / volumeM3) : 0,
  };
}

export function calcColumn(f: ColumnInput): StructuralCalcResult {
  const concrete = columnConcrete(f);
  const rebar = columnRebar(f, concrete.netVolumeM3);
  return withVerticalFormworkOnly({
    perUnit: { concrete, rebar },
    count: f.count || 1,
    volumeM3: concrete.netVolumeM3,
    formworkM2: concrete.formworkAreaM2,
    rebarKg: rebar.totalWeightKg,
  });
}

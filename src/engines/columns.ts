import { barCountForSpan, round, unitWeightKgPerM } from './math';
import type {
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
  longBarCount: number;
  longBarDia: number;
  tieDia: number;
  tieSpacing: number;
};

export type ColumnSection = {
  areaM2: number;
  perimeterM: number;
};

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
  const longitudinalWeightKg = round(
    f.longBarCount * f.clearHeight * unitWeightKgPerM(f.longBarDia),
  );
  const tieCount = barCountForSpan(f.clearHeight, f.tieSpacing);
  const tieWeightKg = round(
    tieCount * section.perimeterM * unitWeightKgPerM(f.tieDia),
  );
  const groups: RebarGroup[] = [
    {
      diameterMm: f.longBarDia,
      weightKg: longitudinalWeightKg,
      role: 'Longitudinal bars',
    },
    {
      diameterMm: f.tieDia,
      weightKg: tieWeightKg,
      role: 'Transverse ties',
    },
  ];
  const totalWeightKg = round(longitudinalWeightKg + tieWeightKg);
  return {
    longitudinalBars: {
      diameterMm: f.longBarDia,
      barCount: f.longBarCount,
      weightKg: longitudinalWeightKg,
    },
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
  const n = f.count || 1;
  return {
    perUnit: { concrete, rebar },
    count: n,
    totalVolumeM3: round(concrete.netVolumeM3 * n),
    totalFormworkM2: round(concrete.formworkAreaM2 * n),
    totalRebarKg: round(rebar.totalWeightKg * n),
  };
}

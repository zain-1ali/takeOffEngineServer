/**
 * Pile-cap calculator. Plan geometry drives concrete/formwork; reinforcement
 * follows the established two-way mesh plus starter-bar allowance pattern.
 */
import { round, unitWeightKgPerM } from './math';
import { twoWayMesh } from './padFooting';
import type {
  BarSet,
  ConcreteResult,
  RebarGroup,
  StructuralCalcResult,
} from './types';

export type PileCapShape =
  | 'RECTANGULAR'
  | 'TRIANGULAR'
  | 'HEXAGONAL'
  | 'TRAPEZOIDAL';

export type PileCapInput = {
  shape: PileCapShape;
  count?: number;
  thickness: number;
  length?: number;
  width?: number;
  triangleBase?: number;
  triangleHeight?: number;
  hexSide?: number;
  baseWidth?: number;
  topWidth?: number;
  cover: number;
  bottomMainDia: number;
  bottomMainSpacing: number;
  bottomDistDia: number;
  bottomDistSpacing: number;
  pileCount: number;
  starterBarsPerPile: number;
  starterDia: number;
  starterProjection: number;
  starterEmbedment: number;
};

export type PileCapPlan = {
  areaM2: number;
  perimeterM: number;
  meshLength: number;
  meshWidth: number;
};

export function pileCapPlan(f: PileCapInput): PileCapPlan {
  if (f.shape === 'TRIANGULAR') {
    const base = f.triangleBase || 0;
    const height = f.triangleHeight || 0;
    const side = Math.sqrt(height * height + (base / 2) * (base / 2));
    return {
      areaM2: (base * height) / 2,
      perimeterM: base + 2 * side,
      meshLength: base,
      meshWidth: height,
    };
  }
  if (f.shape === 'HEXAGONAL') {
    const side = f.hexSide || 0;
    return {
      areaM2: (3 * Math.sqrt(3) * side * side) / 2,
      perimeterM: 6 * side,
      meshLength: 2 * side,
      meshWidth: Math.sqrt(3) * side,
    };
  }
  if (f.shape === 'TRAPEZOIDAL') {
    const length = f.length || 0;
    const baseWidth = f.baseWidth || 0;
    const topWidth = f.topWidth || 0;
    const side = Math.sqrt(
      length * length + ((baseWidth - topWidth) / 2) ** 2,
    );
    return {
      areaM2: ((baseWidth + topWidth) / 2) * length,
      perimeterM: baseWidth + topWidth + 2 * side,
      meshLength: length,
      meshWidth: Math.max(baseWidth, topWidth),
    };
  }
  const length = f.length || 0;
  const width = f.width || 0;
  return {
    areaM2: length * width,
    perimeterM: 2 * (length + width),
    meshLength: length,
    meshWidth: width,
  };
}

export function pileCapConcrete(f: PileCapInput): ConcreteResult {
  const plan = pileCapPlan(f);
  return {
    netVolumeM3: round(plan.areaM2 * f.thickness),
    formworkAreaM2: round(plan.perimeterM * f.thickness),
    breakdown: { planArea: round(plan.areaM2) },
  };
}

export function pileCapRebar(f: PileCapInput, netVolumeM3: number) {
  const plan = pileCapPlan(f);
  const bottomMesh = twoWayMesh(
    plan.meshLength,
    plan.meshWidth,
    f.cover,
    f.bottomMainDia,
    f.bottomMainSpacing,
    f.bottomDistDia,
    f.bottomDistSpacing,
  );
  const starterLength = f.starterProjection + f.starterEmbedment;
  const starterCount = f.pileCount * f.starterBarsPerPile;
  const starterBars: BarSet = {
    diameterMm: f.starterDia,
    barCount: starterCount,
    weightKg: round(
      unitWeightKgPerM(f.starterDia) * starterLength * starterCount,
    ),
  };
  const groups: RebarGroup[] = [
    {
      diameterMm: bottomMesh.mainBars.diameterMm,
      weightKg: bottomMesh.mainBars.weightKg,
      role: 'Bottom main',
    },
    {
      diameterMm: bottomMesh.distBars.diameterMm,
      weightKg: bottomMesh.distBars.weightKg,
      role: 'Bottom distribution',
    },
    {
      diameterMm: starterBars.diameterMm,
      weightKg: starterBars.weightKg,
      role: 'Pile starter bars',
    },
  ];
  const totalWeightKg = round(
    bottomMesh.totalWeightKg + starterBars.weightKg,
  );

  return {
    bottomMesh,
    starterBars,
    groups,
    totalWeightKg,
    densityKgPerM3: netVolumeM3 > 0 ? round(totalWeightKg / netVolumeM3) : 0,
  };
}

export function calcPileCap(f: PileCapInput): StructuralCalcResult {
  const concrete = pileCapConcrete(f);
  const rebar = pileCapRebar(f, concrete.netVolumeM3);
  const n = f.count || 1;
  return {
    perUnit: { concrete, rebar },
    count: n,
    totalVolumeM3: round(concrete.netVolumeM3 * n),
    totalFormworkM2: round(concrete.formworkAreaM2 * n),
    totalRebarKg: round(rebar.totalWeightKg * n),
  };
}

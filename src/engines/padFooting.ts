/**
 * Pad footing calculators — ported from AgileQS-Takeoff.html
 * (padConcrete, twoWayMesh, padRebar, calcFooting). Math unchanged.
 */
import { withVerticalFormworkOnly } from './formworkSplit';
import { barCountForSpan, round, unitWeightKgPerM } from './math';
import type { BarSet, ConcreteResult, RebarGroup, StructuralCalcResult } from './types';

export type PadShape = 'RECTANGULAR' | 'STEPPED' | 'SLOPED_PYRAMIDAL';

export type PadFootingInput = {
  shape: PadShape;
  count?: number;
  length: number;
  width: number;
  baseThickness: number;
  stepLength?: number;
  stepWidth?: number;
  stepHeight?: number;
  slopePeakLength?: number;
  slopePeakWidth?: number;
  slopeHeight?: number;
  cover: number;
  bottomMainDia: number;
  bottomMainSpacing: number;
  bottomDistDia: number;
  bottomDistSpacing: number;
  topMeshEnabled?: boolean;
  startersEnabled?: boolean;
  starterDia?: number;
  starterCount?: number;
  starterProjection?: number;
  starterEmbedment?: number;
};

export type MeshResult = {
  mainBars: BarSet;
  distBars: BarSet;
  totalWeightKg: number;
};

export function padConcrete(f: PadFootingInput): ConcreteResult {
  if (f.shape === 'RECTANGULAR') {
    const { length: L, width: W, baseThickness: Z1 } = f;
    return {
      netVolumeM3: round(L * W * Z1),
      formworkAreaM2: round(2 * (L * Z1) + 2 * (W * Z1)),
      breakdown: { baseBlockVolume: round(L * W * Z1) },
    };
  }
  if (f.shape === 'STEPPED') {
    const { length: L, width: W, baseThickness: Z1, stepLength: Ls = 0, stepWidth: Ws = 0, stepHeight: Z2 = 0 } = f;
    const baseV = L * W * Z1;
    const stepV = Ls * Ws * Z2;
    return {
      netVolumeM3: round(baseV + stepV),
      formworkAreaM2: round(2 * (L + W) * Z1 + 2 * (Ls + Ws) * Z2),
      breakdown: { baseBlockVolume: round(baseV), stepBlockVolume: round(stepV) },
    };
  }
  // SLOPED_PYRAMIDAL
  const {
    length: L,
    width: W,
    baseThickness: Z1,
    slopePeakLength: Lp = 0,
    slopePeakWidth: Wp = 0,
    slopeHeight: Z2 = 0,
  } = f;
  const baseArea = L * W;
  const topArea = Lp * Wp;
  const frustumV = (Z2 / 3) * (baseArea + topArea + Math.sqrt(baseArea * topArea));
  const baseV = Z1 > 0 ? L * W * Z1 : 0;
  const dW = (W - Wp) / 2;
  const dL = (L - Lp) / 2;
  const slantL = Math.sqrt(Z2 * Z2 + dW * dW);
  const slantW = Math.sqrt(Z2 * Z2 + dL * dL);
  const frustumFw = 2 * (((L + Lp) / 2) * slantL) + 2 * (((W + Wp) / 2) * slantW);
  const baseFw = Z1 > 0 ? 2 * (L + W) * Z1 : 0;
  return {
    netVolumeM3: round(frustumV + baseV),
    formworkAreaM2: round(frustumFw + baseFw),
    breakdown: { frustumVolume: round(frustumV), baseBlockVolume: round(baseV) },
  };
}

export function padTotalHeight(f: PadFootingInput): number {
  if (f.shape === 'RECTANGULAR') return f.baseThickness;
  if (f.shape === 'STEPPED') return f.baseThickness + (f.stepHeight || 0);
  return f.baseThickness + (f.slopeHeight || 0);
}

export function twoWayMesh(
  L: number,
  W: number,
  cover: number,
  mainDia: number,
  mainSpc: number,
  distDia: number,
  distSpc: number,
): MeshResult {
  const c = cover / 1000;
  const mainLen = L - 2 * c;
  const mainCount = barCountForSpan(W - 2 * c, mainSpc);
  const mainW = round(unitWeightKgPerM(mainDia) * mainLen * mainCount);
  const distLen = W - 2 * c;
  const distCount = barCountForSpan(L - 2 * c, distSpc);
  const distW = round(unitWeightKgPerM(distDia) * distLen * distCount);
  return {
    mainBars: { diameterMm: mainDia, barCount: mainCount, weightKg: mainW },
    distBars: { diameterMm: distDia, barCount: distCount, weightKg: distW },
    totalWeightKg: round(mainW + distW),
  };
}

export function padRebar(f: PadFootingInput, netVolumeM3: number) {
  const { length: L, width: W } = f;
  const bottomMesh = twoWayMesh(
    L,
    W,
    f.cover,
    f.bottomMainDia,
    f.bottomMainSpacing,
    f.bottomDistDia,
    f.bottomDistSpacing,
  );
  let topMesh: MeshResult | null = null;
  if (f.topMeshEnabled) {
    topMesh = twoWayMesh(
      L,
      W,
      f.cover,
      f.bottomMainDia,
      f.bottomMainSpacing,
      f.bottomDistDia,
      f.bottomDistSpacing,
    );
  }
  let starterBars: BarSet | null = null;
  if (f.startersEnabled) {
    const len = (f.starterProjection || 0) + (f.starterEmbedment || 0);
    starterBars = {
      diameterMm: f.starterDia || 0,
      barCount: f.starterCount || 0,
      weightKg: round(unitWeightKgPerM(f.starterDia || 0) * len * (f.starterCount || 0)),
    };
  }
  const totalWeightKg = round(
    bottomMesh.totalWeightKg +
      (topMesh ? topMesh.totalWeightKg : 0) +
      (starterBars ? starterBars.weightKg : 0),
  );
  const groups: RebarGroup[] = [
    { diameterMm: bottomMesh.mainBars.diameterMm, weightKg: bottomMesh.mainBars.weightKg, role: 'Bottom main' },
    {
      diameterMm: bottomMesh.distBars.diameterMm,
      weightKg: bottomMesh.distBars.weightKg,
      role: 'Bottom distribution',
    },
  ];
  if (topMesh) {
    groups.push({ diameterMm: topMesh.mainBars.diameterMm, weightKg: topMesh.mainBars.weightKg, role: 'Top main' });
    groups.push({
      diameterMm: topMesh.distBars.diameterMm,
      weightKg: topMesh.distBars.weightKg,
      role: 'Top distribution',
    });
  }
  if (starterBars) {
    groups.push({ diameterMm: starterBars.diameterMm, weightKg: starterBars.weightKg, role: 'Starter bars' });
  }
  return {
    bottomMesh,
    topMesh,
    starterBars,
    groups,
    totalWeightKg,
    densityKgPerM3: netVolumeM3 > 0 ? round(totalWeightKg / netVolumeM3) : 0,
  };
}

export function calcFooting(f: PadFootingInput): StructuralCalcResult {
  const concrete = padConcrete(f);
  const rebar = padRebar(f, concrete.netVolumeM3);
  return withVerticalFormworkOnly({
    perUnit: { concrete, rebar },
    count: f.count || 1,
    volumeM3: concrete.netVolumeM3,
    formworkM2: concrete.formworkAreaM2,
    rebarKg: rebar.totalWeightKg,
  });
}

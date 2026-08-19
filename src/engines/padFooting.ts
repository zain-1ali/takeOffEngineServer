/**
 * Pad footing calculators — ported from AgileQS-Takeoff.html
 * (padConcrete, twoWayMesh, padRebar, calcFooting). Math unchanged.
 */
import { withVerticalFormworkOnly } from './formworkSplit';
import { barCountForSpan, round, unitWeightKgPerM } from './math';
import type { BarSet, ConcreteResult, RebarGroup, StructuralCalcResult } from './types';

export type PadShape = 'RECTANGULAR' | 'STEPPED' | 'SLOPED_PYRAMIDAL';

/** One mesh direction entry: bar dia + spacing (count = floor(span/spc)+1). */
export type MeshBarGroup = {
  diameterMm: number;
  spacingMm: number;
};

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
  /** Preferred: multi {dia, spacing} per direction. */
  bottomMainBars?: MeshBarGroup[];
  bottomDistBars?: MeshBarGroup[];
  topMainBars?: MeshBarGroup[];
  topDistBars?: MeshBarGroup[];
  /** Legacy single-group fields. */
  bottomMainDia?: number;
  bottomMainSpacing?: number;
  bottomDistDia?: number;
  bottomDistSpacing?: number;
  topMainDia?: number;
  topMainSpacing?: number;
  topDistDia?: number;
  topDistSpacing?: number;
  topMeshEnabled?: boolean;
  startersEnabled?: boolean;
  starterDia?: number;
  starterCount?: number;
  starterProjection?: number;
  starterEmbedment?: number;
};

export type MeshResult = {
  /** First main set (legacy consumers). */
  mainBars: BarSet;
  distBars: BarSet;
  mainSets: BarSet[];
  distSets: BarSet[];
  totalWeightKg: number;
};

export function resolveMeshBarGroups(
  groups: MeshBarGroup[] | undefined,
  legacyDia: number | undefined,
  legacySpc: number | undefined,
): MeshBarGroup[] {
  if (Array.isArray(groups) && groups.length > 0) {
    return groups
      .map((g) => ({
        diameterMm: Number(g.diameterMm) || 0,
        spacingMm: Number(g.spacingMm) || 0,
      }))
      .filter((g) => g.diameterMm > 0 && g.spacingMm > 0);
  }
  const dia = Number(legacyDia) || 0;
  const spc = Number(legacySpc) || 0;
  if (dia > 0 && spc > 0) return [{ diameterMm: dia, spacingMm: spc }];
  return [];
}

function directionSets(
  barLengthM: number,
  countSpanM: number,
  groups: MeshBarGroup[],
): { sets: BarSet[]; weightKg: number } {
  const sets: BarSet[] = [];
  let weightKg = 0;
  for (const g of groups) {
    const barCount = barCountForSpan(countSpanM, g.spacingMm);
    const w = round(unitWeightKgPerM(g.diameterMm) * barLengthM * barCount);
    weightKg = round(weightKg + w);
    sets.push({ diameterMm: g.diameterMm, barCount, weightKg: w });
  }
  return { sets, weightKg };
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
  return twoWayMeshFromGroups(
    L,
    W,
    cover,
    [{ diameterMm: mainDia, spacingMm: mainSpc }],
    [{ diameterMm: distDia, spacingMm: distSpc }],
  );
}

export function twoWayMeshFromGroups(
  L: number,
  W: number,
  cover: number,
  mainGroups: MeshBarGroup[],
  distGroups: MeshBarGroup[],
): MeshResult {
  const c = cover / 1000;
  const mainLen = L - 2 * c;
  const distLen = W - 2 * c;
  const countSpanMain = W - 2 * c;
  const countSpanDist = L - 2 * c;
  const main = directionSets(mainLen, countSpanMain, mainGroups);
  const dist = directionSets(distLen, countSpanDist, distGroups);
  const empty: BarSet = { diameterMm: 0, barCount: 0, weightKg: 0 };
  return {
    mainBars: main.sets[0] || empty,
    distBars: dist.sets[0] || empty,
    mainSets: main.sets,
    distSets: dist.sets,
    totalWeightKg: round(main.weightKg + dist.weightKg),
  };
}

function pushMeshGroups(
  out: RebarGroup[],
  mesh: MeshResult,
  mainRole: string,
  distRole: string,
) {
  for (const s of mesh.mainSets) {
    out.push({
      diameterMm: s.diameterMm,
      weightKg: s.weightKg,
      role: mesh.mainSets.length > 1 ? `${mainRole} Ø${s.diameterMm}` : mainRole,
    });
  }
  for (const s of mesh.distSets) {
    out.push({
      diameterMm: s.diameterMm,
      weightKg: s.weightKg,
      role: mesh.distSets.length > 1 ? `${distRole} Ø${s.diameterMm}` : distRole,
    });
  }
}

export function resolveLayerMesh(
  L: number,
  W: number,
  cover: number,
  mainGroups: MeshBarGroup[] | undefined,
  distGroups: MeshBarGroup[] | undefined,
  mainDia: number | undefined,
  mainSpc: number | undefined,
  distDia: number | undefined,
  distSpc: number | undefined,
  /** Fallback layer when this layer has no specs (e.g. top copies bottom). */
  fallback?: MeshResult | null,
): MeshResult | null {
  const main = resolveMeshBarGroups(mainGroups, mainDia, mainSpc);
  const dist = resolveMeshBarGroups(distGroups, distDia, distSpc);
  if (main.length > 0 && dist.length > 0) {
    return twoWayMeshFromGroups(L, W, cover, main, dist);
  }
  if (fallback) return fallback;
  if (main.length > 0 || dist.length > 0) {
    // Partial: fill missing direction from the other or empty
    const m = main.length > 0 ? main : dist;
    const d = dist.length > 0 ? dist : main;
    return twoWayMeshFromGroups(L, W, cover, m, d);
  }
  return null;
}


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

export function padRebar(f: PadFootingInput, netVolumeM3: number) {
  const { length: L, width: W } = f;
  const bottomMesh =
    resolveLayerMesh(
      L,
      W,
      f.cover,
      f.bottomMainBars,
      f.bottomDistBars,
      f.bottomMainDia,
      f.bottomMainSpacing,
      f.bottomDistDia,
      f.bottomDistSpacing,
    ) ||
    twoWayMesh(L, W, f.cover, 16, 150, 16, 150);

  let topMesh: MeshResult | null = null;
  if (f.topMeshEnabled) {
    topMesh = resolveLayerMesh(
      L,
      W,
      f.cover,
      f.topMainBars,
      f.topDistBars,
      f.topMainDia,
      f.topMainSpacing,
      f.topDistDia,
      f.topDistSpacing,
      bottomMesh,
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
  const groups: RebarGroup[] = [];
  pushMeshGroups(groups, bottomMesh, 'Bottom main', 'Bottom distribution');
  if (topMesh) {
    pushMeshGroups(groups, topMesh, 'Top main', 'Top distribution');
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

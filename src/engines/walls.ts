/**
 * RC wall calculators — ported from AgileQS-Takeoff.html
 * (wallConcrete, wallRebar, calcWall). Math unchanged.
 */
import { barCountForSpan, round, unitWeightKgPerM } from './math';
import type { BarSet, ConcreteResult, RebarGroup, StructuralCalcResult } from './types';

export type WallShape = 'LINEAR' | 'CURVED';

export type WallInput = {
  shape: WallShape;
  count?: number;
  length?: number;
  radius?: number;
  arcAngleDeg?: number;
  thickness: number;
  height: number;
  cover: number;
  vertDia: number;
  vertSpacing: number;
  horizDia: number;
  horizSpacing: number;
  bothFaces?: boolean;
  startersEnabled?: boolean;
  starterDia?: number;
  starterCount?: number;
  starterProjection?: number;
  starterEmbedment?: number;
};

export function wallCenterlineLength(f: WallInput): number {
  if (f.shape === 'LINEAR') return f.length || 0;
  return (f.radius || 0) * (((f.arcAngleDeg || 0) * Math.PI) / 180);
}

export function wallTotalHeight(f: WallInput): number {
  return f.height;
}

export function wallConcrete(f: WallInput): ConcreteResult {
  const cl = wallCenterlineLength(f);
  const { thickness: T, height: H } = f;
  const volume = cl * T * H;
  const formwork = cl * H * 2; // both faces
  return {
    netVolumeM3: round(volume),
    formworkAreaM2: round(formwork),
    breakdown: { centerlineLength: round(cl), clearHeight: round(H) },
  };
}

export function wallRebar(f: WallInput, netVolumeM3: number) {
  const c = f.cover / 1000;
  const cl = wallCenterlineLength(f);
  const H = f.height;
  const faces = f.bothFaces ? 2 : 1;

  const vertCount = barCountForSpan(cl - 2 * c, f.vertSpacing) * faces;
  const vertLen = H - 2 * c + 0.3; // + nominal lap/kicker allowance
  const vertW = round(unitWeightKgPerM(f.vertDia) * vertLen * vertCount);

  const horizCount = barCountForSpan(H - 2 * c, f.horizSpacing) * faces;
  const horizLen = cl - 2 * c;
  const horizW = round(unitWeightKgPerM(f.horizDia) * horizLen * horizCount);

  const groups: RebarGroup[] = [
    { diameterMm: f.vertDia, weightKg: vertW, role: 'Vertical' },
    { diameterMm: f.horizDia, weightKg: horizW, role: 'Horizontal' },
  ];
  let starterBars: BarSet | null = null;
  if (f.startersEnabled) {
    const len = (f.starterProjection || 0) + (f.starterEmbedment || 0);
    const w = round(unitWeightKgPerM(f.starterDia || 0) * len * (f.starterCount || 0));
    starterBars = { diameterMm: f.starterDia || 0, barCount: f.starterCount || 0, weightKg: w };
    groups.push({ diameterMm: f.starterDia || 0, weightKg: w, role: 'Starter/kicker dowels' });
  }
  const totalWeightKg = round(groups.reduce((s, g) => s + g.weightKg, 0));
  return {
    vertBars: { diameterMm: f.vertDia, barCount: vertCount, weightKg: vertW },
    horizBars: { diameterMm: f.horizDia, barCount: horizCount, weightKg: horizW },
    starterBars,
    groups,
    totalWeightKg,
    densityKgPerM3: netVolumeM3 > 0 ? round(totalWeightKg / netVolumeM3) : 0,
  };
}

export function calcWall(f: WallInput): StructuralCalcResult {
  const concrete = wallConcrete(f);
  const rebar = wallRebar(f, concrete.netVolumeM3);
  const n = f.count || 1;
  return {
    perUnit: { concrete, rebar },
    count: n,
    totalVolumeM3: round(concrete.netVolumeM3 * n),
    totalFormworkM2: round(concrete.formworkAreaM2 * n),
    totalRebarKg: round(rebar.totalWeightKg * n),
  };
}

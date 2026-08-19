/**
 * RC wall calculators — ported from AgileQS-Takeoff.html
 * (wallConcrete, wallRebar, calcWall). Math unchanged.
 */
import { withVerticalFormworkOnly } from './formworkSplit';
import { barCountForSpan, round, unitWeightKgPerM } from './math';
import {
  resolveMeshBarGroups,
  type MeshBarGroup,
} from './padFooting';
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
  /** Preferred: multi {dia, spacing} per direction. */
  vertBars?: MeshBarGroup[];
  horizBars?: MeshBarGroup[];
  /** Legacy single-group fields. */
  vertDia?: number;
  vertSpacing?: number;
  horizDia?: number;
  horizSpacing?: number;
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

  const vertGroups = resolveMeshBarGroups(f.vertBars, f.vertDia, f.vertSpacing);
  const horizGroups = resolveMeshBarGroups(
    f.horizBars,
    f.horizDia,
    f.horizSpacing,
  );
  const verts =
    vertGroups.length > 0 ? vertGroups : [{ diameterMm: 12, spacingMm: 200 }];
  const horizs =
    horizGroups.length > 0 ? horizGroups : [{ diameterMm: 12, spacingMm: 250 }];

  const vertSets: BarSet[] = [];
  const horizSets: BarSet[] = [];
  const groups: RebarGroup[] = [];
  let vertWTotal = 0;
  let horizWTotal = 0;

  // Vertical: count along centerline, length = height − 2×cover + 0.3 lap
  const vertLen = H - 2 * c + 0.3;
  for (const g of verts) {
    const barCount = barCountForSpan(cl - 2 * c, g.spacingMm) * faces;
    const weightKg = round(unitWeightKgPerM(g.diameterMm) * vertLen * barCount);
    vertWTotal = round(vertWTotal + weightKg);
    vertSets.push({ diameterMm: g.diameterMm, barCount, weightKg });
    groups.push({
      diameterMm: g.diameterMm,
      weightKg,
      role: verts.length > 1 ? `Vertical Ø${g.diameterMm}` : 'Vertical',
    });
  }

  // Horizontal: count up the height, length = centerline − 2×cover
  const horizLen = cl - 2 * c;
  for (const g of horizs) {
    const barCount = barCountForSpan(H - 2 * c, g.spacingMm) * faces;
    const weightKg = round(unitWeightKgPerM(g.diameterMm) * horizLen * barCount);
    horizWTotal = round(horizWTotal + weightKg);
    horizSets.push({ diameterMm: g.diameterMm, barCount, weightKg });
    groups.push({
      diameterMm: g.diameterMm,
      weightKg,
      role: horizs.length > 1 ? `Horizontal Ø${g.diameterMm}` : 'Horizontal',
    });
  }

  let starterBars: BarSet | null = null;
  if (f.startersEnabled) {
    const len = (f.starterProjection || 0) + (f.starterEmbedment || 0);
    const w = round(unitWeightKgPerM(f.starterDia || 0) * len * (f.starterCount || 0));
    starterBars = { diameterMm: f.starterDia || 0, barCount: f.starterCount || 0, weightKg: w };
    groups.push({ diameterMm: f.starterDia || 0, weightKg: w, role: 'Starter/kicker dowels' });
  }
  const totalWeightKg = round(groups.reduce((s, g) => s + g.weightKg, 0));
  return {
    vertBars: vertSets[0] || { diameterMm: 0, barCount: 0, weightKg: 0 },
    horizBars: horizSets[0] || { diameterMm: 0, barCount: 0, weightKg: 0 },
    vertSets,
    horizSets,
    starterBars,
    groups,
    totalWeightKg,
    densityKgPerM3: netVolumeM3 > 0 ? round(totalWeightKg / netVolumeM3) : 0,
  };
}

export function calcWall(f: WallInput): StructuralCalcResult {
  const concrete = wallConcrete(f);
  const rebar = wallRebar(f, concrete.netVolumeM3);
  return withVerticalFormworkOnly({
    perUnit: { concrete, rebar },
    count: f.count || 1,
    volumeM3: concrete.netVolumeM3,
    formworkM2: concrete.formworkAreaM2,
    rebarKg: rebar.totalWeightKg,
  });
}

/**
 * Strip footing calculators — ported from AgileQS-Takeoff.html
 * (stripConcrete, stripRebar, calcStrip). Math unchanged.
 */
import { withVerticalFormworkOnly } from './formworkSplit';
import { barCountForSpan, round, unitWeightKgPerM } from './math';
import {
  resolveMeshBarGroups,
  type MeshBarGroup,
} from './padFooting';
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
  /** Transverse (main) / longitudinal (dist) — preferred arrays. */
  mainBars?: MeshBarGroup[];
  distBars?: MeshBarGroup[];
  topMainBars?: MeshBarGroup[];
  topDistBars?: MeshBarGroup[];
  mainDia?: number;
  mainSpacing?: number;
  distDia?: number;
  distSpacing?: number;
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

function stripDirectionWeight(
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

export function stripRebar(f: StripFootingInput, netVolumeM3: number) {
  const c = f.cover / 1000;
  const L = f.length;
  const W = stripBaseWidth(f);
  const mainGroups = resolveMeshBarGroups(f.mainBars, f.mainDia, f.mainSpacing);
  const distGroups = resolveMeshBarGroups(f.distBars, f.distDia, f.distSpacing);
  const main =
    mainGroups.length > 0
      ? mainGroups
      : [{ diameterMm: 12, spacingMm: 150 }];
  const dist =
    distGroups.length > 0
      ? distGroups
      : [{ diameterMm: 12, spacingMm: 250 }];

  // Transverse (main): bars across width, counted along length
  const trans = stripDirectionWeight(W - 2 * c, L - 2 * c, main);
  // Longitudinal (dist): bars along length, counted across width
  const long = stripDirectionWeight(L - 2 * c, W - 2 * c, dist);

  const groups: RebarGroup[] = [];
  for (const s of trans.sets) {
    groups.push({
      diameterMm: s.diameterMm,
      weightKg: s.weightKg,
      role:
        trans.sets.length > 1
          ? `Transverse (main) Ø${s.diameterMm}`
          : 'Transverse (main)',
    });
  }
  for (const s of long.sets) {
    groups.push({
      diameterMm: s.diameterMm,
      weightKg: s.weightKg,
      role:
        long.sets.length > 1
          ? `Longitudinal (distribution) Ø${s.diameterMm}`
          : 'Longitudinal (distribution)',
    });
  }

  if (f.topMeshEnabled) {
    const topMain = resolveMeshBarGroups(
      f.topMainBars,
      f.topMainDia,
      f.topMainSpacing,
    );
    const topDist = resolveMeshBarGroups(
      f.topDistBars,
      f.topDistDia,
      f.topDistSpacing,
    );
    const tm = topMain.length > 0 ? topMain : main;
    const td = topDist.length > 0 ? topDist : dist;
    const topTrans = stripDirectionWeight(W - 2 * c, L - 2 * c, tm);
    const topLong = stripDirectionWeight(L - 2 * c, W - 2 * c, td);
    for (const s of topTrans.sets) {
      groups.push({
        diameterMm: s.diameterMm,
        weightKg: s.weightKg,
        role:
          topTrans.sets.length > 1
            ? `Top transverse Ø${s.diameterMm}`
            : 'Top transverse',
      });
    }
    for (const s of topLong.sets) {
      groups.push({
        diameterMm: s.diameterMm,
        weightKg: s.weightKg,
        role:
          topLong.sets.length > 1
            ? `Top longitudinal Ø${s.diameterMm}`
            : 'Top longitudinal',
      });
    }
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
    transBars: trans.sets[0] || { diameterMm: 0, barCount: 0, weightKg: 0 },
    longBars: long.sets[0] || { diameterMm: 0, barCount: 0, weightKg: 0 },
    transSets: trans.sets,
    longSets: long.sets,
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
  return withVerticalFormworkOnly({
    perUnit: { concrete, rebar },
    count: f.count || 1,
    volumeM3: concrete.netVolumeM3,
    formworkM2: concrete.formworkAreaM2,
    rebarKg: rebar.totalWeightKg,
  });
}

/**
 * Lintels — PRECAST or INSITU.
 * Length = clearSpan + 2×bearingEach (or length override);
 * volume = L×W×D; INSITU adds formwork + light beam rebar.
 */
import { beamRebar, type BeamInput } from './beams';
import { withFormworkSplit } from './formworkSplit';
import { round } from './math';
import type { ConcreteResult, RebarGroup, StructuralCalcResult } from './types';

export type LintelShape = 'PRECAST' | 'INSITU';

export type LintelInput = {
  shape: LintelShape;
  count?: number;
  clearSpan?: number;
  bearingEach?: number;
  /** When set, wins over clearSpan + 2×bearing. */
  length?: number | null;
  width?: number;
  depth?: number;
  cover?: number;
  topBars?: { diameterMm: number; barCount: number }[];
  bottomBars?: { diameterMm: number; barCount: number }[];
  topBarCount?: number;
  topBarDia?: number;
  bottomBarCount?: number;
  bottomBarDia?: number;
  linkDia?: number;
  linkSpacing?: number;
};

export function lintelLengthM(f: LintelInput): number {
  if (f.length != null && Number.isFinite(Number(f.length)) && Number(f.length) > 0) {
    return Number(f.length);
  }
  const clear = f.clearSpan || 0;
  const bearing = f.bearingEach != null ? f.bearingEach : 0.15;
  return clear + 2 * bearing;
}

export function lintelConcrete(f: LintelInput): ConcreteResult {
  const length = lintelLengthM(f);
  const width = f.width || 0;
  const depth = f.depth || 0;
  const volume = length * width * depth;
  const soffit = width * length;
  const vertical = 2 * depth * length;
  const formwork =
    f.shape === 'INSITU' ? soffit + vertical : 0;
  return {
    netVolumeM3: round(volume),
    formworkAreaM2: round(formwork),
    breakdown: {
      length: round(length, 4),
      width: round(width, 4),
      depth: round(depth, 4),
      soffitFormwork: f.shape === 'INSITU' ? round(soffit) : 0,
      verticalFormwork: f.shape === 'INSITU' ? round(vertical) : 0,
    },
  };
}

export function lintelRebar(
  f: LintelInput,
  volumeM3: number,
): { groups: RebarGroup[]; totalWeightKg: number; densityKgPerM3: number } {
  if (f.shape !== 'INSITU') {
    return { groups: [], totalWeightKg: 0, densityKgPerM3: 0 };
  }
  const length = lintelLengthM(f);
  const beam: BeamInput = {
    shape: 'RECTANGULAR',
    spanLength: length,
    width: f.width || 0.2,
    depth: f.depth || 0.15,
    topBars: f.topBars,
    bottomBars: f.bottomBars,
    topBarCount: f.topBarCount ?? 2,
    topBarDia: f.topBarDia ?? 12,
    bottomBarCount: f.bottomBarCount ?? 2,
    bottomBarDia: f.bottomBarDia ?? 12,
    linkDia: f.linkDia ?? 8,
    linkSpacing: f.linkSpacing ?? 200,
  };
  return beamRebar(beam, volumeM3);
}

export function calcLintel(f: LintelInput): StructuralCalcResult & {
  totalLengthM: number;
} {
  const concrete = lintelConcrete(f);
  const rebar = lintelRebar(f, concrete.netVolumeM3);
  const length = lintelLengthM(f);
  const n = f.count || 1;
  const base = withFormworkSplit({
    perUnit: { concrete, rebar },
    count: n,
    volumeM3: concrete.netVolumeM3,
    soffitFormworkM2: concrete.breakdown.soffitFormwork || 0,
    verticalFormworkM2: concrete.breakdown.verticalFormwork || 0,
    rebarKg: rebar.totalWeightKg,
  });
  return {
    ...base,
    totalLengthM: round(length * n),
  };
}

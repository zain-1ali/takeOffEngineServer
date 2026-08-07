/**
 * Raft foundation calculator. Follows the pad-footing structural contract:
 * concrete + grouped reinforcement per unit, then count-scaled totals.
 */
import { round } from './math';
import { twoWayMesh, type MeshResult } from './padFooting';
import type { ConcreteResult, RebarGroup, StructuralCalcResult } from './types';

export type RaftShape = 'MONOLITHIC' | 'THICKENED_EDGE';

export type RaftInput = {
  shape: RaftShape;
  count?: number;
  length: number;
  width: number;
  thickness: number;
  edgeWidth?: number;
  edgeExtraDepth?: number;
  cover: number;
  bottomMainDia: number;
  bottomMainSpacing: number;
  bottomDistDia: number;
  bottomDistSpacing: number;
};

export function raftConcrete(f: RaftInput): ConcreteResult {
  const planArea = f.length * f.width;
  const slabVolume = planArea * f.thickness;
  const edgeWidth = f.shape === 'THICKENED_EDGE' ? f.edgeWidth || 0 : 0;
  const extraDepth = f.shape === 'THICKENED_EDGE' ? f.edgeExtraDepth || 0 : 0;
  const innerLength = Math.max(0, f.length - 2 * edgeWidth);
  const innerWidth = Math.max(0, f.width - 2 * edgeWidth);
  const downstandArea = planArea - innerLength * innerWidth;
  const downstandVolume = downstandArea * extraDepth;
  const totalDepth = f.thickness + extraDepth;

  return {
    netVolumeM3: round(slabVolume + downstandVolume),
    formworkAreaM2: round(2 * (f.length + f.width) * totalDepth),
    breakdown: {
      slabVolume: round(slabVolume),
      edgeDownstandVolume: round(downstandVolume),
    },
  };
}

export function raftRebar(f: RaftInput, netVolumeM3: number) {
  const bottomMesh = twoWayMesh(
    f.length,
    f.width,
    f.cover,
    f.bottomMainDia,
    f.bottomMainSpacing,
    f.bottomDistDia,
    f.bottomDistSpacing,
  );
  const topMesh: MeshResult = twoWayMesh(
    f.length,
    f.width,
    f.cover,
    f.bottomMainDia,
    f.bottomMainSpacing,
    f.bottomDistDia,
    f.bottomDistSpacing,
  );
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
      diameterMm: topMesh.mainBars.diameterMm,
      weightKg: topMesh.mainBars.weightKg,
      role: 'Top main',
    },
    {
      diameterMm: topMesh.distBars.diameterMm,
      weightKg: topMesh.distBars.weightKg,
      role: 'Top distribution',
    },
  ];
  const totalWeightKg = round(bottomMesh.totalWeightKg + topMesh.totalWeightKg);

  return {
    bottomMesh,
    topMesh,
    groups,
    totalWeightKg,
    densityKgPerM3: netVolumeM3 > 0 ? round(totalWeightKg / netVolumeM3) : 0,
  };
}

export function calcRaft(f: RaftInput): StructuralCalcResult {
  const concrete = raftConcrete(f);
  const rebar = raftRebar(f, concrete.netVolumeM3);
  const n = f.count || 1;
  return {
    perUnit: { concrete, rebar },
    count: n,
    totalVolumeM3: round(concrete.netVolumeM3 * n),
    totalFormworkM2: round(concrete.formworkAreaM2 * n),
    totalRebarKg: round(rebar.totalWeightKg * n),
  };
}

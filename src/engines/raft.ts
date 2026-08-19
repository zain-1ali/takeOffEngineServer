/**
 * Raft foundation calculator. Follows the pad-footing structural contract:
 * concrete + grouped reinforcement per unit, then count-scaled totals.
 */
import { withVerticalFormworkOnly } from './formworkSplit';
import { round } from './math';
import {
  resolveLayerMesh,
  twoWayMesh,
  type MeshBarGroup,
  type MeshResult,
} from './padFooting';
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
  bottomMainBars?: MeshBarGroup[];
  bottomDistBars?: MeshBarGroup[];
  topMainBars?: MeshBarGroup[];
  topDistBars?: MeshBarGroup[];
  bottomMainDia?: number;
  bottomMainSpacing?: number;
  bottomDistDia?: number;
  bottomDistSpacing?: number;
  topMainDia?: number;
  topMainSpacing?: number;
  topDistDia?: number;
  topDistSpacing?: number;
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

function pushLayer(
  groups: RebarGroup[],
  mesh: MeshResult,
  mainRole: string,
  distRole: string,
) {
  for (const s of mesh.mainSets) {
    groups.push({
      diameterMm: s.diameterMm,
      weightKg: s.weightKg,
      role: mesh.mainSets.length > 1 ? `${mainRole} Ø${s.diameterMm}` : mainRole,
    });
  }
  for (const s of mesh.distSets) {
    groups.push({
      diameterMm: s.diameterMm,
      weightKg: s.weightKg,
      role: mesh.distSets.length > 1 ? `${distRole} Ø${s.diameterMm}` : distRole,
    });
  }
}

export function raftRebar(f: RaftInput, netVolumeM3: number) {
  const bottomMesh =
    resolveLayerMesh(
      f.length,
      f.width,
      f.cover,
      f.bottomMainBars,
      f.bottomDistBars,
      f.bottomMainDia,
      f.bottomMainSpacing,
      f.bottomDistDia,
      f.bottomDistSpacing,
    ) || twoWayMesh(f.length, f.width, f.cover, 12, 200, 12, 200);

  const topMesh =
    resolveLayerMesh(
      f.length,
      f.width,
      f.cover,
      f.topMainBars,
      f.topDistBars,
      f.topMainDia,
      f.topMainSpacing,
      f.topDistDia,
      f.topDistSpacing,
      bottomMesh,
    ) || bottomMesh;

  const groups: RebarGroup[] = [];
  pushLayer(groups, bottomMesh, 'Bottom main', 'Bottom distribution');
  pushLayer(groups, topMesh, 'Top main', 'Top distribution');
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
  return withVerticalFormworkOnly({
    perUnit: { concrete, rebar },
    count: f.count || 1,
    volumeM3: concrete.netVolumeM3,
    formworkM2: concrete.formworkAreaM2,
    rebarKg: rebar.totalWeightKg,
  });
}

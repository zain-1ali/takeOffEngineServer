/**
 * Ramp calculator. Helical ramps share the same average-radius unrolling
 * rule as spiral stairs so identical radius, width, angle and rise inputs
 * always produce identical development lengths.
 *
 * String-beam reinforcement reuses the Beams RECTANGULAR bar-by-bar model.
 */
import { stringBeamRebarFromBeams } from './beams';
import { withFormworkSplit } from './formworkSplit';
import { helicalDevelopment, round } from './math';
import { twoWayMesh } from './padFooting';
import type { ConcreteResult, RebarGroup, StructuralCalcResult } from './types';

export type RampShape = 'RECTANGULAR_INCLINE' | 'HELICAL';

export type RampInput = {
  shape: RampShape;
  count?: number;
  width: number;
  rise: number;
  horizontalRun?: number;
  innerRadius?: number;
  turnAngleDeg?: number;
  thickness: number;
  cover: number;
  mainDia: number;
  mainSpacing: number;
  distDia: number;
  distSpacing: number;
  stringBeamCount: number;
  stringBeamWidth: number;
  stringBeamDepth: number;
  stringTopBarCount: number;
  stringTopBarDia: number;
  stringBottomBarCount: number;
  stringBottomBarDia: number;
  stringLinkDia: number;
  stringLinkSpacing: number;
};

export type RampDevelopment = {
  averageRadius: number;
  planLength: number;
  slopingLength: number;
};

export function rampDevelopment(f: RampInput): RampDevelopment {
  if (f.shape === 'HELICAL') {
    return helicalDevelopment(
      f.innerRadius || 0,
      f.width,
      f.turnAngleDeg || 0,
      f.rise,
    );
  }
  const planLength = f.horizontalRun || 0;
  return {
    averageRadius: 0,
    planLength,
    slopingLength: Math.sqrt(planLength ** 2 + f.rise ** 2),
  };
}

export function rampConcrete(f: RampInput): ConcreteResult {
  const development = rampDevelopment(f);
  const volume =
    development.slopingLength * f.width * f.thickness;
  const soffit = development.slopingLength * f.width;
  const sideForms =
    2 * development.slopingLength * f.thickness;
  return {
    netVolumeM3: round(volume),
    formworkAreaM2: round(soffit + sideForms),
    breakdown: {
      averageRadius: round(development.averageRadius, 4),
      planDevelopment: round(development.planLength, 4),
      slopingDevelopment: round(development.slopingLength, 4),
      soffit: round(soffit),
      sideForms: round(sideForms),
      soffitFormwork: round(soffit),
      verticalFormwork: round(sideForms),
    },
  };
}

export function rampRebar(f: RampInput, volumeM3: number) {
  const development = rampDevelopment(f);
  const waistMesh = twoWayMesh(
    development.slopingLength,
    f.width,
    f.cover,
    f.mainDia,
    f.mainSpacing,
    f.distDia,
    f.distSpacing,
  );
  const stringBeams = stringBeamRebarFromBeams(
    development.slopingLength,
    f,
  );
  const groups: RebarGroup[] = [
    {
      diameterMm: waistMesh.mainBars.diameterMm,
      weightKg: waistMesh.mainBars.weightKg,
      role: 'Ramp main mesh',
    },
    {
      diameterMm: waistMesh.distBars.diameterMm,
      weightKg: waistMesh.distBars.weightKg,
      role: 'Ramp distribution mesh',
    },
    ...stringBeams.groups,
  ];
  const totalWeightKg = round(
    waistMesh.totalWeightKg + stringBeams.totalWeightKg,
  );
  return {
    waistMesh,
    stringBeams,
    groups,
    totalWeightKg,
    densityKgPerM3: volumeM3 > 0 ? round(totalWeightKg / volumeM3) : 0,
  };
}

export function calcRamp(f: RampInput): StructuralCalcResult {
  const concrete = rampConcrete(f);
  const rebar = rampRebar(f, concrete.netVolumeM3);
  return withFormworkSplit({
    perUnit: { concrete, rebar },
    count: f.count || 1,
    volumeM3: concrete.netVolumeM3,
    soffitFormworkM2: concrete.breakdown.soffitFormwork || 0,
    verticalFormworkM2: concrete.breakdown.verticalFormwork || 0,
    rebarKg: rebar.totalWeightKg,
  });
}

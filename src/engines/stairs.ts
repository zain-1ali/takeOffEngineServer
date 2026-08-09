/**
 * Stair calculator.
 *
 * Spiral stairs deliberately use the client's Section 11 simplification:
 * the helical path is unrolled at its average radius and measured as an
 * equivalent straight stair. This is an estimating model, not fabrication
 * or bar-bending geometry.
 *
 * String-beam reinforcement reuses the Beams RECTANGULAR bar-by-bar model
 * (longitudinal bars + links at spacing × perimeter × dia²/162).
 */
import { stringBeamRebarFromBeams } from './beams';
import { withFormworkSplit } from './formworkSplit';
import { helicalDevelopment, round } from './math';
import { twoWayMesh } from './padFooting';
import type { ConcreteResult, RebarGroup, StructuralCalcResult } from './types';

export type StairShape = 'STRAIGHT' | 'WINDER' | 'SPIRAL';

export type StairInput = {
  shape: StairShape;
  count?: number;
  width: number;
  rise: number;
  run?: number;
  flight1Run?: number;
  flight2Run?: number;
  innerRadius?: number;
  turnAngleDeg?: number;
  stepCount: number;
  waistThickness: number;
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

export type StairDevelopment = {
  averageRadius: number;
  planLength: number;
  slopingLength: number;
};

export function stairDevelopment(f: StairInput): StairDevelopment {
  if (f.shape === 'SPIRAL') {
    return helicalDevelopment(
      f.innerRadius || 0,
      f.width,
      f.turnAngleDeg || 0,
      f.rise,
    );
  }
  let planLength = f.run || 0;
  let averageRadius = 0;
  if (f.shape === 'WINDER') {
    const turn = helicalDevelopment(
      f.innerRadius || 0,
      f.width,
      f.turnAngleDeg || 0,
      0,
    );
    averageRadius = turn.averageRadius;
    planLength =
      (f.flight1Run || 0) + turn.planLength + (f.flight2Run || 0);
  }
  return {
    averageRadius,
    planLength,
    slopingLength: Math.sqrt(planLength ** 2 + f.rise ** 2),
  };
}

export function stairConcrete(f: StairInput): ConcreteResult {
  const development = stairDevelopment(f);
  const riserHeight = f.rise / Math.max(1, f.stepCount);
  const waistVolume =
    development.slopingLength * f.width * f.waistThickness;
  const stepVolume =
    0.5 * development.planLength * riserHeight * f.width;
  const soffit = development.slopingLength * f.width;
  const risers = f.rise * f.width;
  const sideProfile =
    development.slopingLength * f.waistThickness +
    0.5 * development.planLength * riserHeight;
  const verticalFormwork = risers + 2 * sideProfile;
  return {
    netVolumeM3: round(waistVolume + stepVolume),
    formworkAreaM2: round(soffit + verticalFormwork),
    breakdown: {
      averageRadius: round(development.averageRadius, 4),
      planDevelopment: round(development.planLength, 4),
      slopingDevelopment: round(development.slopingLength, 4),
      waistVolume: round(waistVolume),
      stepVolume: round(stepVolume),
      soffit: round(soffit),
      risers: round(risers),
      sideForms: round(2 * sideProfile),
      soffitFormwork: round(soffit),
      verticalFormwork: round(verticalFormwork),
    },
  };
}

export function stairRebar(f: StairInput, volumeM3: number) {
  const development = stairDevelopment(f);
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
      role: 'Waist main mesh',
    },
    {
      diameterMm: waistMesh.distBars.diameterMm,
      weightKg: waistMesh.distBars.weightKg,
      role: 'Waist distribution mesh',
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

export function calcStair(f: StairInput): StructuralCalcResult {
  const concrete = stairConcrete(f);
  const rebar = stairRebar(f, concrete.netVolumeM3);
  return withFormworkSplit({
    perUnit: { concrete, rebar },
    count: f.count || 1,
    volumeM3: concrete.netVolumeM3,
    soffitFormworkM2: concrete.breakdown.soffitFormwork || 0,
    verticalFormworkM2: concrete.breakdown.verticalFormwork || 0,
    rebarKg: rebar.totalWeightKg,
  });
}

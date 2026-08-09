import { withFormworkSplit } from './formworkSplit';
import { barCountForSpan, round, unitWeightKgPerM } from './math';
import type {
  ConcreteResult,
  RebarGroup,
  StructuralCalcResult,
} from './types';

export type BeamShape =
  | 'RECTANGULAR'
  | 'T_SECTION'
  | 'L_SECTION'
  | 'CANTILEVER_TAPERED'
  | 'GROUND_TIE';

export type BeamInput = {
  shape: BeamShape;
  count?: number;
  spanLength: number;
  width?: number;
  depth?: number;
  flangeWidth?: number;
  flangeThickness?: number;
  webWidth?: number;
  overallDepth?: number;
  supportDepth?: number;
  tipDepth?: number;
  topBarCount: number;
  topBarDia: number;
  bottomBarCount: number;
  bottomBarDia: number;
  linkDia: number;
  linkSpacing: number;
};

export type BeamGeometry = {
  averageAreaM2: number;
  volumeM3: number;
  formworkAreaM2: number;
  soffitFormworkM2: number;
  verticalFormworkM2: number;
  linkPerimeterM: number;
};

export function beamGeometry(f: BeamInput): BeamGeometry {
  const span = f.spanLength;
  if (f.shape === 'T_SECTION' || f.shape === 'L_SECTION') {
    const flangeWidth = f.flangeWidth || 0;
    const flangeThickness = f.flangeThickness || 0;
    const webWidth = f.webWidth || 0;
    const depth = f.overallDepth || 0;
    const area =
      flangeWidth * flangeThickness +
      webWidth * Math.max(0, depth - flangeThickness);
    const soffitFormworkM2 = flangeWidth * span;
    const verticalFormworkM2 = 2 * depth * span;
    return {
      averageAreaM2: area,
      volumeM3: area * span,
      formworkAreaM2: soffitFormworkM2 + verticalFormworkM2,
      soffitFormworkM2,
      verticalFormworkM2,
      linkPerimeterM: 2 * (webWidth + depth),
    };
  }
  if (f.shape === 'CANTILEVER_TAPERED') {
    const width = f.width || 0;
    const supportDepth = f.supportDepth || 0;
    const tipDepth = f.tipDepth || 0;
    const averageDepth = (supportDepth + tipDepth) / 2;
    const slopingSoffitLength = Math.sqrt(
      span * span + (supportDepth - tipDepth) ** 2,
    );
    const soffitFormworkM2 = width * slopingSoffitLength;
    const verticalFormworkM2 = span * (supportDepth + tipDepth);
    return {
      averageAreaM2: width * averageDepth,
      volumeM3: width * averageDepth * span,
      formworkAreaM2: soffitFormworkM2 + verticalFormworkM2,
      soffitFormworkM2,
      verticalFormworkM2,
      linkPerimeterM: 2 * (width + averageDepth),
    };
  }
  const width = f.width || 0;
  const depth = f.depth || 0;
  if (f.shape === 'GROUND_TIE') {
    // Earth-supported soffit — sides only.
    const verticalFormworkM2 = 2 * depth * span;
    return {
      averageAreaM2: width * depth,
      volumeM3: width * depth * span,
      formworkAreaM2: verticalFormworkM2,
      soffitFormworkM2: 0,
      verticalFormworkM2,
      linkPerimeterM: 2 * (width + depth),
    };
  }
  const soffitFormworkM2 = width * span;
  const verticalFormworkM2 = 2 * depth * span;
  return {
    averageAreaM2: width * depth,
    volumeM3: width * depth * span,
    formworkAreaM2: soffitFormworkM2 + verticalFormworkM2,
    soffitFormworkM2,
    verticalFormworkM2,
    linkPerimeterM: 2 * (width + depth),
  };
}

export function beamConcrete(f: BeamInput): ConcreteResult {
  const geometry = beamGeometry(f);
  return {
    netVolumeM3: round(geometry.volumeM3),
    formworkAreaM2: round(geometry.formworkAreaM2),
    breakdown: {
      averageCrossSectionArea: round(geometry.averageAreaM2, 4),
      linkPerimeter: round(geometry.linkPerimeterM, 4),
      soffitFormwork: round(geometry.soffitFormworkM2),
      verticalFormwork: round(geometry.verticalFormworkM2),
    },
  };
}

export function beamRebar(f: BeamInput, volumeM3: number) {
  const geometry = beamGeometry(f);
  const topWeightKg = round(
    f.topBarCount * f.spanLength * unitWeightKgPerM(f.topBarDia),
  );
  const bottomWeightKg = round(
    f.bottomBarCount * f.spanLength * unitWeightKgPerM(f.bottomBarDia),
  );
  const linkCount = barCountForSpan(f.spanLength, f.linkSpacing);
  const linkWeightKg = round(
    linkCount * geometry.linkPerimeterM * unitWeightKgPerM(f.linkDia),
  );
  const groups: RebarGroup[] = [
    { diameterMm: f.topBarDia, weightKg: topWeightKg, role: 'Top bars' },
    {
      diameterMm: f.bottomBarDia,
      weightKg: bottomWeightKg,
      role: 'Bottom bars',
    },
    { diameterMm: f.linkDia, weightKg: linkWeightKg, role: 'Shear links' },
  ];
  const totalWeightKg = round(
    topWeightKg + bottomWeightKg + linkWeightKg,
  );
  return {
    topBars: {
      diameterMm: f.topBarDia,
      barCount: f.topBarCount,
      weightKg: topWeightKg,
    },
    bottomBars: {
      diameterMm: f.bottomBarDia,
      barCount: f.bottomBarCount,
      weightKg: bottomWeightKg,
    },
    links: {
      diameterMm: f.linkDia,
      barCount: linkCount,
      weightKg: linkWeightKg,
    },
    groups,
    totalWeightKg,
    densityKgPerM3: volumeM3 > 0 ? round(totalWeightKg / volumeM3) : 0,
  };
}

export function calcBeam(f: BeamInput): StructuralCalcResult {
  const concrete = beamConcrete(f);
  const rebar = beamRebar(f, concrete.netVolumeM3);
  const geometry = beamGeometry(f);
  return withFormworkSplit({
    perUnit: { concrete, rebar },
    count: f.count || 1,
    volumeM3: concrete.netVolumeM3,
    soffitFormworkM2: geometry.soffitFormworkM2,
    verticalFormworkM2: geometry.verticalFormworkM2,
    rebarKg: rebar.totalWeightKg,
  });
}

/** String-beam steel for stairs/ramps — reuses RECTANGULAR beam rebar. */
export type StringBeamRebarInput = {
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

export function stringBeamRebarFromBeams(
  slopingLength: number,
  f: StringBeamRebarInput,
) {
  const count = f.stringBeamCount || 0;
  if (!(count > 0) || !(slopingLength > 0)) {
    return {
      count: 0,
      totalWeightKg: 0,
      perBeam: null as ReturnType<typeof beamRebar> | null,
      groups: [] as RebarGroup[],
    };
  }
  const beam: BeamInput = {
    shape: 'RECTANGULAR',
    spanLength: slopingLength,
    width: f.stringBeamWidth,
    depth: f.stringBeamDepth,
    topBarCount: f.stringTopBarCount,
    topBarDia: f.stringTopBarDia,
    bottomBarCount: f.stringBottomBarCount,
    bottomBarDia: f.stringBottomBarDia,
    linkDia: f.stringLinkDia,
    linkSpacing: f.stringLinkSpacing,
  };
  const perBeam = beamRebar(beam, beamConcrete(beam).netVolumeM3);
  const groups: RebarGroup[] = perBeam.groups.map((g) => ({
    diameterMm: g.diameterMm,
    weightKg: round(g.weightKg * count),
    role: `String beam — ${g.role}`,
  }));
  return {
    count,
    totalWeightKg: round(perBeam.totalWeightKg * count),
    perBeam,
    groups,
  };
}

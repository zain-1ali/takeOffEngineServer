/**
 * Stair calculator — segment model (Flight | Landing).
 *
 * ASSUMPTION 1 (data model, pending client confirmation):
 *   A Stairs instance holds an ordered `segments[]` of Flight | Landing.
 *   Legacy flat geometry (run/rise/…) normalises to a single Flight segment.
 *
 * ASSUMPTION 2 (formwork lm, pending client confirmation — flag in BOQ/UI):
 *   Riser (lm) = stepCount × width
 *   Side (lm)  = slopingLength × exposedSides  (exposedSides defaults to 2)
 *
 * Spiral flights still use Section 11 average-radius unrolling.
 * String-beam & stair-beam reinforcement reuse the Beams RECTANGULAR model.
 */
import {
  beamConcrete,
  beamRebar,
  stringBeamRebarFromBeams,
  type BeamInput,
} from './beams';
import { withFormworkSplit } from './formworkSplit';
import { helicalDevelopment, round } from './math';
import { twoWayMesh } from './padFooting';
import type { ConcreteResult, RebarGroup, StructuralCalcResult } from './types';

export type StairShape = 'STRAIGHT' | 'WINDER' | 'SPIRAL';

export type StairFlightSegment = {
  kind: 'flight';
  id?: string;
  label?: string;
  /** Straight plan run (m). Ignored when spiral/winder fields drive development. */
  run?: number;
  rise: number;
  width: number;
  stepCount: number;
  waistThickness: number;
  /**
   * ASSUMPTION 2 — sides needing formwork (default 2).
   * Set to 1 when one side is against a wall.
   */
  exposedSides?: number;
  /** Optional spiral / winder turn on this flight alone. */
  innerRadius?: number;
  turnAngleDeg?: number;
  flight1Run?: number;
  flight2Run?: number;
  /** Override development mode for this flight; else instance shape. */
  flightShape?: StairShape;
};

export type StairLandingSegment = {
  kind: 'landing';
  id?: string;
  label?: string;
  length: number;
  width: number;
  thickness: number;
  /**
   * Exposed edge length for landing edge formwork (lm).
   * Default = 2×(L+W) when omitted (free-standing perimeter assumption).
   */
  exposedEdgeLm?: number;
  /** Optional landing / stair beam — Beams engine RECTANGULAR. */
  stairBeam?: {
    count?: number;
    spanLength?: number;
    width: number;
    depth: number;
  };
};

export type StairSegment = StairFlightSegment | StairLandingSegment;

export type StairBeamRebarInput = {
  stairBeamTopBarCount: number;
  stairBeamTopBarDia: number;
  stairBeamBottomBarCount: number;
  stairBeamBottomBarDia: number;
  stairBeamLinkDia: number;
  stairBeamLinkSpacing: number;
};

export type StairInput = {
  shape: StairShape;
  count?: number;
  /** Preferred multi-flight/landing model. */
  segments?: StairSegment[];
  /** Legacy flat fields — used when segments absent. */
  width?: number;
  rise?: number;
  run?: number;
  flight1Run?: number;
  flight2Run?: number;
  innerRadius?: number;
  turnAngleDeg?: number;
  stepCount?: number;
  waistThickness?: number;
  exposedSides?: number;
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
} & Partial<StairBeamRebarInput>;

export type StairDevelopment = {
  averageRadius: number;
  planLength: number;
  slopingLength: number;
};

export type FlightQuantities = {
  kind: 'flight';
  label: string;
  planLength: number;
  slopingLength: number;
  volumeM3: number;
  waistVolumeM3: number;
  stepVolumeM3: number;
  soffitM2: number;
  /** ASSUMPTION 2 */
  riserLm: number;
  /** ASSUMPTION 2 */
  sideLm: number;
  exposedSides: number;
  stepCount: number;
  width: number;
  riserHeight: number;
};

export type LandingQuantities = {
  kind: 'landing';
  label: string;
  volumeM3: number;
  soffitM2: number;
  edgeLm: number;
  stairBeamVolumeM3: number;
  stairBeamFormworkM2: number;
  stairBeamSoffitM2: number;
  stairBeamVerticalM2: number;
  stairBeamRebarKg: number;
  stairBeamGroups: RebarGroup[];
};

export type StairBreakdown = {
  flights: FlightQuantities[];
  landings: LandingQuantities[];
  flightVolumeM3: number;
  landingVolumeM3: number;
  stairBeamVolumeM3: number;
  soffitM2: number;
  riserLm: number;
  sideLm: number;
  landingEdgeLm: number;
  /** True when Assumption 2 lm formulas were used. */
  formworkLmAssumptionPending: true;
};

const DEFAULT_STAIR_BEAM_REBAR: StairBeamRebarInput = {
  stairBeamTopBarCount: 2,
  stairBeamTopBarDia: 12,
  stairBeamBottomBarCount: 2,
  stairBeamBottomBarDia: 12,
  stairBeamLinkDia: 8,
  stairBeamLinkSpacing: 200,
};

export function newSegmentId(): string {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Legacy flat geometry → one Flight segment (Assumption 1 single-flight case). */
export function legacyToSegments(f: StairInput): StairSegment[] {
  const width = f.width || 1.2;
  const rise = f.rise || 3;
  const stepCount = f.stepCount || 12;
  const waistThickness = f.waistThickness || 0.15;
  const exposedSides = f.exposedSides != null ? f.exposedSides : 2;
  const flight: StairFlightSegment = {
    kind: 'flight',
    id: newSegmentId(),
    label: 'Flight 1',
    rise,
    width,
    stepCount,
    waistThickness,
    exposedSides,
    flightShape: f.shape,
    run: f.run,
    flight1Run: f.flight1Run,
    flight2Run: f.flight2Run,
    innerRadius: f.innerRadius,
    turnAngleDeg: f.turnAngleDeg,
  };
  return [flight];
}

export function normalizeStairSegments(f: StairInput): StairSegment[] {
  if (Array.isArray(f.segments) && f.segments.length > 0) {
    return f.segments.map((s, i) => {
      if (s.kind === 'flight') {
        return {
          ...s,
          id: s.id || newSegmentId(),
          label: s.label || `Flight ${i + 1}`,
          exposedSides: s.exposedSides != null ? s.exposedSides : 2,
          flightShape: s.flightShape || f.shape,
        };
      }
      return {
        ...s,
        id: s.id || newSegmentId(),
        label: s.label || `Landing ${i + 1}`,
      };
    });
  }
  return legacyToSegments(f);
}

export function flightDevelopment(
  flight: StairFlightSegment,
  instanceShape: StairShape,
): StairDevelopment {
  const shape = flight.flightShape || instanceShape;
  if (shape === 'SPIRAL') {
    return helicalDevelopment(
      flight.innerRadius || 0,
      flight.width,
      flight.turnAngleDeg || 0,
      flight.rise,
    );
  }
  let planLength = flight.run || 0;
  let averageRadius = 0;
  if (shape === 'WINDER') {
    const turn = helicalDevelopment(
      flight.innerRadius || 0,
      flight.width,
      flight.turnAngleDeg || 0,
      0,
    );
    averageRadius = turn.averageRadius;
    planLength =
      (flight.flight1Run || 0) + turn.planLength + (flight.flight2Run || 0);
  }
  return {
    averageRadius,
    planLength,
    slopingLength: Math.sqrt(planLength ** 2 + flight.rise ** 2),
  };
}

/** @deprecated prefer flightDevelopment after normalize — kept for tests. */
export function stairDevelopment(f: StairInput): StairDevelopment {
  const segs = normalizeStairSegments(f);
  const flight = segs.find((s): s is StairFlightSegment => s.kind === 'flight');
  if (!flight) {
    return { averageRadius: 0, planLength: 0, slopingLength: 0 };
  }
  return flightDevelopment(flight, f.shape);
}

export function calcFlightQuantities(
  flight: StairFlightSegment,
  instanceShape: StairShape,
  index: number,
): FlightQuantities {
  const development = flightDevelopment(flight, instanceShape);
  const riserHeight = flight.rise / Math.max(1, flight.stepCount);
  const waistVolume =
    development.slopingLength * flight.width * flight.waistThickness;
  const stepVolume =
    0.5 * development.planLength * riserHeight * flight.width;
  const soffit = development.slopingLength * flight.width;
  const exposedSides =
    flight.exposedSides != null && flight.exposedSides >= 0
      ? flight.exposedSides
      : 2;
  // ASSUMPTION 2 (pending client confirmation)
  const riserLm = flight.stepCount * flight.width;
  const sideLm = development.slopingLength * exposedSides;

  return {
    kind: 'flight',
    label: flight.label || `Flight ${index + 1}`,
    planLength: round(development.planLength, 4),
    slopingLength: round(development.slopingLength, 4),
    volumeM3: round(waistVolume + stepVolume),
    waistVolumeM3: round(waistVolume),
    stepVolumeM3: round(stepVolume),
    soffitM2: round(soffit),
    riserLm: round(riserLm),
    sideLm: round(sideLm),
    exposedSides,
    stepCount: flight.stepCount,
    width: flight.width,
    riserHeight: round(riserHeight, 4),
  };
}

export function calcLandingQuantities(
  landing: StairLandingSegment,
  rebar: StairBeamRebarInput,
  index: number,
): LandingQuantities {
  const volume = landing.length * landing.width * landing.thickness;
  const soffit = landing.length * landing.width;
  const edgeLm =
    landing.exposedEdgeLm != null && Number.isFinite(landing.exposedEdgeLm)
      ? Math.max(0, landing.exposedEdgeLm)
      : 2 * (landing.length + landing.width);

  let stairBeamVolumeM3 = 0;
  let stairBeamFormworkM2 = 0;
  let stairBeamSoffitM2 = 0;
  let stairBeamVerticalM2 = 0;
  let stairBeamRebarKg = 0;
  let stairBeamGroups: RebarGroup[] = [];

  const sb = landing.stairBeam;
  if (sb && sb.width > 0 && sb.depth > 0) {
    const count = Math.max(1, sb.count || 1);
    const span =
      sb.spanLength != null && sb.spanLength > 0
        ? sb.spanLength
        : landing.length;
    const beam: BeamInput = {
      shape: 'RECTANGULAR',
      spanLength: span,
      width: sb.width,
      depth: sb.depth,
      topBarCount: rebar.stairBeamTopBarCount,
      topBarDia: rebar.stairBeamTopBarDia,
      bottomBarCount: rebar.stairBeamBottomBarCount,
      bottomBarDia: rebar.stairBeamBottomBarDia,
      linkDia: rebar.stairBeamLinkDia,
      linkSpacing: rebar.stairBeamLinkSpacing,
    };
    const conc = beamConcrete(beam);
    const steel = beamRebar(beam, conc.netVolumeM3);
    stairBeamVolumeM3 = round(conc.netVolumeM3 * count);
    stairBeamFormworkM2 = round(conc.formworkAreaM2 * count);
    stairBeamSoffitM2 = round((conc.breakdown.soffitFormwork || 0) * count);
    stairBeamVerticalM2 = round((conc.breakdown.verticalFormwork || 0) * count);
    stairBeamRebarKg = round(steel.totalWeightKg * count);
    stairBeamGroups = steel.groups.map((g) => ({
      ...g,
      weightKg: round(g.weightKg * count),
      role: `Stair beam — ${g.role}`,
    }));
  }

  return {
    kind: 'landing',
    label: landing.label || `Landing ${index + 1}`,
    volumeM3: round(volume),
    soffitM2: round(soffit),
    edgeLm: round(edgeLm),
    stairBeamVolumeM3,
    stairBeamFormworkM2,
    stairBeamSoffitM2,
    stairBeamVerticalM2,
    stairBeamRebarKg,
    stairBeamGroups,
  };
}

function resolveStairBeamRebar(f: StairInput): StairBeamRebarInput {
  return {
    stairBeamTopBarCount:
      f.stairBeamTopBarCount ?? DEFAULT_STAIR_BEAM_REBAR.stairBeamTopBarCount,
    stairBeamTopBarDia:
      f.stairBeamTopBarDia ?? DEFAULT_STAIR_BEAM_REBAR.stairBeamTopBarDia,
    stairBeamBottomBarCount:
      f.stairBeamBottomBarCount ??
      DEFAULT_STAIR_BEAM_REBAR.stairBeamBottomBarCount,
    stairBeamBottomBarDia:
      f.stairBeamBottomBarDia ?? DEFAULT_STAIR_BEAM_REBAR.stairBeamBottomBarDia,
    stairBeamLinkDia:
      f.stairBeamLinkDia ?? DEFAULT_STAIR_BEAM_REBAR.stairBeamLinkDia,
    stairBeamLinkSpacing:
      f.stairBeamLinkSpacing ?? DEFAULT_STAIR_BEAM_REBAR.stairBeamLinkSpacing,
  };
}

export function stairConcrete(f: StairInput): ConcreteResult & {
  stairBreakdown: StairBreakdown;
} {
  const segments = normalizeStairSegments(f);
  const beamRebarCfg = resolveStairBeamRebar(f);
  const flights: FlightQuantities[] = [];
  const landings: LandingQuantities[] = [];
  let fi = 0;
  let li = 0;

  for (const seg of segments) {
    if (seg.kind === 'flight') {
      flights.push(calcFlightQuantities(seg, f.shape, fi));
      fi++;
    } else {
      landings.push(calcLandingQuantities(seg, beamRebarCfg, li));
      li++;
    }
  }

  const flightVolumeM3 = round(
    flights.reduce((s, x) => s + x.volumeM3, 0),
  );
  const landingVolumeM3 = round(
    landings.reduce((s, x) => s + x.volumeM3, 0),
  );
  const stairBeamVolumeM3 = round(
    landings.reduce((s, x) => s + x.stairBeamVolumeM3, 0),
  );
  const soffitM2 = round(
    flights.reduce((s, x) => s + x.soffitM2, 0) +
      landings.reduce((s, x) => s + x.soffitM2, 0) +
      landings.reduce((s, x) => s + x.stairBeamSoffitM2, 0),
  );
  const riserLm = round(flights.reduce((s, x) => s + x.riserLm, 0));
  const sideLm = round(flights.reduce((s, x) => s + x.sideLm, 0));
  const landingEdgeLm = round(landings.reduce((s, x) => s + x.edgeLm, 0));
  const stairBeamVertical = landings.reduce(
    (s, x) => s + x.stairBeamVerticalM2,
    0,
  );

  const netVolumeM3 = round(
    flightVolumeM3 + landingVolumeM3 + stairBeamVolumeM3,
  );
  // Area formwork for props/bracing: soffits + stair-beam vertical faces.
  // Riser/side lm are separate BOQ lines (Assumption 2) — not converted to m².
  const formworkAreaM2 = round(soffitM2 + stairBeamVertical);

  const stairBreakdown: StairBreakdown = {
    flights,
    landings,
    flightVolumeM3,
    landingVolumeM3,
    stairBeamVolumeM3,
    soffitM2,
    riserLm,
    sideLm,
    landingEdgeLm,
    formworkLmAssumptionPending: true,
  };

  return {
    netVolumeM3,
    formworkAreaM2,
    breakdown: {
      flightVolume: flightVolumeM3,
      landingVolume: landingVolumeM3,
      stairBeamVolume: stairBeamVolumeM3,
      soffit: soffitM2,
      riserLm,
      sideLm,
      landingEdgeLm,
      soffitFormwork: soffitM2,
      verticalFormwork: round(stairBeamVertical),
      formworkLmAssumptionPending: 1,
    },
    stairBreakdown,
  };
}

export function stairRebar(f: StairInput, volumeM3: number) {
  const segments = normalizeStairSegments(f);
  const beamRebarCfg = resolveStairBeamRebar(f);
  const groups: RebarGroup[] = [];
  let totalWeightKg = 0;

  let flightIndex = 0;
  for (const seg of segments) {
    if (seg.kind === 'flight') {
      const development = flightDevelopment(seg, f.shape);
      const waistMesh = twoWayMesh(
        development.slopingLength,
        seg.width,
        f.cover,
        f.mainDia,
        f.mainSpacing,
        f.distDia,
        f.distSpacing,
      );
      const label = seg.label || `Flight ${flightIndex + 1}`;
      groups.push(
        {
          diameterMm: waistMesh.mainBars.diameterMm,
          weightKg: waistMesh.mainBars.weightKg,
          role: `${label} — Waist main mesh`,
        },
        {
          diameterMm: waistMesh.distBars.diameterMm,
          weightKg: waistMesh.distBars.weightKg,
          role: `${label} — Waist distribution mesh`,
        },
      );
      totalWeightKg += waistMesh.totalWeightKg;

      if (f.stringBeamCount > 0) {
        const stringBeams = stringBeamRebarFromBeams(development.slopingLength, f);
        for (const g of stringBeams.groups) {
          groups.push({
            ...g,
            role: `${label} — ${g.role}`,
          });
        }
        totalWeightKg += stringBeams.totalWeightKg;
      }
      flightIndex++;
    } else {
      const lq = calcLandingQuantities(seg, beamRebarCfg, 0);
      groups.push(...lq.stairBeamGroups);
      totalWeightKg += lq.stairBeamRebarKg;
    }
  }

  totalWeightKg = round(totalWeightKg);
  return {
    groups,
    totalWeightKg,
    densityKgPerM3: volumeM3 > 0 ? round(totalWeightKg / volumeM3) : 0,
  };
}

export function calcStair(f: StairInput): StructuralCalcResult & {
  stairBreakdown: StairBreakdown;
  /** Flattened for schedule columns (Assumption 2). */
  riserLm: number;
  sideLm: number;
} {
  const concrete = stairConcrete(f);
  const rebar = stairRebar(f, concrete.netVolumeM3);
  const base = withFormworkSplit({
    perUnit: { concrete, rebar },
    count: f.count || 1,
    volumeM3: concrete.netVolumeM3,
    soffitFormworkM2: concrete.breakdown.soffitFormwork || 0,
    verticalFormworkM2: concrete.breakdown.verticalFormwork || 0,
    rebarKg: rebar.totalWeightKg,
  });
  const n = f.count || 1;
  return {
    ...base,
    stairBreakdown: concrete.stairBreakdown,
    riserLm: round(concrete.stairBreakdown.riserLm * n),
    sideLm: round(concrete.stairBreakdown.sideLm * n),
  };
}

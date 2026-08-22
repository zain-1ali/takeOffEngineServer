/**
 * Map raw IfcBeam extruded geometry → BEAMS suggestion shape.
 * Suggestions only; never creates Instances.
 *
 * Shape is taken from the swept profile (IfcBeam.PredefinedType does not
 * encode Rectangular / T / L / Cantilever-tapered / Ground-tie).
 *
 * Two authoring orientations are mapped:
 * - Span sweep (IfcBeamStandardCase): extrusion along the span; section
 *   from the profile; span from Axis (or horizontal extrusion depth).
 * - Plan extrusion (ArchiCAD / generic IfcBeam): vertical extrusion of a
 *   horizontal rectangle; span/width from that plan, section depth from
 *   extrusion height. Same assignment as WALLS length/thickness.
 *
 * Unclassifiable sections are flagged for manual review — never forced
 * into a variant.
 *
 * Shared utilities:
 * - L/T/rectangle identification → ifcBeamProfile → ifcColumnProfile
 * - HIGH/MEDIUM/LOW thresholds & helpers → ifcConfidence
 *
 * Step 1 mapping plus persist / review / Accept wiring.
 */
import type {
  IfcParsedEntity,
  IfcRawAxisGeometry,
  IfcRawExtrusionGeometry,
} from './ifcImport';
import {
  addConfidenceNote,
  applyExtrusionConfidenceBasics,
  createConfidence,
  dimensionsAgreeWithin,
  isHorizontalExtrusion,
  isNearSquareProfile,
  isVerticalExtrusion,
  markConfidenceLow,
  markConfidenceMediumIfHigh,
  roundMetres3,
  type IfcConfidenceTier,
} from './ifcConfidence';
import {
  classifyBeamSectionProfile,
  type ClassifiedBeamSection,
} from './ifcBeamProfile';
import type { BeamShape } from '../engines/beams';

export type BeamIfcConfidence = IfcConfidenceTier;

export type BeamIfcSuggestion = {
  sourceGlobalId: string;
  expressId: number;
  elementKey: 'BEAMS';
  name: string | null;
  shape: BeamShape | null;
  geometry: Record<string, number> | null;
  confidence: BeamIfcConfidence;
  confidenceNotes: string[];
  needsManualReview: boolean;
};

const UNSUPPORTED_BEAM_NOTE =
  'Unsupported beam for automatic IFC import (Rectangular, T, L, Cantilever-tapered, Ground-tie only) — review manually';

const COMPLEX_SECTION_NOTE =
  'L/T classification is MEDIUM by default given the higher inference complexity';

const TAPER_NOTE =
  'Cantilever-tapered is MEDIUM — start/end section depths are inferred from IfcExtrudedAreaSolidTapered';

const GROUND_TIE_NOTE =
  'Ground-tie is MEDIUM — rectangular section; earth-supported soffit inferred from authoring label, not geometry';

const PLAN_EXTRUSION_NOTE =
  'Vertical extrusion of a horizontal (plan) profile — span/width from the plan rectangle, section depth from extrusion height';

function isLintelLabel(entity: IfcParsedEntity): boolean {
  if (entity.predefinedType === 'LINTEL') return true;
  const blob = `${entity.name || ''} ${entity.objectType || ''}`;
  return /\blintel\b/i.test(blob);
}

function isGroundTieLabel(entity: IfcParsedEntity): boolean {
  const blob = `${entity.name || ''} ${entity.objectType || ''} ${entity.predefinedType || ''}`;
  return /ground[\s._-]*tie|tie[\s._-]*beam/i.test(blob);
}

function geometryFromSection(
  classified: ClassifiedBeamSection,
  span: number,
): { shape: Extract<BeamShape, 'RECTANGULAR' | 'L_SECTION' | 'T_SECTION'>; geometry: Record<string, number> } {
  const spanLength = roundMetres3(span);
  if (classified.shape === 'RECTANGULAR') {
    return {
      shape: 'RECTANGULAR',
      geometry: {
        spanLength,
        width: roundMetres3(classified.width),
        depth: roundMetres3(classified.depth),
      },
    };
  }
  if (classified.shape === 'L_SECTION') {
    return {
      shape: 'L_SECTION',
      geometry: {
        spanLength,
        flangeWidth: roundMetres3(classified.flangeWidth),
        flangeThickness: roundMetres3(classified.flangeThickness),
        webWidth: roundMetres3(classified.webWidth),
        overallDepth: roundMetres3(classified.overallDepth),
      },
    };
  }
  return {
    shape: 'T_SECTION',
    geometry: {
      spanLength,
      flangeWidth: roundMetres3(classified.flangeWidth),
      flangeThickness: roundMetres3(classified.flangeThickness),
      webWidth: roundMetres3(classified.webWidth),
      overallDepth: roundMetres3(classified.overallDepth),
    },
  };
}

/**
 * Columns convention: XDim = width, YDim = depth. On a span sweep, override
 * when placement proves profile-X is world-vertical (then XDim is section
 * depth and YDim is width). Same rule as the tapered-rectangular path.
 */
function remapRectangularSectionAxes(
  classified: ClassifiedBeamSection,
  geom: IfcRawExtrusionGeometry,
  conf: ReturnType<typeof createConfidence>,
): ClassifiedBeamSection {
  if (classified.shape !== 'RECTANGULAR') return classified;
  const xIsUp = isVerticalExtrusion(geom.worldProfileX);
  const yIsUp = isVerticalExtrusion(geom.worldProfileY);
  const depthIsProfileX = xIsUp && !yIsUp;
  if (!xIsUp && !yIsUp && (geom.worldProfileX || geom.worldProfileY)) {
    addConfidenceNote(
      conf,
      'Profile axes are not world-vertical — assuming Columns XDim=width, YDim=depth',
    );
    return classified;
  }
  if (!depthIsProfileX) return classified;
  addConfidenceNote(
    conf,
    'Profile X is world-vertical — treating XDim as section depth (YDim as width)',
  );
  return {
    ...classified,
    width: classified.depth,
    depth: classified.width,
  };
}

function applySectionConfidence(
  conf: ReturnType<typeof createConfidence>,
  classified: ClassifiedBeamSection,
): void {
  if (classified.source === 'NATIVE_RECTANGLE') {
    addConfidenceNote(
      conf,
      `Native IfcRectangleProfileDef ${roundMetres3(classified.width)}×${roundMetres3(classified.depth)}m`,
    );
    return;
  }
  if (classified.source === 'ARBITRARY_RECTANGLE') {
    addConfidenceNote(
      conf,
      `IfcArbitraryClosedProfileDef boundary is rectangular; derived width=${roundMetres3(classified.width)}m and depth=${roundMetres3(classified.depth)}m`,
    );
    markConfidenceMediumIfHigh(
      conf,
      'Arbitrary-profile dimensions are inferred from the boundary polygon',
    );
    return;
  }
  if (classified.shape === 'L_SECTION') {
    addConfidenceNote(
      conf,
      classified.source === 'NATIVE_LSHAPE'
        ? `Native IfcLShapeProfileDef ${roundMetres3(classified.flangeWidth)}×${roundMetres3(classified.overallDepth)}×t=${roundMetres3(classified.flangeThickness)}m`
        : `IfcArbitraryClosedProfileDef classified as L-section (same 6-vertex / 1-concave rule as Columns); ${roundMetres3(classified.flangeWidth)}×${roundMetres3(classified.overallDepth)}×t=${roundMetres3(classified.flangeThickness)}m`,
    );
  } else {
    addConfidenceNote(
      conf,
      classified.source === 'NATIVE_TSHAPE'
        ? `Native IfcTShapeProfileDef flange ${roundMetres3(classified.flangeWidth)}m × depth ${roundMetres3(classified.overallDepth)}m`
        : 'IfcArbitraryClosedProfileDef classified as T-section (same 8-vertex / 2-concave rule as Columns)',
    );
  }
  markConfidenceMediumIfHigh(conf, COMPLEX_SECTION_NOTE);
}

function resolveSpan(
  conf: ReturnType<typeof createConfidence>,
  geom: IfcRawExtrusionGeometry,
  axis: IfcRawAxisGeometry | null,
  axisSkipReason: string | null,
): number | null {
  if (axis?.kind === 'CURVED') {
    markConfidenceLow(
      conf,
      `Curved Axis (radius ${roundMetres3(axis.radius)}m) is not a Beams span — engine is straight-span only`,
    );
    return null;
  }
  if (axis?.kind === 'LINEAR' && axis.length > 0) {
    addConfidenceNote(
      conf,
      `Straight Axis length ${roundMetres3(axis.length)}m used as span`,
    );
    if (
      isHorizontalExtrusion(geom.worldExtrusionDirection) &&
      geom.depth != null &&
      geom.depth > 0 &&
      !dimensionsAgreeWithin(axis.length, geom.depth)
    ) {
      markConfidenceMediumIfHigh(
        conf,
        `Axis length ${roundMetres3(axis.length)}m disagrees with extrusion depth ${roundMetres3(geom.depth)}m — span follows Axis`,
      );
    }
    return axis.length;
  }
  if (
    isHorizontalExtrusion(geom.worldExtrusionDirection) &&
    geom.depth != null &&
    geom.depth > 0
  ) {
    addConfidenceNote(
      conf,
      `${axisSkipReason || 'No Axis representation'} — using horizontal extrusion depth ${roundMetres3(geom.depth)}m as span`,
    );
    markConfidenceMediumIfHigh(conf);
    return geom.depth;
  }
  markConfidenceLow(
    conf,
    axisSkipReason
      ? `${axisSkipReason} — cannot derive a Beams span`
      : 'No Axis representation and extrusion is not along span — cannot derive a Beams span',
  );
  return null;
}

function isHorizontalProfilePlane(geom: IfcRawExtrusionGeometry): boolean {
  return (
    isHorizontalExtrusion(geom.worldProfileX) &&
    isHorizontalExtrusion(geom.worldProfileY)
  );
}

function finishRectangularBeam(
  base: Pick<
    BeamIfcSuggestion,
    'sourceGlobalId' | 'expressId' | 'elementKey' | 'name'
  >,
  conf: ReturnType<typeof createConfidence>,
  geometry: Record<string, number>,
  entity: IfcParsedEntity,
): BeamIfcSuggestion {
  if (isGroundTieLabel(entity)) {
    addConfidenceNote(conf, GROUND_TIE_NOTE);
    markConfidenceMediumIfHigh(conf);
    return {
      ...base,
      shape: 'GROUND_TIE',
      geometry,
      confidence: conf.confidence,
      confidenceNotes: conf.notes,
      needsManualReview: conf.needsManualReview,
    };
  }
  return {
    ...base,
    shape: 'RECTANGULAR',
    geometry,
    confidence: conf.confidence,
    confidenceNotes: conf.notes,
    needsManualReview: conf.needsManualReview,
  };
}

/**
 * ArchiCAD / generic IfcBeam: Body is a vertical extrusion of a plan
 * rectangle (same orientation as WALLS). Span and width are the plan
 * sides; section depth is the extrusion height. L/T in plan is a bent
 * footprint, not a Beams L/T section.
 */
function mapVerticalPlanBeam(
  base: Pick<
    BeamIfcSuggestion,
    'sourceGlobalId' | 'expressId' | 'elementKey' | 'name'
  >,
  geom: IfcRawExtrusionGeometry,
  axis: IfcParsedEntity['axisGeometry'],
  axisSkipReason: string | null,
  entity: IfcParsedEntity,
  conf: ReturnType<typeof createConfidence>,
): BeamIfcSuggestion {
  if (
    geom.representationKind === 'IfcExtrudedAreaSolidTapered' ||
    geom.endProfile
  ) {
    markConfidenceLow(
      conf,
      'Tapered vertical (plan) extrusion is not a Beams cantilever — review manually',
    );
    addConfidenceNote(conf, UNSUPPORTED_BEAM_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }

  const classified = classifyBeamSectionProfile(geom.profile);
  if (!classified.ok || classified.shape !== 'RECTANGULAR') {
    markConfidenceLow(
      conf,
      !classified.ok
        ? classified.reason
        : 'Plan-footprint L/T is not a Beams L/T section — review manually',
    );
    addConfidenceNote(conf, UNSUPPORTED_BEAM_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }

  addConfidenceNote(conf, PLAN_EXTRUSION_NOTE);
  markConfidenceMediumIfHigh(conf);

  const xDim = classified.width;
  const yDim = classified.depth;
  if (classified.source === 'ARBITRARY_RECTANGLE') {
    addConfidenceNote(
      conf,
      `IfcArbitraryClosedProfileDef plan rectangle ${roundMetres3(xDim)}×${roundMetres3(yDim)}m; extrusion ${roundMetres3(geom.depth!)}m as section depth`,
    );
    markConfidenceMediumIfHigh(
      conf,
      'Arbitrary-profile dimensions are inferred from the boundary polygon',
    );
  } else {
    addConfidenceNote(
      conf,
      `Native IfcRectangleProfileDef plan ${roundMetres3(xDim)}×${roundMetres3(yDim)}m; extrusion ${roundMetres3(geom.depth!)}m as section depth`,
    );
  }

  if (isNearSquareProfile(xDim, yDim)) {
    markConfidenceLow(
      conf,
      'Plan profile is nearly square — span vs width ambiguous',
    );
  }

  let span: number;
  let width: number;
  if (axis?.kind === 'CURVED') {
    markConfidenceLow(
      conf,
      `Curved Axis (radius ${roundMetres3(axis.radius)}m) is not a Beams span — engine is straight-span only`,
    );
    addConfidenceNote(conf, UNSUPPORTED_BEAM_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }
  if (axis?.kind === 'LINEAR' && axis.length > 0) {
    span = axis.length;
    const xMatches = dimensionsAgreeWithin(xDim, span);
    const yMatches = dimensionsAgreeWithin(yDim, span);
    if (xMatches !== yMatches) {
      width = xMatches ? yDim : xDim;
      addConfidenceNote(
        conf,
        `Straight Axis length ${roundMetres3(span)}m agrees with ${xMatches ? 'XDim' : 'YDim'}; width uses the orthogonal plan dimension`,
      );
    } else {
      width = Math.min(xDim, yDim);
      markConfidenceLow(
        conf,
        xMatches
          ? 'Both plan dimensions match Axis length — width is ambiguous'
          : `Axis length ${roundMetres3(span)}m conflicts with plan ${roundMetres3(xDim)}×${roundMetres3(yDim)}m`,
      );
    }
  } else {
    span = Math.max(xDim, yDim);
    width = Math.min(xDim, yDim);
    addConfidenceNote(
      conf,
      `${axisSkipReason || 'No Axis representation'} — using larger plan dimension as span and smaller as width`,
    );
    markConfidenceMediumIfHigh(conf);
  }

  return finishRectangularBeam(
    base,
    conf,
    {
      spanLength: roundMetres3(span),
      width: roundMetres3(width),
      depth: roundMetres3(geom.depth!),
    },
    entity,
  );
}

function mapTaperedRectangular(
  conf: ReturnType<typeof createConfidence>,
  geom: IfcRawExtrusionGeometry,
  span: number,
): BeamIfcSuggestion['geometry'] | 'not-tapered' | 'failed' {
  const taperedKind =
    geom.representationKind === 'IfcExtrudedAreaSolidTapered';
  if (!geom.endProfile) {
    if (taperedKind) {
      markConfidenceLow(
        conf,
        'IfcExtrudedAreaSolidTapered is missing EndSweptArea — cannot prove constant vs tapered section',
      );
      return 'failed';
    }
    return 'not-tapered';
  }

  const start = classifyBeamSectionProfile(geom.profile);
  const end = classifyBeamSectionProfile(geom.endProfile);
  if (!start.ok || !end.ok) {
    markConfidenceLow(
      conf,
      !start.ok ? start.reason : end.reason,
    );
    addConfidenceNote(
      conf,
      'Tapered extrusion end profile could not be classified as a constant Beams section',
    );
    return 'failed';
  }
  if (start.shape !== 'RECTANGULAR' || end.shape !== 'RECTANGULAR') {
    if (
      start.shape !== 'RECTANGULAR' &&
      end.shape !== 'RECTANGULAR' &&
      start.shape === end.shape &&
      dimensionsAgreeWithin(start.flangeWidth, end.flangeWidth) &&
      dimensionsAgreeWithin(start.overallDepth, end.overallDepth) &&
      dimensionsAgreeWithin(start.flangeThickness, end.flangeThickness) &&
      dimensionsAgreeWithin(start.webWidth, end.webWidth)
    ) {
      addConfidenceNote(
        conf,
        'IfcExtrudedAreaSolidTapered start/end L/T sections agree — treating as constant section',
      );
      return 'not-tapered';
    }
    markConfidenceLow(
      conf,
      'Tapered L/T extrusions are not auto-mapped — only rectangular depth taper → Cantilever-tapered',
    );
    return 'failed';
  }

  const xIsUp = isVerticalExtrusion(geom.worldProfileX);
  const yIsUp = isVerticalExtrusion(geom.worldProfileY);
  // Columns convention: XDim = width, YDim = depth. Override only when
  // placement proves profile-X is world-vertical (Y then is width).
  const depthIsProfileX = xIsUp && !yIsUp;
  if (!xIsUp && !yIsUp && (geom.worldProfileX || geom.worldProfileY)) {
    addConfidenceNote(
      conf,
      'Profile axes are not world-vertical — assuming Columns XDim=width, YDim=depth',
    );
  } else if (depthIsProfileX) {
    addConfidenceNote(
      conf,
      'Profile X is world-vertical — treating XDim as section depth (YDim as width)',
    );
  }

  const startWidth = depthIsProfileX ? start.depth : start.width;
  const startDepth = depthIsProfileX ? start.width : start.depth;
  const endWidth = depthIsProfileX ? end.depth : end.width;
  const endDepth = depthIsProfileX ? end.width : end.depth;

  const widthAgrees = dimensionsAgreeWithin(startWidth, endWidth);
  const depthAgrees = dimensionsAgreeWithin(startDepth, endDepth);

  let width: number;
  let startSectionDepth: number;
  let endSectionDepth: number;
  if (widthAgrees && !depthAgrees) {
    width = startWidth;
    startSectionDepth = startDepth;
    endSectionDepth = endDepth;
  } else if (widthAgrees && depthAgrees) {
    addConfidenceNote(
      conf,
      'IfcExtrudedAreaSolidTapered start/end depths agree — treating as constant section',
    );
    return 'not-tapered';
  } else if (depthAgrees && !widthAgrees) {
    markConfidenceLow(
      conf,
      `Tapered beam changes width (${roundMetres3(startWidth)}m → ${roundMetres3(endWidth)}m) with constant depth — Cantilever-tapered is depth-only, not a plan taper`,
    );
    return 'failed';
  } else {
    markConfidenceLow(
      conf,
      `Tapered beam changes both profile dims (${roundMetres3(start.width)}×${roundMetres3(start.depth)}m → ${roundMetres3(end.width)}×${roundMetres3(end.depth)}m) — Cantilever-tapered is depth-only`,
    );
    return 'failed';
  }

  const supportDepth = Math.max(startSectionDepth, endSectionDepth);
  const tipDepth = Math.min(startSectionDepth, endSectionDepth);
  addConfidenceNote(
    conf,
    `IfcExtrudedAreaSolidTapered: support D=${roundMetres3(supportDepth)}m, tip D=${roundMetres3(tipDepth)}m, W=${roundMetres3(width)}m`,
  );
  markConfidenceMediumIfHigh(conf, TAPER_NOTE);
  return {
    spanLength: roundMetres3(span),
    width: roundMetres3(width),
    supportDepth: roundMetres3(supportDepth),
    tipDepth: roundMetres3(tipDepth),
  };
}

/**
 * Map one parsed IFC beam entity to a BEAMS suggestion.
 * Returns null only when the entity is not a beam.
 */
export function mapIfcBeamToSuggestion(
  entity: IfcParsedEntity,
): BeamIfcSuggestion | null {
  if (entity.entityType !== 'IfcBeam') return null;

  const base = {
    sourceGlobalId: entity.globalId,
    expressId: entity.expressId,
    elementKey: 'BEAMS' as const,
    name: entity.name,
  };

  if (isLintelLabel(entity)) {
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: [
        'IfcBeam labelled as a lintel — lintels are a separate element, not auto-mapped to Beams',
      ],
      needsManualReview: true,
    };
  }

  if (!entity.geometryOk || !entity.geometry) {
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: [
        entity.skipReason || 'Geometry was not a simple IfcExtrudedAreaSolid',
        UNSUPPORTED_BEAM_NOTE,
      ],
      needsManualReview: true,
    };
  }

  return mapExtrudedBeam(
    base,
    entity.geometry,
    entity.axisGeometry,
    entity.axisSkipReason,
    entity,
  );
}

function mapExtrudedBeam(
  base: Pick<
    BeamIfcSuggestion,
    'sourceGlobalId' | 'expressId' | 'elementKey' | 'name'
  >,
  geom: IfcRawExtrusionGeometry,
  axis: IfcParsedEntity['axisGeometry'],
  axisSkipReason: string | null,
  entity: IfcParsedEntity,
): BeamIfcSuggestion {
  const depth = geom.depth;
  if (depth == null || !(depth > 0)) {
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: ['Missing or non-positive extrusion depth (span/height)'],
      needsManualReview: true,
    };
  }

  const conf = createConfidence([
    geom.representationKind === 'IfcExtrudedAreaSolidTapered'
      ? 'IfcExtrudedAreaSolidTapered'
      : 'IfcExtrudedAreaSolid',
    'Beam mapping',
  ]);
  applyExtrusionConfidenceBasics(conf, {
    depth,
    lengthUnitKnown: geom.lengthUnitKnown,
    worldExtrusionDirection: geom.worldExtrusionDirection,
    positionAxis: geom.solidPosition?.axis ?? null,
    requireVerticalExtrusion: false,
  });

  const worldDir = geom.worldExtrusionDirection;
  if (isHorizontalExtrusion(worldDir)) {
    addConfidenceNote(
      conf,
      'Horizontal world extrusion — treated as sweep along span',
    );
  } else if (worldDir && !isVerticalExtrusion(worldDir)) {
    markConfidenceMediumIfHigh(
      conf,
      'World extrusion is neither horizontal nor vertical — possible raked beam, review span',
    );
  }

  if (
    geom.bodyItemCount !== 1 ||
    geom.bodyItemTypes?.length !== 1 ||
    (geom.bodyItemTypes[0] !== 'IfcExtrudedAreaSolid' &&
      geom.bodyItemTypes[0] !== 'IfcExtrudedAreaSolidTapered')
  ) {
    markConfidenceLow(
      conf,
      geom.bodyItemCount == null
        ? 'Body item count is unavailable — cannot prove a single uniform beam extrusion'
        : `Body contains ${geom.bodyItemCount} items (${(geom.bodyItemTypes || []).join(', ') || 'types unavailable'}) — cannot prove uniform beam geometry`,
    );
    addConfidenceNote(conf, UNSUPPORTED_BEAM_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }

  if (isVerticalExtrusion(worldDir) && isHorizontalProfilePlane(geom)) {
    return mapVerticalPlanBeam(
      base,
      geom,
      axis,
      axisSkipReason,
      entity,
      conf,
    );
  }
  if (isVerticalExtrusion(worldDir)) {
    markConfidenceLow(
      conf,
      'World extrusion direction is vertical but the profile plane is not horizontal — not a span sweep or a plan-footprint beam; review manually',
    );
    addConfidenceNote(conf, UNSUPPORTED_BEAM_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }

  const span = resolveSpan(conf, geom, axis, axisSkipReason);
  if (span == null || !(span > 0) || conf.confidence === 'LOW') {
    if (span == null) addConfidenceNote(conf, UNSUPPORTED_BEAM_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }

  const tapered = mapTaperedRectangular(conf, geom, span);
  if (tapered === 'failed' || conf.confidence === 'LOW') {
    addConfidenceNote(conf, UNSUPPORTED_BEAM_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }
  if (tapered !== 'not-tapered') {
    return {
      ...base,
      shape: 'CANTILEVER_TAPERED',
      geometry: tapered,
      confidence: conf.confidence,
      confidenceNotes: conf.notes,
      needsManualReview: conf.needsManualReview,
    };
  }

  const classified = classifyBeamSectionProfile(geom.profile);
  if (!classified.ok) {
    markConfidenceLow(conf, classified.reason);
    addConfidenceNote(conf, UNSUPPORTED_BEAM_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }

  applySectionConfidence(conf, classified);
  const section = remapRectangularSectionAxes(classified, geom, conf);
  const mapped = geometryFromSection(section, span);

  if (mapped.shape === 'RECTANGULAR') {
    return finishRectangularBeam(base, conf, mapped.geometry, entity);
  }

  return {
    ...base,
    shape: mapped.shape,
    geometry: mapped.geometry,
    confidence: conf.confidence,
    confidenceNotes: conf.notes,
    needsManualReview: conf.needsManualReview,
  };
}

export function mapIfcBeamsToSuggestions(
  entities: IfcParsedEntity[],
): BeamIfcSuggestion[] {
  return entities
    .map(mapIfcBeamToSuggestion)
    .filter((row): row is BeamIfcSuggestion => row != null);
}

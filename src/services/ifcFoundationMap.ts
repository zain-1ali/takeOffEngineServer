/**
 * Map raw IfcFooting extruded geometry → Pad / Strip / Pile Cap suggestions.
 * Suggestions only; never creates Instances.
 *
 * Primary signal: IfcFooting.PredefinedType
 *   PAD_FOOTING  → PAD_FOOTING RECTANGULAR
 *   STRIP_FOOTING → STRIP_FOOTING FLAT
 *   PILE_CAP     → PILE_CAP RECTANGULAR (pileCount is not in IFC geometry)
 *   Other / USERDEFINED / NOTDEFINED / missing → geometric inference
 *   (aspect + footprint), or flag for manual review.
 *
 * Permanent exclusions (not future gaps): stepped/sloped pad, tapered/stepped
 * strip, and non-rectangular pile-cap shapes are never auto-mapped — same
 * policy as Slabs (Waffle / Drop-panel). Multi-body or non-rect profiles are
 * flagged for manual review instead of force-mapping.
 *
 * Raft Foundation is NOT mapped this round. Real-file evidence:
 *   - IFC2x3/IFC4 IfcFootingTypeEnum has no RAFT token. buildingSMART says
 *     slab-on-grade / slab foundations are IfcSlab BASESLAB, not IfcFooting.
 *   - ArchiCAD FZK-Haus: IfcSlab "Bodenplatte" .BASESLAB. 12×10×0.2 m —
 *     flagged as possible raft vs on-grade slab; not auto-mapped to RAFT.
 *   - Revit Duplex: 7× IfcFooting, all .STRIP_FOOTING. wall footings.
 *   - Tekla M3D-CON (ISSUE_102_M3D-CON.ifc, Tekla Structures 2020): 6×
 *     IfcFooting .NOTDEFINED. FacetedBrep. Labels are Spanish *zapata*
 *     (pad footing): ZAP-E2a "Zapata Central" 10.75×11.9×2.1 m, ZAP-E2b
 *     "Zapata Aleta" trapezoid TRPZL 7.8×14.9×10.4 m. These are oversized
 *     isolated/winged pads, not a building raft — do not auto-map as RAFT.
 *
 * Shared utilities:
 * - rectangle / arbitrary-polygon profile → ifcRectangleProfile
 * - HIGH/MEDIUM/LOW thresholds & helpers → ifcConfidence
 */
import type { IfcParsedEntity, IfcRawExtrusionGeometry } from './ifcImport';
import { normalizeIfcPredefinedType } from './ifcImport';
import {
  addConfidenceNote,
  applyExtrusionConfidenceBasics,
  createConfidence,
  markConfidenceLow,
    markConfidenceMediumIfHigh,
    roundMetres3,
    type IfcConfidenceTier,
} from './ifcConfidence';
import { resolveRectangleProfileDims } from './ifcRectangleProfile';

export type FoundationIfcConfidence = IfcConfidenceTier;

export type FoundationElementKey = 'PAD_FOOTING' | 'STRIP_FOOTING' | 'PILE_CAP';

export type FoundationIfcSuggestion = {
  sourceGlobalId: string;
  expressId: number;
  elementKey: FoundationElementKey | null;
  name: string | null;
  shape: 'RECTANGULAR' | 'FLAT' | null;
  geometry: Record<string, number> | null;
  confidence: FoundationIfcConfidence;
  confidenceNotes: string[];
  needsManualReview: boolean;
  predefinedType: string | null;
  mappingSource: 'PREDEFINED_TYPE' | 'GEOMETRIC_INFERENCE' | null;
};

const UNSUPPORTED_FOUNDATION_NOTE =
  'Unsupported shape for automatic IFC import (rectangular Pad / flat Strip / rectangular Pile Cap only) — review manually. Stepped, sloped, tapered, and non-rectangular pile-cap shapes are permanent exclusions.';

/** Foundations sit horizontal like Flat slabs; 0.999 allows only placement noise. */
const FOUNDATION_VERTICAL_DOT_MIN = 0.999;

/** Longer/shorter ≥ this is a strip-like footprint (same spirit as Walls). */
const STRIP_ASPECT_MIN = 3;
/** Pad schema plan max (m); compact footprints at or below this infer as pad. */
const PAD_MAX_PLAN_M = 6;
/** Strip schema width max (m). */
const STRIP_MAX_WIDTH_M = 3;

const PILE_COUNT_NOTE =
  'Pile count is not present in IfcFooting geometry — set Piles before accepting';

/** Oversized compact IfcFooting is not identified as a raft in test files. */
export const LARGE_UNTYPED_FOOTING_NOTE =
  'Oversized compact IfcFooting — review manually (not auto-mapped as Pad, Strip, or Raft)';

/** Official IFC4 tokens we do not auto-map (no matching Takeoff element). */
const UNSUPPORTED_TYPED_FOOTINGS = new Set([
  'FOOTING_BEAM',
  'CAISSON_FOUNDATION',
]);

export function footingPredefinedType(
  entity: Pick<IfcParsedEntity, 'predefinedType'>,
): string | null {
  return normalizeIfcPredefinedType(entity.predefinedType ?? null);
}

function kindFromPredefinedType(
  predefinedType: string | null,
): FoundationElementKey | null {
  if (predefinedType === 'PAD_FOOTING') return 'PAD_FOOTING';
  if (predefinedType === 'STRIP_FOOTING') return 'STRIP_FOOTING';
  if (predefinedType === 'PILE_CAP') return 'PILE_CAP';
  return null;
}

/**
 * Best-effort plan dims from authoring labels (Tekla `10750*11900` millimetres,
 * or `TRPZL7800*14885.58*10382.26`). Used only to flag oversized compact B-rep
 * footings for review — never to auto-map Pad / Strip / Raft.
 */
export function parsePlanDimsFromLabel(
  label: string | null | undefined,
): { xDim: number; yDim: number } | null {
  if (!label) return null;
  const nums = [...label.matchAll(/(\d+(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0);
  if (nums.length < 2) return null;
  const sorted = [...nums].sort((a, b) => b - a);
  let xDim = sorted[0];
  let yDim = sorted[1];
  if (xDim > 50 && yDim > 50) {
    xDim /= 1000;
    yDim /= 1000;
  }
  if (!(xDim > 0 && yDim > 0)) return null;
  return { xDim, yDim };
}

function oversizedFromLabels(
  entity: Pick<IfcParsedEntity, 'objectType' | 'name'>,
): boolean {
  const dims =
    parsePlanDimsFromLabel(entity.objectType) ||
    parsePlanDimsFromLabel(entity.name);
  if (!dims) return false;
  return inferFoundationKindFromPlan(dims.xDim, dims.yDim).oversizedCompact;
}

function planLengthWidth(
  xDim: number,
  yDim: number,
  kind: FoundationElementKey,
): { length: number; width: number } {
  if (kind === 'STRIP_FOOTING') {
    return {
      length: roundMetres3(Math.max(xDim, yDim)),
      width: roundMetres3(Math.min(xDim, yDim)),
    };
  }
  return { length: roundMetres3(xDim), width: roundMetres3(yDim) };
}

/**
 * Geometric inference when PredefinedType is missing / USERDEFINED / NOTDEFINED.
 * Never infers Pile Cap (pile count cannot be recovered from the solid).
 */
export function inferFoundationKindFromPlan(
  xDim: number,
  yDim: number,
): {
  kind: FoundationElementKey | null;
  oversizedCompact: boolean;
  note: string;
} {
  const longer = Math.max(xDim, yDim);
  const shorter = Math.min(xDim, yDim);
  const aspect = shorter > 0 ? longer / shorter : Number.POSITIVE_INFINITY;

  if (aspect >= STRIP_ASPECT_MIN && shorter <= STRIP_MAX_WIDTH_M) {
    return {
      kind: 'STRIP_FOOTING',
      oversizedCompact: false,
      note:
        `Geometric inference: aspect ${roundMetres3(aspect)} and width ${roundMetres3(shorter)}m → Strip Foundation`,
    };
  }
  if (longer <= PAD_MAX_PLAN_M && aspect < STRIP_ASPECT_MIN) {
    return {
      kind: 'PAD_FOOTING',
      oversizedCompact: false,
      note:
        `Geometric inference: compact footprint ${roundMetres3(longer)}×${roundMetres3(shorter)}m → Pad Foundation`,
    };
  }
  if (aspect < STRIP_ASPECT_MIN && longer > PAD_MAX_PLAN_M) {
    return {
      kind: null,
      oversizedCompact: true,
      note: LARGE_UNTYPED_FOOTING_NOTE,
    };
  }
  return {
    kind: null,
    oversizedCompact: false,
    note:
      'Footprint is ambiguous for Pad / Strip / Pile Cap — review manually',
  };
}

/**
 * Map one parsed IFC footing entity to a foundation suggestion.
 * Returns null only when the entity is not a footing.
 */
export function mapIfcFootingToSuggestion(
  entity: IfcParsedEntity,
): FoundationIfcSuggestion | null {
  if (entity.entityType !== 'IfcFooting') return null;

  const predefinedType = footingPredefinedType(entity);
  const base = {
    sourceGlobalId: entity.globalId,
    expressId: entity.expressId,
    name: entity.name,
    predefinedType,
  };

  if (predefinedType && UNSUPPORTED_TYPED_FOOTINGS.has(predefinedType)) {
    return {
      ...base,
      elementKey: null,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: [
        `IfcFooting PredefinedType=${predefinedType} is not auto-mapped — review manually`,
      ],
      needsManualReview: true,
      mappingSource: 'PREDEFINED_TYPE',
    };
  }

  if (!entity.geometryOk || !entity.geometry) {
    const confidenceNotes = [
      entity.skipReason || 'Geometry was not a simple IfcExtrudedAreaSolid',
      UNSUPPORTED_FOUNDATION_NOTE,
    ];
    if (oversizedFromLabels(entity)) {
      confidenceNotes.push(LARGE_UNTYPED_FOOTING_NOTE);
    }
    return {
      ...base,
      elementKey: kindFromPredefinedType(predefinedType),
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes,
      needsManualReview: true,
      mappingSource: kindFromPredefinedType(predefinedType)
        ? 'PREDEFINED_TYPE'
        : null,
    };
  }

  return mapExtrudedFoundation(base, entity.geometry, predefinedType);
}

function mapExtrudedFoundation(
  base: Pick<
    FoundationIfcSuggestion,
    'sourceGlobalId' | 'expressId' | 'name' | 'predefinedType'
  >,
  geom: IfcRawExtrusionGeometry,
  predefinedType: string | null,
): FoundationIfcSuggestion {
  const depth = geom.depth;
  if (depth == null || !(depth > 0)) {
    return {
      ...base,
      elementKey: kindFromPredefinedType(predefinedType),
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: [
        'Missing or non-positive extrusion depth (thickness/height)',
      ],
      needsManualReview: true,
      mappingSource: kindFromPredefinedType(predefinedType)
        ? 'PREDEFINED_TYPE'
        : null,
    };
  }

  const conf = createConfidence(['IfcExtrudedAreaSolid', 'Foundation mapping']);
  const typedKind = kindFromPredefinedType(predefinedType);
  if (predefinedType) {
    addConfidenceNote(conf, `IfcFooting PredefinedType=${predefinedType}`);
  } else {
    addConfidenceNote(conf, 'IfcFooting PredefinedType is missing');
  }

  const extrusion = applyExtrusionConfidenceBasics(conf, {
    depth,
    lengthUnitKnown: geom.lengthUnitKnown,
    worldExtrusionDirection: geom.worldExtrusionDirection,
    positionAxis: geom.solidPosition?.axis ?? null,
    requireVerticalExtrusion: true,
    verticalDotMin: FOUNDATION_VERTICAL_DOT_MIN,
    nonVerticalNote:
      'World extrusion direction is not a horizontal foundation within the orientation tolerance — ' +
      UNSUPPORTED_FOUNDATION_NOTE,
    tiltedPositionNote:
      'Possible sloped/tilted geometry: swept-solid Position.Axis is tilted despite a vertical world extrusion — review manually; ' +
      UNSUPPORTED_FOUNDATION_NOTE,
  });

  if (!extrusion.orientationOk) {
    return {
      ...base,
      elementKey: typedKind,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
      mappingSource: typedKind ? 'PREDEFINED_TYPE' : null,
    };
  }
  addConfidenceNote(conf, 'Horizontal foundation extrusion orientation');

  if (
    geom.bodyItemCount !== 1 ||
    geom.bodyItemTypes?.length !== 1 ||
    geom.bodyItemTypes[0] !== 'IfcExtrudedAreaSolid'
  ) {
    markConfidenceLow(
      conf,
      geom.bodyItemCount == null
        ? 'Body item count is unavailable — cannot prove a single uniform foundation extrusion'
        : `Body contains ${geom.bodyItemCount} items (${(geom.bodyItemTypes || []).join(', ') || 'types unavailable'}) — cannot prove uniform rectangular foundation geometry`,
    );
    addConfidenceNote(conf, UNSUPPORTED_FOUNDATION_NOTE);
    return {
      ...base,
      elementKey: typedKind,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
      mappingSource: typedKind ? 'PREDEFINED_TYPE' : null,
    };
  }

  const resolved = resolveRectangleProfileDims(geom.profile);
  if (!resolved.ok) {
    markConfidenceLow(
      conf,
      resolved.unsupportedNote ||
        'Profile is not a rectangle within the 5% tolerance',
    );
    addConfidenceNote(conf, UNSUPPORTED_FOUNDATION_NOTE);
    return {
      ...base,
      elementKey: typedKind,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
      mappingSource: typedKind ? 'PREDEFINED_TYPE' : null,
    };
  }

  const xDim = resolved.xDim!;
  const yDim = resolved.yDim!;
  if (resolved.derivedFromArbitrary) {
    addConfidenceNote(
      conf,
      `IfcArbitraryClosedProfileDef boundary is rectangular; derived XDim=${roundMetres3(xDim)}m and YDim=${roundMetres3(yDim)}m`,
    );
    markConfidenceMediumIfHigh(
      conf,
      'Dimensions were inferred from an arbitrary polygon rather than explicit XDim/YDim',
    );
  } else {
    addConfidenceNote(
      conf,
      `IfcRectangleProfileDef XDim=${roundMetres3(xDim)}m YDim=${roundMetres3(yDim)}m`,
    );
  }

  let kind = typedKind;
  let mappingSource: FoundationIfcSuggestion['mappingSource'] = typedKind
    ? 'PREDEFINED_TYPE'
    : null;

  if (!kind) {
    const inferred = inferFoundationKindFromPlan(xDim, yDim);
    if (!inferred.kind) {
      markConfidenceLow(conf, inferred.note);
      return {
        ...base,
        elementKey: null,
        shape: null,
        geometry: null,
        confidence: 'LOW',
        confidenceNotes: conf.notes,
        needsManualReview: true,
        mappingSource: null,
      };
    }
    addConfidenceNote(conf, inferred.note);
    kind = inferred.kind;
    mappingSource = 'GEOMETRIC_INFERENCE';
    markConfidenceMediumIfHigh(
      conf,
      'Element type was inferred from footprint geometry rather than PredefinedType',
    );
  }

  const { length, width } = planLengthWidth(xDim, yDim, kind);
  const depthM = roundMetres3(depth);

  let shape: FoundationIfcSuggestion['shape'] = null;
  let geometry: Record<string, number> | null = null;

  if (kind === 'PAD_FOOTING') {
    shape = 'RECTANGULAR';
    geometry = { length, width, baseThickness: depthM };
    addConfidenceNote(
      conf,
      `Pad RECTANGULAR: length=${length}m, width=${width}m, baseThickness=depth=${depthM}m`,
    );
  } else if (kind === 'STRIP_FOOTING') {
    shape = 'FLAT';
    geometry = { length, width, height: depthM };
    addConfidenceNote(
      conf,
      `Strip FLAT: length=${length}m, width=${width}m, height=depth=${depthM}m`,
    );
  } else {
    shape = 'RECTANGULAR';
    geometry = { length, width, thickness: depthM };
    addConfidenceNote(
      conf,
      `Pile Cap RECTANGULAR: length=${length}m, width=${width}m, thickness=depth=${depthM}m`,
    );
    markConfidenceMediumIfHigh(conf, PILE_COUNT_NOTE);
    conf.needsManualReview = true;
  }

  if (kind === 'PAD_FOOTING' && Math.max(length, width) > PAD_MAX_PLAN_M) {
    markConfidenceMediumIfHigh(
      conf,
      `Plan dimension exceeds typical pad range (${PAD_MAX_PLAN_M}m) — review`,
    );
  }

  if (conf.confidence === 'HIGH') {
    addConfidenceNote(
      conf,
      `Clean rectangular plan with vertical extrusion — HIGH confidence ${kind}`,
    );
  }

  return {
    ...base,
    elementKey: kind,
    shape,
    geometry,
    confidence: conf.confidence,
    confidenceNotes: conf.notes,
    needsManualReview: conf.needsManualReview,
    mappingSource,
  };
}

/** Map all footing entities from a parse result. */
export function mapIfcFootingsToSuggestions(
  entities: IfcParsedEntity[],
): FoundationIfcSuggestion[] {
  const out: FoundationIfcSuggestion[] = [];
  for (const e of entities) {
    const s = mapIfcFootingToSuggestion(e);
    if (s) out.push(s);
  }
  return out;
}

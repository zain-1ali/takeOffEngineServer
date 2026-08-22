/**
 * Map raw IfcSlab extruded geometry → SLABS Flat suggestion shape.
 * Suggestions only; never creates Instances.
 *
 * Permanent exclusions (not future gaps): Sloped, Waffle, and Drop-panel are
 * never auto-mapped — too structurally specific to infer reliably from generic
 * IFC geometry. Non-flat signals (non-vertical extrusion / non-uniform body)
 * are flagged for manual review instead of force-mapping to Flat.
 *
 * Shared utilities:
 * - rectangle / arbitrary-polygon profile → ifcRectangleProfile
 * - HIGH/MEDIUM/LOW thresholds & helpers → ifcConfidence
 * Floor/storey matching lives in ifcFloorMatch (used by ifcBuildSuggestions).
 */
import type { IfcParsedEntity, IfcRawExtrusionGeometry } from './ifcImport';
import { normalizeIfcPredefinedType } from './ifcImport';
import {
  addConfidenceNote,
  applyExtrusionConfidenceBasics,
  createConfidence,
  markConfidenceLow,
  markConfidenceMediumIfHigh,
  POSSIBLE_RAFT_FOUNDATION_NOTE,
  roundMetres3,
  type IfcConfidenceTier,
} from './ifcConfidence';
import { resolveRectangleProfileDims } from './ifcRectangleProfile';

export type SlabIfcConfidence = IfcConfidenceTier;

/** Flat-only auto-import; other shapes stay unsupported. */
export type SlabIfcSuggestion = {
  sourceGlobalId: string;
  expressId: number;
  elementKey: 'SLABS';
  name: string | null;
  shape: 'FLAT' | null;
  geometry: {
    length: number;
    width: number;
    thickness: number;
  } | null;
  confidence: SlabIfcConfidence;
  confidenceNotes: string[];
  needsManualReview: boolean;
};

const UNSUPPORTED_FLAT_NOTE =
  'Unsupported shape for automatic IFC import (Flat only) — review manually. Sloped, Waffle, and Drop-panel are permanent exclusions.';
/** Flat slabs must be horizontal; 0.999 allows only placement noise (~2.6°). */
const FLAT_SLAB_VERTICAL_DOT_MIN = 0.999;

/**
 * Map one parsed IFC slab entity to a SLABS Flat suggestion.
 * Returns null only when the entity is not a slab.
 */
export function mapIfcSlabToSuggestion(
  entity: IfcParsedEntity,
): SlabIfcSuggestion | null {
  if (entity.entityType !== 'IfcSlab') return null;

  const base = {
    sourceGlobalId: entity.globalId,
    expressId: entity.expressId,
    elementKey: 'SLABS' as const,
    name: entity.name,
  };

  const predefinedType = normalizeIfcPredefinedType(
    entity.predefinedType ?? null,
  );
  const baseSlabRaftNotes =
    predefinedType === 'BASESLAB' ? [POSSIBLE_RAFT_FOUNDATION_NOTE] : [];

  if (!entity.geometryOk || !entity.geometry) {
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: [
        entity.skipReason || 'Geometry was not a simple IfcExtrudedAreaSolid',
        UNSUPPORTED_FLAT_NOTE,
        ...baseSlabRaftNotes,
      ],
      needsManualReview: true,
    };
  }

  const mapped = mapExtrudedFlatSlab(base, entity.geometry);
  if (predefinedType === 'BASESLAB') {
    mapped.confidenceNotes = [
      ...mapped.confidenceNotes,
      POSSIBLE_RAFT_FOUNDATION_NOTE,
    ];
    mapped.needsManualReview = true;
    if (mapped.confidence === 'HIGH') mapped.confidence = 'MEDIUM';
  }
  return mapped;
}

function mapExtrudedFlatSlab(
  base: Pick<
    SlabIfcSuggestion,
    'sourceGlobalId' | 'expressId' | 'elementKey' | 'name'
  >,
  geom: IfcRawExtrusionGeometry,
): SlabIfcSuggestion {
  // Match Walls: missing depth is a lone note (no seed notes).
  const depth = geom.depth;
  if (depth == null || !(depth > 0)) {
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: [
        'Missing or non-positive extrusion depth (thickness)',
      ],
      needsManualReview: true,
    };
  }

  const conf = createConfidence(['IfcExtrudedAreaSolid', 'Flat slab mapping']);
  const extrusion = applyExtrusionConfidenceBasics(conf, {
    depth,
    lengthUnitKnown: geom.lengthUnitKnown,
    worldExtrusionDirection: geom.worldExtrusionDirection,
    positionAxis: geom.solidPosition?.axis ?? null,
    requireVerticalExtrusion: true,
    verticalDotMin: FLAT_SLAB_VERTICAL_DOT_MIN,
    nonVerticalNote:
      'World extrusion direction is not horizontal-Flat within the slab orientation tolerance — ' +
      UNSUPPORTED_FLAT_NOTE,
    tiltedPositionNote:
      'Possible sloped/tilted geometry: swept-solid Position.Axis is tilted despite a vertical world extrusion — review manually; ' +
      UNSUPPORTED_FLAT_NOTE,
  });

  // Do not force-map non-flat / ambiguous orientation to Flat.
  if (!extrusion.orientationOk) {
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }
  addConfidenceNote(conf, 'Horizontal Flat-slab extrusion orientation');

  if (
    geom.bodyItemCount !== 1 ||
    geom.bodyItemTypes?.length !== 1 ||
    geom.bodyItemTypes[0] !== 'IfcExtrudedAreaSolid'
  ) {
    markConfidenceLow(
      conf,
      geom.bodyItemCount == null
        ? 'Body item count is unavailable — cannot prove a single uniform Flat extrusion'
        : `Body contains ${geom.bodyItemCount} items (${(geom.bodyItemTypes || []).join(', ') || 'types unavailable'}) — cannot prove uniform Flat geometry`,
    );
    addConfidenceNote(conf, UNSUPPORTED_FLAT_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }

  const resolved = resolveRectangleProfileDims(geom.profile);
  if (!resolved.ok) {
    markConfidenceLow(
      conf,
      resolved.unsupportedNote ||
        'Profile is not a rectangle within the 5% tolerance',
    );
    addConfidenceNote(conf, UNSUPPORTED_FLAT_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
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

  // Plan dims: preserve profile X/Y as length/width (authoring order).
  // Thickness = extrusion depth (uniform) → Flat only.
  const length = roundMetres3(xDim);
  const width = roundMetres3(yDim);
  const thickness = roundMetres3(depth);

  addConfidenceNote(
    conf,
    `Flat: length=XDim=${length}m, width=YDim=${width}m, thickness=depth=${thickness}m`,
  );

  if (conf.confidence === 'HIGH') {
    addConfidenceNote(
      conf,
      'Clean rectangular plan with vertical extrusion — HIGH confidence Flat',
    );
  }

  return {
    ...base,
    shape: 'FLAT',
    geometry: { length, width, thickness },
    confidence: conf.confidence,
    confidenceNotes: conf.notes,
    needsManualReview: conf.needsManualReview,
  };
}

/** Map all slab entities from a parse result. */
export function mapIfcSlabsToSuggestions(
  entities: IfcParsedEntity[],
): SlabIfcSuggestion[] {
  const out: SlabIfcSuggestion[] = [];
  for (const e of entities) {
    const s = mapIfcSlabToSuggestion(e);
    if (s) out.push(s);
  }
  return out;
}

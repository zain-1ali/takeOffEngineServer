/**
 * Map raw IfcColumn extruded geometry → COLUMNS suggestion shape.
 * Suggestions only; never creates Instances.
 *
 * Shape is taken from the swept profile (IfcColumn.PredefinedType does not
 * encode Rectangular / Circular / L / T / Cruciform). Unclassifiable
 * sections are flagged for manual review — never forced into a variant.
 *
 * Shared utilities:
 * - rectangle / arbitrary-polygon profile → ifcRectangleProfile
 * - L/T/Cruciform + circular identification → ifcColumnProfile
 * - HIGH/MEDIUM/LOW thresholds & helpers → ifcConfidence
 *
 * Step 1 only: mapper + parser. Review UI / IfcSuggestion persist is Step 3.
 */
import type { IfcParsedEntity, IfcRawExtrusionGeometry } from './ifcImport';
import {
  addConfidenceNote,
  applyExtrusionConfidenceBasics,
  createConfidence,
  markConfidenceLow,
  markConfidenceMediumIfHigh,
  roundMetres3,
  type IfcConfidenceTier,
} from './ifcConfidence';
import {
  classifyColumnProfile,
  type ColumnProfileClassification,
} from './ifcColumnProfile';
import type { ColumnShape } from '../engines/columns';

export type ColumnIfcConfidence = IfcConfidenceTier;

export type ColumnIfcSuggestion = {
  sourceGlobalId: string;
  expressId: number;
  elementKey: 'COLUMNS';
  name: string | null;
  shape: ColumnShape | null;
  geometry: Record<string, number> | null;
  confidence: ColumnIfcConfidence;
  confidenceNotes: string[];
  needsManualReview: boolean;
};

const UNSUPPORTED_COLUMN_NOTE =
  'Unsupported column cross-section for automatic IFC import (Rectangular, Circular, L-shaped, T-shaped, Cruciform only) — review manually';

const COMPLEX_SECTION_NOTE =
  'L/T/Cruciform classification is MEDIUM by default given the higher inference complexity';

function geometryFromClassification(
  classified: Extract<ColumnProfileClassification, { ok: true }>,
  clearHeight: number,
): { shape: ColumnShape; geometry: Record<string, number> } {
  const height = roundMetres3(clearHeight);
  if (classified.shape === 'RECTANGULAR') {
    return {
      shape: 'RECTANGULAR',
      geometry: {
        width: roundMetres3(classified.width),
        depth: roundMetres3(classified.depth),
        clearHeight: height,
      },
    };
  }
  if (classified.shape === 'CIRCULAR') {
    return {
      shape: 'CIRCULAR',
      geometry: {
        diameter: roundMetres3(classified.diameter),
        clearHeight: height,
      },
    };
  }
  if (classified.shape === 'L_SHAPED') {
    return {
      shape: 'L_SHAPED',
      geometry: {
        width: roundMetres3(classified.width),
        depth: roundMetres3(classified.depth),
        legThickness: roundMetres3(classified.legThickness),
        clearHeight: height,
      },
    };
  }
  if (classified.shape === 'T_SHAPED') {
    return {
      shape: 'T_SHAPED',
      geometry: {
        flangeWidth: roundMetres3(classified.flangeWidth),
        overallDepth: roundMetres3(classified.overallDepth),
        flangeThickness: roundMetres3(classified.flangeThickness),
        webThickness: roundMetres3(classified.webThickness),
        clearHeight: height,
      },
    };
  }
  return {
    shape: 'CRUCIFORM',
    geometry: {
      width: roundMetres3(classified.width),
      depth: roundMetres3(classified.depth),
      armThickness: roundMetres3(classified.armThickness),
      clearHeight: height,
    },
  };
}

function applyShapeConfidence(
  conf: ReturnType<typeof createConfidence>,
  classified: Extract<ColumnProfileClassification, { ok: true }>,
): void {
  if (
    classified.source === 'NATIVE_RECTANGLE' ||
    classified.source === 'NATIVE_CIRCLE'
  ) {
    addConfidenceNote(
      conf,
      classified.shape === 'CIRCULAR'
        ? `Native IfcCircleProfileDef diameter ${roundMetres3(classified.diameter)}m`
        : `Native IfcRectangleProfileDef ${roundMetres3(classified.width)}×${roundMetres3(classified.depth)}m`,
    );
    return;
  }

  if (
    classified.source === 'ARBITRARY_RECTANGLE' ||
    classified.source === 'ARBITRARY_CIRCLE'
  ) {
    addConfidenceNote(
      conf,
      classified.shape === 'CIRCULAR'
        ? `IfcArbitraryClosedProfileDef boundary is circular; derived diameter=${roundMetres3(classified.diameter)}m`
        : `IfcArbitraryClosedProfileDef boundary is rectangular; derived width=${roundMetres3(classified.width)}m and depth=${roundMetres3(classified.depth)}m`,
    );
    markConfidenceMediumIfHigh(
      conf,
      'Arbitrary-profile dimensions are inferred from the boundary polygon',
    );
    return;
  }

  if (classified.shape === 'L_SHAPED') {
    addConfidenceNote(
      conf,
      classified.source === 'NATIVE_LSHAPE'
        ? `Native IfcLShapeProfileDef ${roundMetres3(classified.width)}×${roundMetres3(classified.depth)}×t=${roundMetres3(classified.legThickness)}m`
        : `IfcArbitraryClosedProfileDef classified as L-shaped (6 vertices, 1 concave corner); ${roundMetres3(classified.width)}×${roundMetres3(classified.depth)}×t=${roundMetres3(classified.legThickness)}m`,
    );
  } else if (classified.shape === 'T_SHAPED') {
    addConfidenceNote(
      conf,
      classified.source === 'NATIVE_TSHAPE'
        ? `Native IfcTShapeProfileDef flange ${roundMetres3(classified.flangeWidth)}m × depth ${roundMetres3(classified.overallDepth)}m`
        : 'IfcArbitraryClosedProfileDef classified as T-shaped (8 vertices, 2 concave corners)',
    );
  } else if (classified.shape === 'CRUCIFORM') {
    addConfidenceNote(
      conf,
      `IfcArbitraryClosedProfileDef classified as Cruciform (12 vertices, 4 concave corners); ${roundMetres3(classified.width)}×${roundMetres3(classified.depth)}×t=${roundMetres3(classified.armThickness)}m`,
    );
  } else {
    // All rectangle/circle sources return above; retain an exhaustive guard.
    markConfidenceLow(
      conf,
      `Unexpected column profile classification ${classified.shape}`,
    );
    return;
  }
  markConfidenceMediumIfHigh(conf, COMPLEX_SECTION_NOTE);
}

/**
 * Map one parsed IFC column entity to a COLUMNS suggestion.
 * Returns null only when the entity is not a column.
 */
export function mapIfcColumnToSuggestion(
  entity: IfcParsedEntity,
): ColumnIfcSuggestion | null {
  if (entity.entityType !== 'IfcColumn') return null;

  const base = {
    sourceGlobalId: entity.globalId,
    expressId: entity.expressId,
    elementKey: 'COLUMNS' as const,
    name: entity.name,
  };

  if (!entity.geometryOk || !entity.geometry) {
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: [
        entity.skipReason || 'Geometry was not a simple IfcExtrudedAreaSolid',
        UNSUPPORTED_COLUMN_NOTE,
      ],
      needsManualReview: true,
    };
  }

  return mapExtrudedColumn(base, entity.geometry);
}

function mapExtrudedColumn(
  base: Pick<
    ColumnIfcSuggestion,
    'sourceGlobalId' | 'expressId' | 'elementKey' | 'name'
  >,
  geom: IfcRawExtrusionGeometry,
): ColumnIfcSuggestion {
  const depth = geom.depth;
  if (depth == null || !(depth > 0)) {
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: ['Missing or non-positive extrusion depth (height)'],
      needsManualReview: true,
    };
  }

  const conf = createConfidence(['IfcExtrudedAreaSolid', 'Column mapping']);
  const extrusion = applyExtrusionConfidenceBasics(conf, {
    depth,
    lengthUnitKnown: geom.lengthUnitKnown,
    worldExtrusionDirection: geom.worldExtrusionDirection,
    positionAxis: geom.solidPosition?.axis ?? null,
    requireVerticalExtrusion: true,
    nonVerticalNote:
      'World extrusion direction is not vertical — unusual for COLUMNS mapping',
    tiltedPositionNote:
      'Swept-solid Position.Axis is tilted despite a vertical world extrusion — possible raked/tilted column, review manually',
  });

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

  if (
    geom.bodyItemCount !== 1 ||
    geom.bodyItemTypes?.length !== 1 ||
    geom.bodyItemTypes[0] !== 'IfcExtrudedAreaSolid'
  ) {
    markConfidenceLow(
      conf,
      geom.bodyItemCount == null
        ? 'Body item count is unavailable — cannot prove a single uniform column extrusion'
        : `Body contains ${geom.bodyItemCount} items (${(geom.bodyItemTypes || []).join(', ') || 'types unavailable'}) — cannot prove uniform column geometry`,
    );
    addConfidenceNote(conf, UNSUPPORTED_COLUMN_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }

  const classified = classifyColumnProfile(geom.profile);
  if (!classified.ok) {
    markConfidenceLow(conf, classified.reason);
    addConfidenceNote(conf, UNSUPPORTED_COLUMN_NOTE);
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: conf.notes,
      needsManualReview: true,
    };
  }

  applyShapeConfidence(conf, classified);
  const mapped = geometryFromClassification(classified, extrusion.depth);
  return {
    ...base,
    shape: mapped.shape,
    geometry: mapped.geometry,
    confidence: conf.confidence,
    confidenceNotes: conf.notes,
    needsManualReview: conf.needsManualReview,
  };
}

export function mapIfcColumnsToSuggestions(
  entities: IfcParsedEntity[],
): ColumnIfcSuggestion[] {
  return entities
    .map(mapIfcColumnToSuggestion)
    .filter((row): row is ColumnIfcSuggestion => row != null);
}

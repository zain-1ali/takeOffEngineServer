/**
 * Step 2 — map raw IfcWall extruded geometry → WALLS suggestion shape.
 * Suggestions only; never creates Instances.
 */
import type { IfcParsedEntity, IfcRawExtrusionGeometry } from './ifcImport';

export type WallIfcConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type WallIfcSuggestion = {
  sourceGlobalId: string;
  expressId: number;
  elementKey: 'WALLS';
  name: string | null;
  shape: 'LINEAR' | 'CURVED' | null;
  geometry: {
    length?: number;
    radius?: number;
    arcAngleDeg?: number;
    thickness: number;
    height: number;
  } | null;
  confidence: WallIfcConfidence;
  confidenceNotes: string[];
  needsManualReview: boolean;
};

const VERTICAL_DOT_MIN = 0.95;
const LEN_THICK_NEAR = 0.05; // relative — square-ish profile
const AXIS_DIM_TOLERANCE = 0.02;

function isVerticalExtrusion(
  dir: { x: number; y: number; z: number } | null | undefined,
): boolean {
  if (!dir) return false;
  const mag = Math.hypot(dir.x, dir.y, dir.z);
  if (!(mag > 0)) return false;
  return Math.abs(dir.z) / mag >= VERTICAL_DOT_MIN;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Map one parsed IFC wall entity to a WALLS suggestion.
 * Returns null only when the entity is not a wall.
 */
export function mapIfcWallToSuggestion(
  entity: IfcParsedEntity,
): WallIfcSuggestion | null {
  if (entity.entityType !== 'IfcWall') return null;

  const base = {
    sourceGlobalId: entity.globalId,
    expressId: entity.expressId,
    elementKey: 'WALLS' as const,
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
      ],
      needsManualReview: true,
    };
  }

  return mapExtrudedWall(
    base,
    entity.geometry,
    entity.axisGeometry,
    entity.axisSkipReason,
  );
}

function mapExtrudedWall(
  base: Pick<
    WallIfcSuggestion,
    'sourceGlobalId' | 'expressId' | 'elementKey' | 'name'
  >,
  geom: IfcRawExtrusionGeometry,
  axis: IfcParsedEntity['axisGeometry'],
  axisSkipReason: string | null,
): WallIfcSuggestion {
  const notes: string[] = ['IfcExtrudedAreaSolid'];
  let confidence: WallIfcConfidence = 'HIGH';
  let needsManualReview = false;

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

  if (!geom.lengthUnitKnown) {
    notes.push('IFC length unit could not be resolved — values may not be metres');
    confidence = 'LOW';
    needsManualReview = true;
  } else {
    notes.push('Length values normalized to metres');
  }

  if (!isVerticalExtrusion(geom.worldExtrusionDirection)) {
    notes.push(
      geom.worldExtrusionDirection
        ? 'World extrusion direction is not vertical — unusual for WALLS mapping'
        : 'World extrusion direction could not be resolved through placements',
    );
    confidence = 'LOW';
    needsManualReview = true;
  } else {
    notes.push('Vertical extrusion');
  }

  const profile = geom.profile;
  if (!profile) {
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: [...notes, 'No swept profile on extrusion'],
      needsManualReview: true,
    };
  }

  const isRect = profile.type === 'IfcRectangleProfileDef';
  if (!isRect) {
    // v1: no guessing at arbitrary profiles / arcs from profile alone
    notes.push(
      `Profile type ${profile.type} is not IfcRectangleProfileDef — curved/axis mapping not auto-derived`,
    );
    return {
      ...base,
      shape: null,
      geometry:
        depth > 0
          ? {
              thickness: profile.xDim && profile.xDim > 0 ? round3(profile.xDim) : 0,
              height: round3(depth),
            }
          : null,
      confidence: 'LOW',
      confidenceNotes: notes,
      needsManualReview: true,
    };
  }

  const xDim = profile.xDim;
  const yDim = profile.yDim;
  if (xDim == null || yDim == null || !(xDim > 0) || !(yDim > 0)) {
    return {
      ...base,
      shape: null,
      geometry: null,
      confidence: 'LOW',
      confidenceNotes: [...notes, 'Rectangle profile missing XDim/YDim'],
      needsManualReview: true,
    };
  }

  const relDiff = Math.abs(xDim - yDim) / Math.max(xDim, yDim);
  if (relDiff < LEN_THICK_NEAR) {
    notes.push(
      'Profile is nearly square — thickness vs length ambiguous',
    );
    confidence = 'LOW';
    needsManualReview = true;
  }

  const smaller = Math.min(xDim, yDim);
  const larger = Math.max(xDim, yDim);

  if (axis?.kind === 'CURVED') {
    const arcLength =
      axis.radius * ((axis.angleDeg * Math.PI) / 180);
    const bodyAgreement =
      Math.abs(larger - arcLength) / Math.max(larger, arcLength) <=
      AXIS_DIM_TOLERANCE;
    notes.push(
      `Curved Axis: radius=${round3(axis.radius)}m, angle=${round3(axis.angleDeg)}°`,
    );
    if (!bodyAgreement) {
      notes.push(
        `Axis arc length ${round3(arcLength)}m conflicts with rectangle long dimension ${round3(larger)}m`,
      );
      confidence = 'LOW';
      needsManualReview = true;
    } else {
      notes.push('Curved Axis arc length agrees with rectangle body');
    }
    return {
      ...base,
      shape: 'CURVED',
      geometry: {
        radius: round3(axis.radius),
        arcAngleDeg: round3(axis.angleDeg),
        thickness: round3(smaller),
        height: round3(depth),
      },
      confidence,
      confidenceNotes: notes,
      needsManualReview,
    };
  }

  let length: number;
  let thickness: number;
  if (axis?.kind === 'LINEAR') {
    length = axis.length;
    const xMatches =
      Math.abs(xDim - length) / Math.max(xDim, length) <=
      AXIS_DIM_TOLERANCE;
    const yMatches =
      Math.abs(yDim - length) / Math.max(yDim, length) <=
      AXIS_DIM_TOLERANCE;
    if (xMatches !== yMatches) {
      thickness = xMatches ? yDim : xDim;
      notes.push(
        `Straight Axis length ${round3(length)}m agrees with ${xMatches ? 'XDim' : 'YDim'}; thickness uses the orthogonal profile dimension`,
      );
    } else {
      thickness = smaller;
      notes.push(
        xMatches
          ? 'Both rectangle dimensions match Axis length — thickness is ambiguous'
          : `Axis length ${round3(length)}m conflicts with XDim=${round3(xDim)}m and YDim=${round3(yDim)}m`,
      );
      confidence = 'LOW';
      needsManualReview = true;
    }
  } else {
    length = larger;
    thickness = smaller;
    notes.push(
      `${axisSkipReason || 'No Axis representation'} — using larger rectangle dimension as length and smaller as thickness`,
    );
    if (confidence === 'HIGH') confidence = 'MEDIUM';
  }

  return {
    ...base,
    shape: 'LINEAR',
    geometry: {
      length: round3(length),
      thickness: round3(thickness),
      height: round3(depth),
    },
    confidence,
    confidenceNotes: notes,
    needsManualReview,
  };
}

/** Map all wall entities from a parse result. */
export function mapIfcWallsToSuggestions(
  entities: IfcParsedEntity[],
): WallIfcSuggestion[] {
  const out: WallIfcSuggestion[] = [];
  for (const e of entities) {
    const s = mapIfcWallToSuggestion(e);
    if (s) out.push(s);
  }
  return out;
}

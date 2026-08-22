/**
 * Step 2 — map raw IfcWall extruded geometry → WALLS suggestion shape.
 * Suggestions only; never creates Instances.
 *
 * Shared utilities:
 * - rectangle / arbitrary-polygon profile → ifcRectangleProfile
 * - HIGH/MEDIUM/LOW thresholds & helpers → ifcConfidence
 * Floor/storey matching lives in ifcFloorMatch (used by ifcBuildSuggestions).
 */
import type { IfcParsedEntity, IfcRawExtrusionGeometry } from './ifcImport';
import {
  addConfidenceNote,
  applyExtrusionConfidenceBasics,
  createConfidence,
  dimensionsAgreeWithin,
  isNearSquareProfile,
  markConfidenceLow,
  markConfidenceMediumIfHigh,
  roundMetres3,
  type IfcConfidenceTier,
} from './ifcConfidence';
import { resolveRectangleProfileDims } from './ifcRectangleProfile';

export type WallIfcConfidence = IfcConfidenceTier;

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
  // Match prior Walls behavior: missing depth is a lone note (no seed notes).
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

  const conf = createConfidence(['IfcExtrudedAreaSolid']);
  applyExtrusionConfidenceBasics(conf, {
    depth,
    lengthUnitKnown: geom.lengthUnitKnown,
    worldExtrusionDirection: geom.worldExtrusionDirection,
    positionAxis: geom.solidPosition?.axis ?? null,
    requireVerticalExtrusion: true,
    nonVerticalNote:
      'World extrusion direction is not vertical — unusual for WALLS mapping',
    tiltedPositionNote:
      'Swept-solid Position.Axis is tilted despite a vertical world extrusion — possible tilted WALLS geometry, review manually',
  });

  const resolved = resolveRectangleProfileDims(geom.profile);
  if (!resolved.ok) {
    const profile = geom.profile;
    const noPartialGeometry =
      !profile ||
      resolved.unsupportedNote === 'No swept profile on extrusion' ||
      resolved.unsupportedNote === 'Rectangle profile missing XDim/YDim';
    return {
      ...base,
      shape: null,
      geometry: noPartialGeometry
        ? null
        : {
            thickness:
              profile.xDim && profile.xDim > 0
                ? roundMetres3(profile.xDim)
                : 0,
            height: roundMetres3(depth),
          },
      confidence: 'LOW',
      confidenceNotes: [
        ...conf.notes,
        resolved.unsupportedNote || 'Unsupported profile',
      ],
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
  }

  if (isNearSquareProfile(xDim, yDim)) {
    markConfidenceLow(
      conf,
      'Profile is nearly square — thickness vs length ambiguous',
    );
  }

  const smaller = Math.min(xDim, yDim);
  const larger = Math.max(xDim, yDim);

  if (axis?.kind === 'CURVED') {
    const arcLength = axis.radius * ((axis.angleDeg * Math.PI) / 180);
    const bodyAgreement = dimensionsAgreeWithin(larger, arcLength);
    addConfidenceNote(
      conf,
      `Curved Axis: radius=${roundMetres3(axis.radius)}m, angle=${roundMetres3(axis.angleDeg)}°`,
    );
    if (!bodyAgreement) {
      markConfidenceLow(
        conf,
        `Axis arc length ${roundMetres3(arcLength)}m conflicts with rectangle long dimension ${roundMetres3(larger)}m`,
      );
    } else {
      addConfidenceNote(
        conf,
        'Curved Axis arc length agrees with rectangle body',
      );
    }
    return {
      ...base,
      shape: 'CURVED',
      geometry: {
        radius: roundMetres3(axis.radius),
        arcAngleDeg: roundMetres3(axis.angleDeg),
        thickness: roundMetres3(smaller),
        height: roundMetres3(depth),
      },
      confidence: conf.confidence,
      confidenceNotes: conf.notes,
      needsManualReview: conf.needsManualReview,
    };
  }

  let length: number;
  let thickness: number;
  if (axis?.kind === 'LINEAR') {
    length = axis.length;
    const xMatches = dimensionsAgreeWithin(xDim, length);
    const yMatches = dimensionsAgreeWithin(yDim, length);
    if (xMatches !== yMatches) {
      thickness = xMatches ? yDim : xDim;
      addConfidenceNote(
        conf,
        `Straight Axis length ${roundMetres3(length)}m agrees with ${xMatches ? 'XDim' : 'YDim'}; thickness uses the orthogonal profile dimension`,
      );
    } else {
      thickness = smaller;
      markConfidenceLow(
        conf,
        xMatches
          ? 'Both rectangle dimensions match Axis length — thickness is ambiguous'
          : `Axis length ${roundMetres3(length)}m conflicts with XDim=${roundMetres3(xDim)}m and YDim=${roundMetres3(yDim)}m`,
      );
    }
  } else {
    length = larger;
    thickness = smaller;
    addConfidenceNote(
      conf,
      `${axisSkipReason || 'No Axis representation'} — using larger rectangle dimension as length and smaller as thickness`,
    );
    markConfidenceMediumIfHigh(conf);
  }

  return {
    ...base,
    shape: 'LINEAR',
    geometry: {
      length: roundMetres3(length),
      thickness: roundMetres3(thickness),
      height: roundMetres3(depth),
    },
    confidence: conf.confidence,
    confidenceNotes: conf.notes,
    needsManualReview: conf.needsManualReview,
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

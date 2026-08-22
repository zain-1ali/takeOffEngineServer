/**
 * Build PENDING IfcSuggestion docs from a parse result.
 * Walls: mapped when possible. Slabs: listed for manual modeling (no Step 5 mapper yet).
 */
import type { IfcParsedEntity, IfcParseResult } from './ifcImport';
import type {
  IfcFloorMatchStatus,
  IfcMappedInstanceData,
  IfcSuggestionConfidence,
  IfcSuggestionEntityType,
  IfcSuggestionStorey,
} from '../models/IfcSuggestion';
import {
  matchIfcEntityToFloor,
  type MatchableFloor,
} from './ifcFloorMatch';
import {
  mapIfcWallToSuggestion,
  type WallIfcSuggestion,
} from './ifcWallMap';

export type BuiltIfcSuggestion = {
  sourceGlobalId: string;
  expressId: number;
  entityType: IfcSuggestionEntityType;
  name: string | null;
  floorId: string | null;
  sourceStorey: IfcSuggestionStorey | null;
  floorMatchStatus: IfcFloorMatchStatus;
  floorMatchNote: string;
  mappedInstanceData: IfcMappedInstanceData | null;
  confidence: IfcSuggestionConfidence;
  confidenceNotes: string[];
  needsManualModeling: boolean;
  skipReason: string | null;
  status: 'PENDING';
};

function floorFields(entity: IfcParsedEntity, floors: MatchableFloor[]) {
  const match = matchIfcEntityToFloor(entity, floors);
  return {
    floorId: match.floorId,
    sourceStorey: match.sourceStorey,
    floorMatchStatus: match.floorMatchStatus,
    floorMatchNote: match.floorMatchNote,
  };
}

function wallMappedData(mapped: WallIfcSuggestion): IfcMappedInstanceData {
  return {
    elementKey: 'WALLS',
    shape: mapped.shape,
    mark: null,
    geometry: mapped.geometry
      ? {
          ...(mapped.geometry.length != null
            ? { length: mapped.geometry.length }
            : {}),
          ...(mapped.geometry.radius != null
            ? { radius: mapped.geometry.radius }
            : {}),
          ...(mapped.geometry.arcAngleDeg != null
            ? { arcAngleDeg: mapped.geometry.arcAngleDeg }
            : {}),
          thickness: mapped.geometry.thickness,
          height: mapped.geometry.height,
        }
      : null,
  };
}

function wallIsCommitReady(mapped: WallIfcSuggestion): boolean {
  if (!mapped.shape || !mapped.geometry) return false;
  const g = mapped.geometry;
  if (!(g.thickness > 0) || !(g.height > 0)) return false;
  if (mapped.shape === 'LINEAR') {
    return typeof g.length === 'number' && g.length > 0;
  }
  return (
    typeof g.radius === 'number' &&
    g.radius > 0 &&
    typeof g.arcAngleDeg === 'number' &&
    g.arcAngleDeg > 0
  );
}

function fromWallEntity(
  entity: IfcParsedEntity,
  floors: MatchableFloor[],
): BuiltIfcSuggestion {
  if (!entity.geometryOk) {
    return {
      sourceGlobalId: entity.globalId,
      expressId: entity.expressId,
      entityType: 'IfcWall',
      name: entity.name,
      ...floorFields(entity, floors),
      mappedInstanceData: {
        elementKey: 'WALLS',
        shape: null,
        mark: null,
        geometry: null,
      },
      confidence: 'LOW',
      confidenceNotes: [
        entity.skipReason || 'Geometry was not a simple IfcExtrudedAreaSolid',
      ],
      needsManualModeling: true,
      skipReason:
        entity.skipReason || 'Skipped in Step 1 — needs manual modeling',
      status: 'PENDING',
    };
  }

  const mapped = mapIfcWallToSuggestion(entity);
  if (!mapped) {
    return {
      sourceGlobalId: entity.globalId,
      expressId: entity.expressId,
      entityType: 'IfcWall',
      name: entity.name,
      ...floorFields(entity, floors),
      mappedInstanceData: null,
      confidence: 'LOW',
      confidenceNotes: ['Wall entity could not be mapped'],
      needsManualModeling: true,
      skipReason: 'Wall mapping returned null',
      status: 'PENDING',
    };
  }

  const ready = wallIsCommitReady(mapped);
  return {
    sourceGlobalId: mapped.sourceGlobalId,
    expressId: mapped.expressId,
    entityType: 'IfcWall',
    name: mapped.name,
    ...floorFields(entity, floors),
    mappedInstanceData: wallMappedData(mapped),
    confidence: mapped.confidence,
    confidenceNotes: [...mapped.confidenceNotes],
    needsManualModeling: !ready || mapped.needsManualReview,
    skipReason: ready
      ? null
      : 'Incomplete wall dimensions — edit before accepting or model manually',
    status: 'PENDING',
  };
}

function fromSlabEntity(
  entity: IfcParsedEntity,
  floors: MatchableFloor[],
): BuiltIfcSuggestion {
  // No Step 5 slab mapper yet — always list for manual modeling.
  const notes = [
    entity.geometryOk
      ? 'IfcSlab parsed — slab auto-mapping is not available yet'
      : entity.skipReason || 'Slab geometry was not extracted',
  ];
  return {
    sourceGlobalId: entity.globalId,
    expressId: entity.expressId,
    entityType: 'IfcSlab',
    name: entity.name,
    ...floorFields(entity, floors),
    mappedInstanceData: {
      elementKey: 'SLABS',
      shape: null,
      mark: null,
      geometry: null,
    },
    confidence: 'LOW',
    confidenceNotes: notes,
    needsManualModeling: true,
    skipReason: 'Slabs require manual modeling (mapper not available)',
    status: 'PENDING',
  };
}

export function buildIfcSuggestionsFromParse(
  result: IfcParseResult,
  floors: MatchableFloor[] = [],
): BuiltIfcSuggestion[] {
  const out: BuiltIfcSuggestion[] = [];
  for (const e of result.entities) {
    if (e.entityType === 'IfcWall') out.push(fromWallEntity(e, floors));
    else if (e.entityType === 'IfcSlab') out.push(fromSlabEntity(e, floors));
  }
  return out;
}

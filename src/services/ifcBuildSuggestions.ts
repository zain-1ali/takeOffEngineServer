/**
 * Build PENDING IfcSuggestion docs from a parse result.
 * Walls: mapped when possible.
 * Slabs: Flat shape only (Sloped / Waffle / Drop-panel permanently excluded).
 * Footings: Pad / Strip / rectangular Pile Cap. Raft is not auto-mapped.
 * Columns: Rectangular / Circular / L / T / Cruciform; unclassifiable stays LOW.
 * Beams: Rectangular / T / L / Cantilever-tapered / Ground-tie; unclassifiable stays LOW.
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
  mapIfcFootingToSuggestion,
  type FoundationIfcSuggestion,
} from './ifcFoundationMap';
import {
  mapIfcSlabToSuggestion,
  type SlabIfcSuggestion,
} from './ifcSlabMap';
import {
  mapIfcWallToSuggestion,
  type WallIfcSuggestion,
} from './ifcWallMap';
import {
  mapIfcColumnToSuggestion,
  type ColumnIfcSuggestion,
} from './ifcColumnMap';
import {
  mapIfcBeamToSuggestion,
  type BeamIfcSuggestion,
} from './ifcBeamMap';

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

function slabMappedData(mapped: SlabIfcSuggestion): IfcMappedInstanceData {
  return {
    elementKey: 'SLABS',
    shape: mapped.shape,
    mark: null,
    geometry: mapped.geometry
      ? {
          length: mapped.geometry.length,
          width: mapped.geometry.width,
          thickness: mapped.geometry.thickness,
        }
      : null,
  };
}

function slabIsCommitReady(mapped: SlabIfcSuggestion): boolean {
  if (mapped.shape !== 'FLAT' || !mapped.geometry) return false;
  const g = mapped.geometry;
  return g.length > 0 && g.width > 0 && g.thickness > 0;
}

function foundationMappedData(
  mapped: FoundationIfcSuggestion,
): IfcMappedInstanceData {
  return {
    elementKey: mapped.elementKey,
    shape: mapped.shape,
    mark: null,
    geometry: mapped.geometry,
  };
}

function foundationIsCommitReady(mapped: FoundationIfcSuggestion): boolean {
  if (!mapped.elementKey || !mapped.shape || !mapped.geometry) return false;
  const g = mapped.geometry;
  if (mapped.elementKey === 'PAD_FOOTING') {
    return (
      mapped.shape === 'RECTANGULAR' &&
      g.length > 0 &&
      g.width > 0 &&
      g.baseThickness > 0
    );
  }
  if (mapped.elementKey === 'STRIP_FOOTING') {
    return (
      mapped.shape === 'FLAT' && g.length > 0 && g.width > 0 && g.height > 0
    );
  }
  return (
    mapped.shape === 'RECTANGULAR' &&
    g.length > 0 &&
    g.width > 0 &&
    g.thickness > 0 &&
    g.pileCount >= 1
  );
}

function fromSlabEntity(
  entity: IfcParsedEntity,
  floors: MatchableFloor[],
): BuiltIfcSuggestion {
  const mapped = mapIfcSlabToSuggestion(entity);
  if (!mapped) {
    return {
      sourceGlobalId: entity.globalId,
      expressId: entity.expressId,
      entityType: 'IfcSlab',
      name: entity.name,
      ...floorFields(entity, floors),
      mappedInstanceData: null,
      confidence: 'LOW',
      confidenceNotes: ['Slab entity could not be mapped'],
      needsManualModeling: true,
      skipReason: 'Slab mapping returned null',
      status: 'PENDING',
    };
  }

  const ready = slabIsCommitReady(mapped);
  return {
    sourceGlobalId: mapped.sourceGlobalId,
    expressId: mapped.expressId,
    entityType: 'IfcSlab',
    name: mapped.name,
    ...floorFields(entity, floors),
    mappedInstanceData: slabMappedData(mapped),
    confidence: mapped.confidence,
    confidenceNotes: [...mapped.confidenceNotes],
    needsManualModeling: !ready || mapped.needsManualReview,
    skipReason: ready
      ? null
      : entity.skipReason ||
        'Incomplete or unsupported slab — Flat auto-import only; edit or model manually',
    status: 'PENDING',
  };
}

function fromFootingEntity(
  entity: IfcParsedEntity,
  floors: MatchableFloor[],
): BuiltIfcSuggestion {
  const mapped = mapIfcFootingToSuggestion(entity);
  if (!mapped) {
    return {
      sourceGlobalId: entity.globalId,
      expressId: entity.expressId,
      entityType: 'IfcFooting',
      name: entity.name,
      ...floorFields(entity, floors),
      mappedInstanceData: null,
      confidence: 'LOW',
      confidenceNotes: ['Footing entity could not be mapped'],
      needsManualModeling: true,
      skipReason: 'Footing mapping returned null',
      status: 'PENDING',
    };
  }

  const ready = foundationIsCommitReady(mapped);
  return {
    sourceGlobalId: mapped.sourceGlobalId,
    expressId: mapped.expressId,
    entityType: 'IfcFooting',
    name: mapped.name,
    ...floorFields(entity, floors),
    mappedInstanceData: foundationMappedData(mapped),
    confidence: mapped.confidence,
    confidenceNotes: [...mapped.confidenceNotes],
    needsManualModeling: !ready || mapped.needsManualReview,
    skipReason: ready
      ? null
      : entity.skipReason ||
        'Incomplete or unsupported footing — edit before accepting or model manually',
    status: 'PENDING',
  };
}

function columnMappedData(mapped: ColumnIfcSuggestion): IfcMappedInstanceData {
  return {
    elementKey: 'COLUMNS',
    shape: mapped.shape,
    mark: null,
    geometry: mapped.geometry,
  };
}

function columnIsCommitReady(mapped: ColumnIfcSuggestion): boolean {
  if (!mapped.shape || !mapped.geometry) return false;
  const g = mapped.geometry;
  if (!(Number(g.clearHeight) > 0)) return false;
  if (mapped.shape === 'CIRCULAR') return Number(g.diameter) > 0;
  if (mapped.shape === 'L_SHAPED') {
    return (
      Number(g.width) > 0 &&
      Number(g.depth) > 0 &&
      Number(g.legThickness) > 0
    );
  }
  if (mapped.shape === 'T_SHAPED') {
    return (
      Number(g.flangeWidth) > 0 &&
      Number(g.overallDepth) > 0 &&
      Number(g.flangeThickness) > 0 &&
      Number(g.webThickness) > 0
    );
  }
  if (mapped.shape === 'CRUCIFORM') {
    return (
      Number(g.width) > 0 &&
      Number(g.depth) > 0 &&
      Number(g.armThickness) > 0
    );
  }
  if (mapped.shape === 'RECTANGULAR') {
    return Number(g.width) > 0 && Number(g.depth) > 0;
  }
  return false;
}

function fromColumnEntity(
  entity: IfcParsedEntity,
  floors: MatchableFloor[],
): BuiltIfcSuggestion {
  const mapped = mapIfcColumnToSuggestion(entity);
  if (!mapped) {
    return {
      sourceGlobalId: entity.globalId,
      expressId: entity.expressId,
      entityType: 'IfcColumn',
      name: entity.name,
      ...floorFields(entity, floors),
      mappedInstanceData: {
        elementKey: 'COLUMNS',
        shape: null,
        mark: null,
        geometry: null,
      },
      confidence: 'LOW',
      confidenceNotes: ['Column entity could not be mapped'],
      needsManualModeling: true,
      skipReason: 'Column mapping returned null',
      status: 'PENDING',
    };
  }

  const ready = columnIsCommitReady(mapped);
  return {
    sourceGlobalId: mapped.sourceGlobalId,
    expressId: mapped.expressId,
    entityType: 'IfcColumn',
    name: mapped.name,
    ...floorFields(entity, floors),
    mappedInstanceData: columnMappedData(mapped),
    confidence: mapped.confidence,
    confidenceNotes: [...mapped.confidenceNotes],
    needsManualModeling: !ready || mapped.needsManualReview,
    skipReason: ready
      ? null
      : entity.skipReason ||
        'Incomplete or unsupported column — pick a shape and dimensions, or model manually',
    status: 'PENDING',
  };
}

function beamMappedData(mapped: BeamIfcSuggestion): IfcMappedInstanceData {
  return {
    elementKey: 'BEAMS',
    shape: mapped.shape,
    mark: null,
    geometry: mapped.geometry,
  };
}

function beamIsCommitReady(mapped: BeamIfcSuggestion): boolean {
  if (!mapped.shape || !mapped.geometry) return false;
  const g = mapped.geometry;
  if (!(Number(g.spanLength) > 0)) return false;
  if (mapped.shape === 'T_SECTION' || mapped.shape === 'L_SECTION') {
    return (
      Number(g.flangeWidth) > 0 &&
      Number(g.flangeThickness) > 0 &&
      Number(g.webWidth) > 0 &&
      Number(g.overallDepth) > 0
    );
  }
  if (mapped.shape === 'CANTILEVER_TAPERED') {
    return (
      Number(g.width) > 0 &&
      Number(g.supportDepth) > 0 &&
      Number(g.tipDepth) > 0
    );
  }
  if (mapped.shape === 'RECTANGULAR' || mapped.shape === 'GROUND_TIE') {
    return Number(g.width) > 0 && Number(g.depth) > 0;
  }
  return false;
}

function fromBeamEntity(
  entity: IfcParsedEntity,
  floors: MatchableFloor[],
): BuiltIfcSuggestion {
  const mapped = mapIfcBeamToSuggestion(entity);
  if (!mapped) {
    return {
      sourceGlobalId: entity.globalId,
      expressId: entity.expressId,
      entityType: 'IfcBeam',
      name: entity.name,
      ...floorFields(entity, floors),
      mappedInstanceData: {
        elementKey: 'BEAMS',
        shape: null,
        mark: null,
        geometry: null,
      },
      confidence: 'LOW',
      confidenceNotes: ['Beam entity could not be mapped'],
      needsManualModeling: true,
      skipReason: 'Beam mapping returned null',
      status: 'PENDING',
    };
  }

  const ready = beamIsCommitReady(mapped);
  return {
    sourceGlobalId: mapped.sourceGlobalId,
    expressId: mapped.expressId,
    entityType: 'IfcBeam',
    name: mapped.name,
    ...floorFields(entity, floors),
    mappedInstanceData: beamMappedData(mapped),
    confidence: mapped.confidence,
    confidenceNotes: [...mapped.confidenceNotes],
    needsManualModeling: !ready || mapped.needsManualReview,
    skipReason: ready
      ? null
      : entity.skipReason ||
        'Incomplete or unsupported beam — pick a shape and dimensions, or model manually',
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
    else if (e.entityType === 'IfcFooting') {
      out.push(fromFootingEntity(e, floors));
    } else if (e.entityType === 'IfcColumn') {
      out.push(fromColumnEntity(e, floors));
    } else if (e.entityType === 'IfcBeam') {
      out.push(fromBeamEntity(e, floors));
    }
  }
  return out;
}

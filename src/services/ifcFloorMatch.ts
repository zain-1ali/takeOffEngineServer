import type { IfcParsedEntity, IfcSourceStorey } from './ifcImport';
import type { IfcFloorMatchStatus } from '../models/IfcSuggestion';

export const IFC_FLOOR_ELEVATION_TOLERANCE_M = 0.05;

export type MatchableFloor = {
  floorId: string;
  label: string;
  elevation: number;
};

export type IfcFloorMatch = {
  floorId: string | null;
  sourceStorey: IfcSourceStorey | null;
  floorMatchStatus: Exclude<IfcFloorMatchStatus, 'MANUAL'>;
  floorMatchNote: string;
};

function normalizeName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function uniqueFloors(floors: MatchableFloor[]): MatchableFloor[] {
  return [...new Map(floors.map((floor) => [floor.floorId, floor])).values()];
}

export function matchIfcEntityToFloor(
  entity: Pick<IfcParsedEntity, 'sourceStorey' | 'storeyIssue'>,
  floors: MatchableFloor[],
): IfcFloorMatch {
  const sourceStorey = entity.sourceStorey || null;
  if (entity.storeyIssue === 'AMBIGUOUS') {
    return {
      floorId: null,
      sourceStorey,
      floorMatchStatus: 'AMBIGUOUS',
      floorMatchNote:
        'Element is contained in multiple IFC spatial structures; assign a floor manually',
    };
  }
  if (!sourceStorey) {
    return {
      floorId: null,
      sourceStorey: null,
      floorMatchStatus: 'NO_STOREY',
      floorMatchNote:
        'No IfcBuildingStorey containment was found; assign a floor manually',
    };
  }

  const sourceName = normalizeName(sourceStorey.name);
  if (sourceName) {
    const nameMatches = uniqueFloors(
      floors.filter(
        (floor) =>
          normalizeName(floor.label) === sourceName ||
          normalizeName(floor.floorId) === sourceName,
      ),
    );
    if (nameMatches.length === 1) {
      return {
        floorId: nameMatches[0].floorId,
        sourceStorey,
        floorMatchStatus: 'MATCHED_NAME',
        floorMatchNote: `Matched IFC storey “${sourceStorey.name}” to project floor “${nameMatches[0].label}” by name`,
      };
    }
    if (nameMatches.length > 1) {
      return {
        floorId: null,
        sourceStorey,
        floorMatchStatus: 'AMBIGUOUS',
        floorMatchNote: `IFC storey name “${sourceStorey.name}” matches multiple project floors; assign one manually`,
      };
    }
  }

  if (
    sourceStorey.elevationM != null &&
    Number.isFinite(sourceStorey.elevationM)
  ) {
    const elevationMatches = uniqueFloors(
      floors.filter(
        (floor) =>
          Number.isFinite(floor.elevation) &&
          Math.abs(floor.elevation - sourceStorey.elevationM!) <=
            IFC_FLOOR_ELEVATION_TOLERANCE_M,
      ),
    );
    if (elevationMatches.length === 1) {
      return {
        floorId: elevationMatches[0].floorId,
        sourceStorey,
        floorMatchStatus: 'MATCHED_ELEVATION',
        floorMatchNote: `Matched IFC storey elevation ${sourceStorey.elevationM}m to project floor “${elevationMatches[0].label}”`,
      };
    }
    if (elevationMatches.length > 1) {
      return {
        floorId: null,
        sourceStorey,
        floorMatchStatus: 'AMBIGUOUS',
        floorMatchNote: `IFC storey elevation ${sourceStorey.elevationM}m matches multiple project floors within ${IFC_FLOOR_ELEVATION_TOLERANCE_M}m; assign one manually`,
      };
    }
  }

  return {
    floorId: null,
    sourceStorey,
    floorMatchStatus: 'UNMATCHED',
    floorMatchNote:
      sourceStorey.elevationM == null
        ? `IFC storey “${sourceStorey.name || sourceStorey.expressId}” has no matching project floor and no elevation; assign one manually`
        : `No project floor matches IFC storey “${sourceStorey.name || sourceStorey.expressId}” at ${sourceStorey.elevationM}m; assign one manually`,
  };
}

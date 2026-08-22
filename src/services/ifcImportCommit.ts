/**
 * Commit ACCEPTED IFC wall suggestions → WALLS Instances.
 * Rebar/grade are project defaults — never taken from IFC.
 */
import { randomUUID } from 'crypto';
import type { IProject } from '../models/Project';
import type {
  IfcWallSuggestionGeometry,
  IfcWallSuggestionRow,
} from '../models/IfcImportJob';
import type { WallIfcSuggestion } from './ifcWallMap';

/** Matches frontend ELEMENT_SCHEMAS.WALLS defaults. */
export const WALL_INSTANCE_DEFAULTS = {
  markPrefix: 'W',
  rebar: {
    cover: 40,
    vertDia: 12,
    vertSpacing: 200,
    horizDia: 12,
    horizSpacing: 250,
    bothFaces: true,
    startersEnabled: false,
    starterDia: 12,
    starterCount: 20,
    starterProjection: 0.5,
    starterEmbedment: 0.4,
  },
};

/** Matches frontend ELEMENT_SCHEMAS.SLABS defaults (Flat). */
export const SLAB_INSTANCE_DEFAULTS = {
  markPrefix: 'S',
  rebar: {
    cover: 50,
    bottomMainBars: [{ diameterMm: 12, spacingMm: 200 }],
    bottomDistBars: [{ diameterMm: 12, spacingMm: 200 }],
    topMainBars: [{ diameterMm: 12, spacingMm: 200 }],
    topDistBars: [{ diameterMm: 12, spacingMm: 200 }],
    bottomMainDia: 12,
    bottomMainSpacing: 200,
    bottomDistDia: 12,
    bottomDistSpacing: 200,
    topMainDia: 12,
    topMainSpacing: 200,
    topDistDia: 12,
    topDistSpacing: 200,
    ribBarsPerRib: 2,
  },
};

/** Matches frontend ELEMENT_SCHEMAS pad / strip / pile-cap defaults. */
export const FOUNDATION_INSTANCE_DEFAULTS = {
  PAD_FOOTING: {
    markPrefix: 'F',
    rebar: {
      cover: 50,
      bottomMainBars: [{ diameterMm: 16, spacingMm: 150 }],
      bottomDistBars: [{ diameterMm: 16, spacingMm: 150 }],
      topMainBars: [{ diameterMm: 16, spacingMm: 150 }],
      topDistBars: [{ diameterMm: 16, spacingMm: 150 }],
      bottomMainDia: 16,
      bottomMainSpacing: 150,
      bottomDistDia: 16,
      bottomDistSpacing: 150,
      topMainDia: 16,
      topMainSpacing: 150,
      topDistDia: 16,
      topDistSpacing: 150,
      startersEnabled: true,
      starterDia: 20,
      starterCount: 4,
      starterProjection: 0.75,
      starterEmbedment: 0.4,
    },
  },
  STRIP_FOOTING: {
    markPrefix: 'SF',
    rebar: {
      cover: 50,
      mainBars: [{ diameterMm: 12, spacingMm: 150 }],
      distBars: [{ diameterMm: 12, spacingMm: 250 }],
      topMainBars: [{ diameterMm: 12, spacingMm: 150 }],
      topDistBars: [{ diameterMm: 12, spacingMm: 250 }],
      mainDia: 12,
      mainSpacing: 150,
      distDia: 12,
      distSpacing: 250,
      topMainDia: 12,
      topMainSpacing: 150,
      topDistDia: 12,
      topDistSpacing: 250,
      startersEnabled: false,
      starterDia: 12,
      starterCount: 10,
      starterProjection: 0.5,
      starterEmbedment: 0.3,
    },
  },
  PILE_CAP: {
    markPrefix: 'PC',
    rebar: {
      cover: 50,
      bottomMainBars: [{ diameterMm: 16, spacingMm: 150 }],
      bottomDistBars: [{ diameterMm: 16, spacingMm: 150 }],
      bottomMainDia: 16,
      bottomMainSpacing: 150,
      bottomDistDia: 16,
      bottomDistSpacing: 150,
      starterBarsPerPile: 4,
      starterDia: 20,
      starterProjection: 0.8,
      starterEmbedment: 0.4,
    },
  },
} as const;

/** Matches frontend ELEMENT_SCHEMAS.COLUMNS defaults. */
export const COLUMN_INSTANCE_DEFAULTS = {
  markPrefix: 'C',
  rebar: {
    cover: 40,
    longBars: [{ diameterMm: 16, barCount: 8 }],
    longBarCount: 8,
    longBarDia: 16,
    tieDia: 8,
    tieSpacing: 200,
  },
};

/** Matches frontend ELEMENT_SCHEMAS.BEAMS defaults. */
export const BEAM_INSTANCE_DEFAULTS = {
  markPrefix: 'B',
  rebar: {
    cover: 40,
    topBars: [{ diameterMm: 16, barCount: 2 }],
    bottomBars: [{ diameterMm: 20, barCount: 3 }],
    topBarCount: 2,
    topBarDia: 16,
    bottomBarCount: 3,
    bottomBarDia: 20,
    linkDia: 8,
    linkSpacing: 200,
  },
};

export function toJobWallSuggestion(
  mapped: WallIfcSuggestion,
): IfcWallSuggestionRow {
  const geometry = mapped.geometry
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
    : null;

  return {
    id: randomUUID(),
    sourceGlobalId: mapped.sourceGlobalId,
    expressId: mapped.expressId,
    elementKey: 'WALLS',
    name: mapped.name,
    floorId: null,
    sourceStorey: null,
    floorMatchStatus: 'NO_STOREY',
    floorMatchNote: 'No project floor matching was performed',
    mark: null,
    shape: mapped.shape,
    geometry,
    confidence: mapped.confidence,
    confidenceNotes: [...mapped.confidenceNotes],
    needsManualReview: mapped.needsManualReview,
    status: 'PENDING',
  };
}

export function isCommitableWallSuggestion(
  s: IfcWallSuggestionRow,
): s is IfcWallSuggestionRow & {
  shape: 'LINEAR' | 'CURVED';
  geometry: IfcWallSuggestionGeometry;
} {
  if (s.status !== 'ACCEPTED') return false;
  if (s.shape !== 'LINEAR' && s.shape !== 'CURVED') return false;
  if (!s.geometry) return false;
  const g = s.geometry;
  if (!(g.thickness > 0) || !(g.height > 0)) return false;
  if (s.shape === 'LINEAR') {
    return typeof g.length === 'number' && g.length > 0;
  }
  return (
    typeof g.radius === 'number' &&
    g.radius > 0 &&
    typeof g.arcAngleDeg === 'number' &&
    g.arcAngleDeg > 0
  );
}

export function nextPrefixedMarkSeed(
  prefix: string,
  existingMarks: string[],
): number {
  const re = new RegExp(`^${prefix}(\\d+)$`, 'i');
  let max = 0;
  for (const m of existingMarks) {
    const match = re.exec(String(m).trim());
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return max + 1;
}

export function nextWallMarkSeed(existingMarks: string[]): number {
  return nextPrefixedMarkSeed(WALL_INSTANCE_DEFAULTS.markPrefix, existingMarks);
}

export type WallInstanceCreateBody = {
  floorId: string;
  elementKey: 'WALLS';
  shape: 'LINEAR' | 'CURVED';
  mark: string;
  count: number;
  geometry: Record<string, number>;
  concreteGrade: string | null;
  reinforcement: Record<string, unknown>;
  spec: null;
  sourceGlobalId: string;
  location: string | null;
};

export function buildWallInstanceBodies(
  accepted: IfcWallSuggestionRow[],
  opts: {
    floorId: string;
    project: IProject;
    existingMarks: string[];
  },
): { bodies: WallInstanceCreateBody[]; skipped: string[] } {
  const bodies: WallInstanceCreateBody[] = [];
  const skipped: string[] = [];
  let seed = nextWallMarkSeed(opts.existingMarks);
  const usedMarks = new Set(
    opts.existingMarks.map((m) => m.trim().toUpperCase()),
  );

  const grade = opts.project.materials?.defaultConcreteGrade || 'C25/30';

  for (const s of accepted) {
    if (!isCommitableWallSuggestion(s)) {
      skipped.push(s.id);
      continue;
    }

    let mark = (s.mark || '').trim();
    if (!mark) {
      mark = `${WALL_INSTANCE_DEFAULTS.markPrefix}${seed}`;
      seed += 1;
    }
    const markKey = mark.toUpperCase();
    if (usedMarks.has(markKey)) {
      // Collision — assign next free W{n}
      while (usedMarks.has(`W${seed}`)) seed += 1;
      mark = `${WALL_INSTANCE_DEFAULTS.markPrefix}${seed}`;
      seed += 1;
    }
    usedMarks.add(mark.toUpperCase());

    const geometry: Record<string, number> = {
      thickness: s.geometry.thickness,
      height: s.geometry.height,
    };
    if (s.shape === 'LINEAR' && s.geometry.length != null) {
      geometry.length = s.geometry.length;
    }
    if (s.shape === 'CURVED') {
      if (s.geometry.radius != null) geometry.radius = s.geometry.radius;
      if (s.geometry.arcAngleDeg != null) {
        geometry.arcAngleDeg = s.geometry.arcAngleDeg;
      }
    }

    bodies.push({
      floorId: opts.floorId,
      elementKey: 'WALLS',
      shape: s.shape,
      mark,
      count: 1,
      geometry,
      concreteGrade: grade,
      reinforcement: { ...WALL_INSTANCE_DEFAULTS.rebar },
      spec: null,
      sourceGlobalId: s.sourceGlobalId,
      location: 'Interior',
    });
  }

  return { bodies, skipped };
}

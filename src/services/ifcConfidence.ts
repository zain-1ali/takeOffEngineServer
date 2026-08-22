/**
 * Shared three-tier IFC confidence scoring (HIGH / MEDIUM / LOW).
 * Element mappers call into this with their own domain notes/conditions;
 * thresholds stay in one place so Walls/Slabs/Foundations agree.
 */
export type IfcConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

export const IFC_CONFIDENCE_THRESHOLDS = {
  /** |dir·worldZ| / |dir| must be ≥ this for "vertical extrusion". */
  VERTICAL_DOT_MIN: 0.95,
  /**
   * Relative difference below which two profile dims are "nearly square"
   * (and the same value used for near-rectangular polygon detection).
   */
  NEAR_EQUAL_REL: 0.05,
  /** Relative agreement between Axis length and a profile dimension. */
  AXIS_DIM_TOLERANCE: 0.02,
} as const;

export type ConfidenceAccumulator = {
  confidence: IfcConfidenceTier;
  notes: string[];
  needsManualReview: boolean;
};

export function createConfidence(
  seedNotes: string[] = [],
): ConfidenceAccumulator {
  return {
    confidence: 'HIGH',
    notes: [...seedNotes],
    needsManualReview: false,
  };
}

export function addConfidenceNote(
  state: ConfidenceAccumulator,
  note: string,
): void {
  state.notes.push(note);
}

/** Force LOW + manual review and append a note. */
export function markConfidenceLow(
  state: ConfidenceAccumulator,
  note: string,
): void {
  state.notes.push(note);
  state.confidence = 'LOW';
  state.needsManualReview = true;
}

/** Downgrade HIGH → MEDIUM (optional note). Leaves LOW unchanged. */
export function markConfidenceMediumIfHigh(
  state: ConfidenceAccumulator,
  note?: string,
): void {
  if (note) state.notes.push(note);
  if (state.confidence === 'HIGH') state.confidence = 'MEDIUM';
}

export function relativeDifference(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, b);
}

export function dimensionsAgreeWithin(
  a: number,
  b: number,
  tolerance: number = IFC_CONFIDENCE_THRESHOLDS.AXIS_DIM_TOLERANCE,
): boolean {
  return relativeDifference(a, b) <= tolerance;
}

export function isNearSquareProfile(
  xDim: number,
  yDim: number,
  tolerance: number = IFC_CONFIDENCE_THRESHOLDS.NEAR_EQUAL_REL,
): boolean {
  return relativeDifference(xDim, yDim) < tolerance;
}

export function isVerticalExtrusion(
  dir: { x: number; y: number; z: number } | null | undefined,
  minDot: number = IFC_CONFIDENCE_THRESHOLDS.VERTICAL_DOT_MIN,
): boolean {
  if (!dir) return false;
  const mag = Math.hypot(dir.x, dir.y, dir.z);
  if (!(mag > 0)) return false;
  return Math.abs(dir.z) / mag >= minDot;
}

/**
 * World extrusion lies in XY (typical IfcBeamStandardCase sweep along span).
 * Complementary to isVerticalExtrusion: |z|/|dir| ≤ 1 − VERTICAL_DOT_MIN.
 */
export function isHorizontalExtrusion(
  dir: { x: number; y: number; z: number } | null | undefined,
  minDot: number = IFC_CONFIDENCE_THRESHOLDS.VERTICAL_DOT_MIN,
): boolean {
  if (!dir) return false;
  const mag = Math.hypot(dir.x, dir.y, dir.z);
  if (!(mag > 0)) return false;
  return Math.abs(dir.z) / mag <= 1 - minDot;
}

/**
 * IfcAxis2Placement3D.Position.Axis is optional; IFC defaults an omitted axis
 * to +Z. An explicit non-vertical axis means the swept profile plane is tilted,
 * even when a compensating local extrusion composes to a vertical world vector.
 */
export function isUprightPositionAxis(
  positionAxis: { x: number; y: number; z: number } | null | undefined,
  minDot: number = IFC_CONFIDENCE_THRESHOLDS.VERTICAL_DOT_MIN,
): boolean {
  return positionAxis == null || isVerticalExtrusion(positionAxis, minDot);
}

/** Both checks required for an upright vertical extrusion classification. */
export function isUprightVerticalExtrusion(
  worldExtrusionDirection: {
    x: number;
    y: number;
    z: number;
  } | null | undefined,
  positionAxis: { x: number; y: number; z: number } | null | undefined,
  minDot: number = IFC_CONFIDENCE_THRESHOLDS.VERTICAL_DOT_MIN,
): boolean {
  return (
    isVerticalExtrusion(worldExtrusionDirection, minDot) &&
    isUprightPositionAxis(positionAxis, minDot)
  );
}

/** Round metres for suggestion geometry / notes (3 decimal places). */
export function roundMetres3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Raft is not auto-mapped this round. Real files model on-grade / foundation
 * plates as IfcSlab BASESLAB (or large untyped IfcFooting) without a reliable
 * raft vs ground-slab discriminator — flag for manual review instead.
 */
export const POSSIBLE_RAFT_FOUNDATION_NOTE =
  'Possible raft foundation, review manually — raft is not auto-mapped this round';

/**
 * Apply common extrusion preconditions shared by most extruded elements:
 * positive depth, known length unit, optional vertical-world-extrusion check.
 */
export function applyExtrusionConfidenceBasics(
  state: ConfidenceAccumulator,
  opts: {
    depth: number | null | undefined;
    lengthUnitKnown: boolean;
    worldExtrusionDirection: {
      x: number;
      y: number;
      z: number;
    } | null;
    /** Swept solid Position.Axis; omitted/null means IFC's default +Z. */
    positionAxis: { x: number; y: number; z: number } | null;
    /** When true, non-vertical world extrusion is marked LOW. */
    requireVerticalExtrusion: boolean;
    /** Defaults to true whenever vertical extrusion is required. */
    requireUprightPosition?: boolean;
    verticalDotMin?: number;
    nonVerticalNote?: string;
    tiltedPositionNote?: string;
  },
): { ok: boolean; depth: number; orientationOk: boolean } {
  const depth = opts.depth;
  if (depth == null || !(depth > 0)) {
    markConfidenceLow(
      state,
      'Missing or non-positive extrusion depth (height)',
    );
    return { ok: false, depth: 0, orientationOk: false };
  }

  if (!opts.lengthUnitKnown) {
    markConfidenceLow(
      state,
      'IFC length unit could not be resolved — values may not be metres',
    );
  } else {
    addConfidenceNote(state, 'Length values normalized to metres');
  }

  let orientationOk = true;
  if (opts.requireVerticalExtrusion) {
    const minDot =
      opts.verticalDotMin ?? IFC_CONFIDENCE_THRESHOLDS.VERTICAL_DOT_MIN;
    if (!isVerticalExtrusion(opts.worldExtrusionDirection, minDot)) {
      orientationOk = false;
      markConfidenceLow(
        state,
        opts.worldExtrusionDirection
          ? opts.nonVerticalNote ||
              'World extrusion direction is not vertical — unusual for this element mapping'
          : 'World extrusion direction could not be resolved through placements',
      );
    } else if (
      opts.requireUprightPosition !== false &&
      !isUprightPositionAxis(opts.positionAxis, minDot)
    ) {
      orientationOk = false;
      markConfidenceLow(
        state,
        opts.tiltedPositionNote ||
          'Swept-solid Position.Axis is tilted despite a vertical world extrusion — possible sloped/tilted geometry, review manually',
      );
    } else {
      addConfidenceNote(
        state,
        opts.requireUprightPosition === false
          ? 'Vertical extrusion'
          : 'Vertical extrusion with upright swept-solid placement',
      );
    }
  }

  return { ok: true, depth, orientationOk };
}

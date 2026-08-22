/**
 * Element-agnostic closed-polygon → rectangle detection.
 * Authoring tools often export rectangles as IfcArbitraryClosedProfileDef;
 * Walls, Slabs, Foundations, and future mappers share this path.
 */
export type Point2 = { x: number; y: number };

/** Same 5% relative tolerance used for near-square profile ambiguity. */
export const IFC_RECTANGLE_TOLERANCE = 0.05;
const COLLINEAR_EPSILON = 1e-7;

function relativeDifference(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, b);
}

function pointDistance(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Drop duplicate closing vertices and collinear mid-edge points.
 * Used by rectangle detection and by column L/T/Cruciform classification.
 * Returns null when the ring is degenerate.
 */
export function simplifyClosedPolygon(
  boundaryPoints: Point2[] | undefined,
): Point2[] | null {
  if (!boundaryPoints || boundaryPoints.length < 3) return null;
  if (
    boundaryPoints.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    return null;
  }

  const span = Math.max(
    1,
    ...boundaryPoints.map((point) => Math.abs(point.x)),
    ...boundaryPoints.map((point) => Math.abs(point.y)),
  );
  const duplicateEpsilon = span * Number.EPSILON * 100;
  const points: Point2[] = [];
  for (const point of boundaryPoints) {
    if (
      !points.length ||
      pointDistance(points[points.length - 1], point) > duplicateEpsilon
    ) {
      points.push(point);
    }
  }
  if (
    points.length > 1 &&
    pointDistance(points[0], points[points.length - 1]) <= duplicateEpsilon
  ) {
    points.pop();
  }
  if (points.length < 3) return null;

  // Some exporters add intermediate points on otherwise straight edges.
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = 0; i < points.length; i += 1) {
      const prev = points[(i - 1 + points.length) % points.length];
      const current = points[i];
      const next = points[(i + 1) % points.length];
      const ax = current.x - prev.x;
      const ay = current.y - prev.y;
      const bx = next.x - current.x;
      const by = next.y - current.y;
      const aLen = Math.hypot(ax, ay);
      const bLen = Math.hypot(bx, by);
      if (!(aLen > 0) || !(bLen > 0)) return null;
      const normalizedCross = Math.abs(ax * by - ay * bx) / (aLen * bLen);
      const normalizedDot = (ax * bx + ay * by) / (aLen * bLen);
      if (normalizedCross <= COLLINEAR_EPSILON && normalizedDot > 0) {
        points.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return points.length >= 3 ? points : null;
}

/**
 * Derive the two side dimensions only when a polygon is rectangular.
 * Rotation is allowed. Repeated closing points and exactly-collinear points
 * along an edge are ignored; curved/tessellated and genuinely irregular
 * boundaries do not collapse to four valid corners.
 */
export function rectangularPolygonDimensions(
  boundaryPoints: Point2[] | undefined,
): { xDim: number; yDim: number } | null {
  const points = simplifyClosedPolygon(boundaryPoints);
  if (!points || points.length !== 4) return null;

  const edges = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const x = next.x - point.x;
    const y = next.y - point.y;
    return { x, y, length: Math.hypot(x, y) };
  });
  if (edges.some((edge) => !(edge.length > 0))) return null;

  if (
    relativeDifference(edges[0].length, edges[2].length) >
      IFC_RECTANGLE_TOLERANCE ||
    relativeDifference(edges[1].length, edges[3].length) >
      IFC_RECTANGLE_TOLERANCE
  ) {
    return null;
  }

  const normalizedDot = (
    a: (typeof edges)[number],
    b: (typeof edges)[number],
  ) => (a.x * b.x + a.y * b.y) / (a.length * b.length);
  const normalizedCross = (
    a: (typeof edges)[number],
    b: (typeof edges)[number],
  ) => (a.x * b.y - a.y * b.x) / (a.length * b.length);

  for (let i = 0; i < edges.length; i += 1) {
    if (
      Math.abs(normalizedDot(edges[i], edges[(i + 1) % edges.length])) >
      IFC_RECTANGLE_TOLERANCE
    ) {
      return null;
    }
  }
  if (
    Math.abs(normalizedCross(edges[0], edges[2])) > IFC_RECTANGLE_TOLERANCE ||
    Math.abs(normalizedCross(edges[1], edges[3])) > IFC_RECTANGLE_TOLERANCE ||
    normalizedDot(edges[0], edges[2]) >= 0 ||
    normalizedDot(edges[1], edges[3]) >= 0
  ) {
    return null;
  }

  return {
    xDim: (edges[0].length + edges[2].length) / 2,
    yDim: (edges[1].length + edges[3].length) / 2,
  };
}

export type ProfileLike = {
  type: string;
  xDim?: number;
  yDim?: number;
  boundaryPoints?: Point2[];
};

/**
 * Resolve rectangle XDim/YDim from a native rectangle profile or a
 * near-rectangular arbitrary closed polygon.
 */
export function resolveRectangleProfileDims(
  profile: ProfileLike | null | undefined,
): {
  ok: boolean;
  xDim?: number;
  yDim?: number;
  derivedFromArbitrary: boolean;
  unsupportedNote?: string;
} {
  if (!profile) {
    return {
      ok: false,
      derivedFromArbitrary: false,
      unsupportedNote: 'No swept profile on extrusion',
    };
  }

  if (profile.type === 'IfcRectangleProfileDef') {
    const xDim = profile.xDim;
    const yDim = profile.yDim;
    if (xDim == null || yDim == null || !(xDim > 0) || !(yDim > 0)) {
      return {
        ok: false,
        derivedFromArbitrary: false,
        unsupportedNote: 'Rectangle profile missing XDim/YDim',
      };
    }
    return { ok: true, xDim, yDim, derivedFromArbitrary: false };
  }

  if (profile.type === 'IfcArbitraryClosedProfileDef') {
    const derived = rectangularPolygonDimensions(profile.boundaryPoints);
    if (derived) {
      return {
        ok: true,
        xDim: derived.xDim,
        yDim: derived.yDim,
        derivedFromArbitrary: true,
      };
    }
    return {
      ok: false,
      derivedFromArbitrary: false,
      unsupportedNote:
        'IfcArbitraryClosedProfileDef boundary is not rectangular within the 5% tolerance — curved/axis mapping not auto-derived',
    };
  }

  return {
    ok: false,
    derivedFromArbitrary: false,
    unsupportedNote: `Profile type ${profile.type} is not IfcRectangleProfileDef — curved/axis mapping not auto-derived`,
  };
}

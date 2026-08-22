/**
 * Identify IfcColumn swept profiles as one of the five Columns shapes:
 * Rectangular, Circular, L-shaped, T-shaped, Cruciform.
 *
 * Rectangle detection is the shared polygon helper. Circular covers native
 * IfcCircleProfileDef and tessellated closed polygons. L/T/Cruciform are
 * orthogonal arbitrary polygons identified by vertex count, concave corners,
 * and cell occupancy — never forced when the pattern is ambiguous.
 */
import { relativeDifference } from './ifcConfidence';
import type { IfcRawProfile } from './ifcImport';
import {
  IFC_RECTANGLE_TOLERANCE,
  type Point2,
  rectangularPolygonDimensions,
  resolveRectangleProfileDims,
  simplifyClosedPolygon,
} from './ifcRectangleProfile';

export type ColumnProfileSource =
  | 'NATIVE_RECTANGLE'
  | 'ARBITRARY_RECTANGLE'
  | 'NATIVE_CIRCLE'
  | 'ARBITRARY_CIRCLE'
  | 'NATIVE_LSHAPE'
  | 'ARBITRARY_LSHAPE'
  | 'NATIVE_TSHAPE'
  | 'ARBITRARY_TSHAPE'
  | 'ARBITRARY_CRUCIFORM';

export type ColumnProfileClassification =
  | {
      ok: true;
      shape: 'RECTANGULAR';
      width: number;
      depth: number;
      source: 'NATIVE_RECTANGLE' | 'ARBITRARY_RECTANGLE';
    }
  | {
      ok: true;
      shape: 'CIRCULAR';
      diameter: number;
      source: 'NATIVE_CIRCLE' | 'ARBITRARY_CIRCLE';
    }
  | {
      ok: true;
      shape: 'L_SHAPED';
      width: number;
      depth: number;
      legThickness: number;
      source: 'NATIVE_LSHAPE' | 'ARBITRARY_LSHAPE';
    }
  | {
      ok: true;
      shape: 'T_SHAPED';
      flangeWidth: number;
      overallDepth: number;
      flangeThickness: number;
      webThickness: number;
      source: 'NATIVE_TSHAPE' | 'ARBITRARY_TSHAPE';
    }
  | {
      ok: true;
      shape: 'CRUCIFORM';
      width: number;
      depth: number;
      armThickness: number;
      source: 'ARBITRARY_CRUCIFORM';
    }
  | { ok: false; reason: string };

const DIM_TOL = IFC_RECTANGLE_TOLERANCE;
/** Tessellated circles need enough samples; octagons are not auto-mapped. */
const MIN_CIRCLE_VERTICES = 12;
const SLOPE_EPS = 1e-6;
/** A regular 12-gon is 95.5% of its circumcircle; lower is not circle-like. */
const MIN_CIRCUMSCRIBED_AREA_RATIO = 0.95;

function dimsAgree(a: number, b: number): boolean {
  return relativeDifference(a, b) <= DIM_TOL;
}

function polygonSignedArea(points: Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  return area / 2;
}

function concaveVertexCount(points: Point2[]): number {
  const ccw = polygonSignedArea(points) > 0;
  let count = 0;
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i - 1 + points.length) % points.length];
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const cross =
      (current.x - prev.x) * (next.y - current.y) -
      (current.y - prev.y) * (next.x - current.x);
    const isConcave = ccw ? cross < 0 : cross > 0;
    if (isConcave) count += 1;
  }
  return count;
}

function pointInPolygon(point: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function uniqueSorted(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (!out.length || value - out[out.length - 1] > tol) {
      out.push(value);
    }
  }
  return out;
}

function toLocalFrame(points: Point2[]): Point2[] | null {
  const edge = {
    x: points[1].x - points[0].x,
    y: points[1].y - points[0].y,
  };
  const len = Math.hypot(edge.x, edge.y);
  if (!(len > 0)) return null;
  const ux = edge.x / len;
  const uy = edge.y / len;
  const vx = -uy;
  const vy = ux;
  return points.map((point) => ({
    x: point.x * ux + point.y * uy,
    y: point.x * vx + point.y * vy,
  }));
}

function isAxisAlignedOrthogonal(local: Point2[]): boolean {
  for (let i = 0; i < local.length; i += 1) {
    const next = local[(i + 1) % local.length];
    const du = next.x - local[i].x;
    const dv = next.y - local[i].y;
    const len = Math.hypot(du, dv);
    if (!(len > 0)) return false;
    if (Math.min(Math.abs(du), Math.abs(dv)) / len > DIM_TOL) return false;
  }
  return true;
}

function occupancyGrid(
  uniqueU: number[],
  uniqueV: number[],
  local: Point2[],
): boolean[][] {
  const rows: boolean[][] = [];
  for (let j = 0; j < uniqueV.length - 1; j += 1) {
    const row: boolean[] = [];
    for (let i = 0; i < uniqueU.length - 1; i += 1) {
      row.push(
        pointInPolygon(
          {
            x: (uniqueU[i] + uniqueU[i + 1]) / 2,
            y: (uniqueV[j] + uniqueV[j + 1]) / 2,
          },
          local,
        ),
      );
    }
    rows.push(row);
  }
  return rows;
}

function occupiedCount(grid: boolean[][]): number {
  return grid.reduce(
    (sum, row) => sum + row.filter((cell) => cell).length,
    0,
  );
}

function classifyCircularPolygon(
  boundaryPoints: Point2[] | undefined,
): { diameter: number } | null {
  const points = simplifyClosedPolygon(boundaryPoints);
  if (!points || points.length < MIN_CIRCLE_VERTICES) return null;
  if (rectangularPolygonDimensions(boundaryPoints)) return null;
  if (concaveVertexCount(points) !== 0) return null;

  const cx =
    points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy =
    points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const radii = points.map((point) => Math.hypot(point.x - cx, point.y - cy));
  const rMean =
    radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
  if (!(rMean > 0)) return null;
  if (radii.some((radius) => relativeDifference(radius, rMean) > DIM_TOL)) {
    return null;
  }
  const areaRatio =
    Math.abs(polygonSignedArea(points)) / (Math.PI * rMean * rMean);
  if (areaRatio < MIN_CIRCUMSCRIBED_AREA_RATIO || areaRatio > 1 + DIM_TOL) {
    return null;
  }
  return { diameter: 2 * rMean };
}

function classifyOrthogonalSpecial(
  boundaryPoints: Point2[] | undefined,
): ColumnProfileClassification | null {
  const points = simplifyClosedPolygon(boundaryPoints);
  if (!points) return null;
  const local = toLocalFrame(points);
  if (!local || !isAxisAlignedOrthogonal(local)) return null;

  const span = Math.max(
    ...local.map((point) => Math.abs(point.x)),
    ...local.map((point) => Math.abs(point.y)),
    1e-6,
  );
  const clusterTol = Math.max(1e-4, 0.005 * span);
  const uniqueU = uniqueSorted(
    local.map((point) => point.x),
    clusterTol,
  );
  const uniqueV = uniqueSorted(
    local.map((point) => point.y),
    clusterTol,
  );
  if (uniqueU.length < 2 || uniqueV.length < 2) return null;

  const grid = occupancyGrid(uniqueU, uniqueV, local);
  const concave = concaveVertexCount(points);
  const cols = uniqueU.length - 1;
  const rows = uniqueV.length - 1;
  const uGaps = uniqueU.slice(1).map((u, i) => u - uniqueU[i]);
  const vGaps = uniqueV.slice(1).map((v, i) => v - uniqueV[i]);
  const widthU = uniqueU[uniqueU.length - 1] - uniqueU[0];
  const depthV = uniqueV[uniqueV.length - 1] - uniqueV[0];

  if (
    points.length === 6 &&
    concave === 1 &&
    cols === 2 &&
    rows === 2 &&
    occupiedCount(grid) === 3
  ) {
    const fullCol = [0, 1].find(
      (i) => grid[0][i] && grid[1][i],
    );
    const fullRow = [0, 1].find(
      (j) => grid[j][0] && grid[j][1],
    );
    if (fullCol == null || fullRow == null) return null;
    const tU = uGaps[fullCol];
    const tV = vGaps[fullRow];
    if (!(tU > 0) || !(tV > 0) || !dimsAgree(tU, tV)) return null;
    if (!(widthU > tU) || !(depthV > tV)) return null;
    return {
      ok: true,
      shape: 'L_SHAPED',
      width: widthU,
      depth: depthV,
      legThickness: (tU + tV) / 2,
      source: 'ARBITRARY_LSHAPE',
    };
  }

  const tryT = (
    uniqueAlongFlange: number[],
    uniqueAlongDepth: number[],
    flangeGaps: number[],
    depthGaps: number[],
    tGrid: boolean[][],
  ): ColumnProfileClassification | null => {
    if (
      uniqueAlongFlange.length !== 4 ||
      uniqueAlongDepth.length !== 3 ||
      tGrid.length !== 2 ||
      tGrid[0]?.length !== 3
    ) {
      return null;
    }
    const occupiedPerRow = tGrid.map((row) => row.filter(Boolean).length);
    const flangeRow = occupiedPerRow.findIndex((n) => n === 3);
    const webRow = occupiedPerRow.findIndex((n) => n === 1);
    if (flangeRow < 0 || webRow < 0 || flangeRow === webRow) return null;
    const webCol = tGrid[webRow].findIndex(Boolean);
    if (webCol !== 1) return null;
    // The supported T variant has a centred web; eccentric tees need modeling.
    if (!dimsAgree(flangeGaps[0], flangeGaps[2])) return null;
    const flangeWidth =
      uniqueAlongFlange[uniqueAlongFlange.length - 1] - uniqueAlongFlange[0];
    const overallDepth =
      uniqueAlongDepth[uniqueAlongDepth.length - 1] - uniqueAlongDepth[0];
    const flangeThickness = depthGaps[flangeRow];
    const webThickness = flangeGaps[webCol];
    if (
      !(flangeWidth > 0) ||
      !(overallDepth > 0) ||
      !(flangeThickness > 0) ||
      !(webThickness > 0) ||
      !(flangeThickness < overallDepth) ||
      !(webThickness < flangeWidth)
    ) {
      return null;
    }
    return {
      ok: true,
      shape: 'T_SHAPED',
      flangeWidth,
      overallDepth,
      flangeThickness,
      webThickness,
      source: 'ARBITRARY_TSHAPE',
    };
  };

  if (points.length === 8 && concave === 2 && occupiedCount(grid) === 4) {
    const asT =
      tryT(uniqueU, uniqueV, uGaps, vGaps, grid) ||
      tryT(
        uniqueV,
        uniqueU,
        vGaps,
        uGaps,
        grid[0].map((_, i) => grid.map((row) => row[i])),
      );
    if (asT) return asT;
  }

  if (
    points.length === 12 &&
    concave === 4 &&
    cols === 3 &&
    rows === 3 &&
    occupiedCount(grid) === 5
  ) {
    const plus = [
      [false, true, false],
      [true, true, true],
      [false, true, false],
    ];
    const matches = plus.every((row, j) =>
      row.every((cell, i) => grid[j][i] === cell),
    );
    if (!matches) return null;
    const armU = uGaps[1];
    const armV = vGaps[1];
    if (!(armU > 0) || !(armV > 0) || !dimsAgree(armU, armV)) return null;
    // The supported Cruciform variant has centred arms in both directions.
    if (!dimsAgree(uGaps[0], uGaps[2]) || !dimsAgree(vGaps[0], vGaps[2])) {
      return null;
    }
    if (!(widthU > armU) || !(depthV > armV)) return null;
    return {
      ok: true,
      shape: 'CRUCIFORM',
      width: widthU,
      depth: depthV,
      armThickness: (armU + armV) / 2,
      source: 'ARBITRARY_CRUCIFORM',
    };
  }

  return null;
}

function classifyNativeL(
  profile: IfcRawProfile,
): ColumnProfileClassification {
  const l = profile.lShape;
  if (!l || !(l.depth > 0) || !(l.width > 0) || !(l.thickness > 0)) {
    return {
      ok: false,
      reason: 'IfcLShapeProfileDef is missing Depth/Width/Thickness',
    };
  }
  if (l.legSlope != null && Math.abs(l.legSlope) > SLOPE_EPS) {
    return {
      ok: false,
      reason:
        'IfcLShapeProfileDef has a non-zero LegSlope — tapered L is not auto-mapped',
    };
  }
  if (
    (l.filletRadius != null && l.filletRadius > SLOPE_EPS) ||
    (l.edgeRadius != null && l.edgeRadius > SLOPE_EPS)
  ) {
    return {
      ok: false,
      reason:
        'IfcLShapeProfileDef has rounded fillet/edges that the sharp-corner L variant cannot represent',
    };
  }
  if (!(l.thickness < l.width) || !(l.thickness < l.depth)) {
    return {
      ok: false,
      reason:
        'IfcLShapeProfileDef Thickness is not smaller than both legs — review manually',
    };
  }
  return {
    ok: true,
    shape: 'L_SHAPED',
    width: l.width,
    depth: l.depth,
    legThickness: l.thickness,
    source: 'NATIVE_LSHAPE',
  };
}

function classifyNativeT(
  profile: IfcRawProfile,
): ColumnProfileClassification {
  const t = profile.tShape;
  if (
    !t ||
    !(t.depth > 0) ||
    !(t.flangeWidth > 0) ||
    !(t.webThickness > 0) ||
    !(t.flangeThickness > 0)
  ) {
    return {
      ok: false,
      reason:
        'IfcTShapeProfileDef is missing Depth/FlangeWidth/WebThickness/FlangeThickness',
    };
  }
  if (
    (t.webSlope != null && Math.abs(t.webSlope) > SLOPE_EPS) ||
    (t.flangeSlope != null && Math.abs(t.flangeSlope) > SLOPE_EPS)
  ) {
    return {
      ok: false,
      reason:
        'IfcTShapeProfileDef has a non-zero web/flange slope — tapered T is not auto-mapped',
    };
  }
  if (
    (t.filletRadius != null && t.filletRadius > SLOPE_EPS) ||
    (t.flangeEdgeRadius != null && t.flangeEdgeRadius > SLOPE_EPS) ||
    (t.webEdgeRadius != null && t.webEdgeRadius > SLOPE_EPS)
  ) {
    return {
      ok: false,
      reason:
        'IfcTShapeProfileDef has rounded fillet/edges that the sharp-corner T variant cannot represent',
    };
  }
  if (!(t.flangeThickness < t.depth) || !(t.webThickness < t.flangeWidth)) {
    return {
      ok: false,
      reason:
        'IfcTShapeProfileDef thicknesses do not fit inside the overall T — review manually',
    };
  }
  return {
    ok: true,
    shape: 'T_SHAPED',
    flangeWidth: t.flangeWidth,
    overallDepth: t.depth,
    flangeThickness: t.flangeThickness,
    webThickness: t.webThickness,
    source: 'NATIVE_TSHAPE',
  };
}

/**
 * Classify a column swept profile into one of the five Columns shapes.
 * Ambiguous / unsupported sections return ok: false — callers must not guess.
 */
export function classifyColumnProfile(
  profile: IfcRawProfile | null | undefined,
): ColumnProfileClassification {
  if (!profile) {
    return { ok: false, reason: 'No swept profile on extrusion' };
  }

  if (profile.type === 'IfcCircleHollowProfileDef') {
    return {
      ok: false,
      reason:
        'IfcCircleHollowProfileDef is a tube section — solid Circular is not auto-mapped',
    };
  }

  if (profile.type === 'IfcCircleProfileDef') {
    const radius = profile.radius;
    if (radius == null || !(radius > 0)) {
      return {
        ok: false,
        reason: 'IfcCircleProfileDef is missing a positive Radius',
      };
    }
    return {
      ok: true,
      shape: 'CIRCULAR',
      diameter: 2 * radius,
      source: 'NATIVE_CIRCLE',
    };
  }

  if (profile.type === 'IfcLShapeProfileDef') {
    return classifyNativeL(profile);
  }

  if (profile.type === 'IfcTShapeProfileDef') {
    return classifyNativeT(profile);
  }

  const rect = resolveRectangleProfileDims(profile);
  if (rect.ok && rect.xDim != null && rect.yDim != null) {
    return {
      ok: true,
      shape: 'RECTANGULAR',
      width: rect.xDim,
      depth: rect.yDim,
      source: rect.derivedFromArbitrary
        ? 'ARBITRARY_RECTANGLE'
        : 'NATIVE_RECTANGLE',
    };
  }

  if (profile.type === 'IfcArbitraryClosedProfileDef') {
    if (
      profile.outerCurveType === 'IfcCircle' &&
      profile.radius != null &&
      profile.radius > 0
    ) {
      return {
        ok: true,
        shape: 'CIRCULAR',
        diameter: 2 * profile.radius,
        source: 'ARBITRARY_CIRCLE',
      };
    }
    const circular = classifyCircularPolygon(profile.boundaryPoints);
    if (circular) {
      return {
        ok: true,
        shape: 'CIRCULAR',
        diameter: circular.diameter,
        source: 'ARBITRARY_CIRCLE',
      };
    }
    const special = classifyOrthogonalSpecial(profile.boundaryPoints);
    if (special) return special;
    return {
      ok: false,
      reason:
        'IfcArbitraryClosedProfileDef boundary is not a confident Rectangular, Circular, L, T, or Cruciform section — review manually',
    };
  }

  return {
    ok: false,
    reason:
      `Profile type ${profile.type} is not a supported column section — review manually`,
  };
}

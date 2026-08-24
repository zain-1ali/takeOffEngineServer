/** Image-space point (pixel coordinates on the source sheet PNG). */
export interface ImagePoint {
  x: number;
  y: number;
}

/** Euclidean distance between two image-space points (pixels). */
export function segmentLengthPx(a: ImagePoint, b: ImagePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

/**
 * Total length of a polyline in image pixels.
 * Requires at least 2 points; returns 0 otherwise.
 */
export function polylineLengthPx(points: readonly ImagePoint[]): number {
  if (points.length < 2) {
    return 0;
  }

  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += segmentLengthPx(points[i], points[i + 1]);
  }
  return total;
}

/**
 * Absolute area of a polygon in image pixel² via the shoelace formula.
 * Vertices may be clockwise or counter-clockwise; result is always ≥ 0.
 * Requires at least 3 points; returns 0 otherwise.
 *
 * A = 1/2 * |Σ (x_i * y_{i+1} - x_{i+1} * y_i)|  (with y_n = y_0, x_n = x_0)
 */
export function polygonAreaPx2(points: readonly ImagePoint[]): number {
  if (points.length < 3) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }

  return Math.abs(sum) / 2;
}

/**
 * Convert image-pixel length to real-world length.
 * `unitsPerPixel` is the sheet calibrationScale (e.g. ft/px).
 */
export function toRealLength(
  lengthPx: number,
  unitsPerPixel: number,
): number {
  return lengthPx * unitsPerPixel;
}

/**
 * Convert image-pixel² area to real-world area.
 * Linear scale is units/px, so area scale is (units/px)².
 */
export function toRealArea(areaPx2: number, unitsPerPixel: number): number {
  return areaPx2 * unitsPerPixel * unitsPerPixel;
}

export function areaUnitLabel(linearUnit: string): string {
  return `${linearUnit}²`;
}

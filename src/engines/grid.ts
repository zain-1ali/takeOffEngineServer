/**
 * Orthogonal axis-grid helpers for optional placement / span length.
 *
 * Documented assumption: X and Y axes meet at right angles. Diagonal
 * lengths therefore use the Euclidean formula L = √(Δx² + Δy²) in that
 * plane. Skewed / non-orthogonal grids are out of scope — the same class
 * of deliberate estimating simplification used for spiral/helical
 * average-radius development and waffle-rib inclusion-exclusion.
 */
import { round } from './math';

export type AxisLine = { label: string; spacing: number };

export type AxisGrid = {
  xAxes: AxisLine[];
  yAxes: AxisLine[];
};

export type GridPoint = {
  gridX: string;
  gridY: string;
  gridRef: string;
  x: number;
  y: number;
};

/** Cumulative centre-line positions (m). First axis is always at 0. */
export function cumulativePositions(axes: AxisLine[]): number[] {
  let acc = 0;
  return axes.map((axis, index) => {
    acc += index === 0 ? 0 : axis.spacing || 0;
    return acc;
  });
}

export function gridRef(gridX: string, gridY: string): string {
  return `${gridX}-${gridY}`;
}

export function findAxisIndex(axes: AxisLine[], label: string): number {
  return axes.findIndex((axis) => axis.label === label);
}

export function gridPoint(
  grid: AxisGrid,
  gridX: string,
  gridY: string,
): GridPoint | null {
  const xs = cumulativePositions(grid.xAxes);
  const ys = cumulativePositions(grid.yAxes);
  const xi = findAxisIndex(grid.xAxes, gridX);
  const yi = findAxisIndex(grid.yAxes, gridY);
  if (xi < 0 || yi < 0) return null;
  return {
    gridX,
    gridY,
    gridRef: gridRef(gridX, gridY),
    x: xs[xi],
    y: ys[yi],
  };
}

/**
 * Centre-to-centre span length between two intersections on an orthogonal
 * grid. Reduces to |Δx| or |Δy| for axis-aligned spans.
 */
export function spanLengthBetween(
  grid: AxisGrid,
  startX: string,
  startY: string,
  endX: string,
  endY: string,
): number | null {
  const start = gridPoint(grid, startX, startY);
  const end = gridPoint(grid, endX, endY);
  if (!start || !end) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return round(Math.sqrt(dx * dx + dy * dy), 4);
}

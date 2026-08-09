import {
  cumulativePositions,
  gridPoint,
  gridRef,
  spanLengthBetween,
  type AxisGrid,
} from '../grid';

/** Default project grid (matches projectDefaults.DEFAULT_GRID). */
const DEFAULT_GRID: AxisGrid = {
  xAxes: [
    { label: 'A', spacing: 0 },
    { label: 'B', spacing: 6 },
    { label: 'C', spacing: 6 },
    { label: 'D', spacing: 7.5 },
  ],
  yAxes: [
    { label: '1', spacing: 0 },
    { label: '2', spacing: 5 },
    { label: '3', spacing: 5 },
    { label: '4', spacing: 6 },
  ],
};

describe('orthogonal axis grid', () => {
  it('cumulates centre-to-centre spacings with the first axis at 0', () => {
    expect(cumulativePositions(DEFAULT_GRID.xAxes)).toEqual([0, 6, 12, 19.5]);
    expect(cumulativePositions(DEFAULT_GRID.yAxes)).toEqual([0, 5, 10, 16]);
  });

  it('builds intersection labels as X-Y', () => {
    expect(gridRef('B', '3')).toBe('B-3');
    expect(gridPoint(DEFAULT_GRID, 'B', '3')).toEqual({
      gridX: 'B',
      gridY: '3',
      gridRef: 'B-3',
      x: 6,
      y: 10,
    });
  });

  it('reduces orthogonal spans to pure spacing sums', () => {
    // A-1 → C-1: Δx = 12, Δy = 0.
    expect(spanLengthBetween(DEFAULT_GRID, 'A', '1', 'C', '1')).toBe(12);
    // B-1 → B-4: Δx = 0, Δy = 16.
    expect(spanLengthBetween(DEFAULT_GRID, 'B', '1', 'B', '4')).toBe(16);
  });

  it('uses Euclidean distance for diagonal spans on an orthogonal grid', () => {
    // Hand-check: A-1 → C-3 on the default grid.
    // X: A=0, B=+6, C=+6 → C at 12 m.
    // Y: 1=0, 2=+5, 3=+5 → 3 at 10 m.
    // L = √(12² + 10²) = √244 = 15.620499… → 15.6205 m (4 d.p.).
    expect(spanLengthBetween(DEFAULT_GRID, 'A', '1', 'C', '3')).toBe(15.6205);
  });
});

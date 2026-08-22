/**
 * Element-agnostic polygon → rectangle unit tests (shared with Walls/Slabs/…).
 */
import {
  rectangularPolygonDimensions,
  resolveRectangleProfileDims,
  simplifyClosedPolygon,
} from '../../services/ifcRectangleProfile';

describe('rectangularPolygonDimensions', () => {
  it('detects an axis-aligned rectangle', () => {
    expect(
      rectangularPolygonDimensions([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 0.25 },
        { x: 0, y: 0.25 },
        { x: 0, y: 0 },
      ]),
    ).toEqual({ xDim: 5, yDim: 0.25 });
  });

  it('rejects a clearly non-rectangular pentagon', () => {
    expect(
      rectangularPolygonDimensions([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 5, y: 1 },
        { x: 4, y: 2 },
        { x: 0, y: 2 },
      ]),
    ).toBeNull();
  });

  it('simplifyClosedPolygon drops collinear mid-edge points', () => {
    const simplified = simplifyClosedPolygon([
      { x: 0, y: 0 },
      { x: 2.5, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 0.25 },
      { x: 0, y: 0.25 },
      { x: 0, y: 0 },
    ]);
    expect(simplified).toHaveLength(4);
  });
});

describe('resolveRectangleProfileDims', () => {
  it('passes through IfcRectangleProfileDef', () => {
    expect(
      resolveRectangleProfileDims({
        type: 'IfcRectangleProfileDef',
        xDim: 5,
        yDim: 0.2,
      }),
    ).toEqual({
      ok: true,
      xDim: 5,
      yDim: 0.2,
      derivedFromArbitrary: false,
    });
  });

  it('derives dims from a rectangular arbitrary profile', () => {
    const r = resolveRectangleProfileDims({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 0.3 },
        { x: 0, y: 0.3 },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.derivedFromArbitrary).toBe(true);
    expect(r.xDim).toBeCloseTo(4);
    expect(r.yDim).toBeCloseTo(0.3);
  });
});

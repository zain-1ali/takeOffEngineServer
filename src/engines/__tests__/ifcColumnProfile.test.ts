import { classifyColumnProfile } from '../../services/ifcColumnProfile';
import { simplifyClosedPolygon } from '../../services/ifcRectangleProfile';

/** Hand-check L: overall 0.6×0.5, equal leg t=0.2, one concave corner. */
const L_POINTS = [
  { x: 0, y: 0 },
  { x: 0.6, y: 0 },
  { x: 0.6, y: 0.2 },
  { x: 0.2, y: 0.2 },
  { x: 0.2, y: 0.5 },
  { x: 0, y: 0.5 },
];

/** Hand-check T: flange 0.6, overall depth 0.5, tf=tw=0.2. */
const T_POINTS = [
  { x: -0.1, y: 0 },
  { x: 0.1, y: 0 },
  { x: 0.1, y: 0.3 },
  { x: 0.3, y: 0.3 },
  { x: 0.3, y: 0.5 },
  { x: -0.3, y: 0.5 },
  { x: -0.3, y: 0.3 },
  { x: -0.1, y: 0.3 },
];

/** Hand-check cruciform: overall 0.8×0.6, equal arm t=0.2. */
const CROSS_POINTS = [
  { x: -0.1, y: -0.3 },
  { x: 0.1, y: -0.3 },
  { x: 0.1, y: -0.1 },
  { x: 0.4, y: -0.1 },
  { x: 0.4, y: 0.1 },
  { x: 0.1, y: 0.1 },
  { x: 0.1, y: 0.3 },
  { x: -0.1, y: 0.3 },
  { x: -0.1, y: 0.1 },
  { x: -0.4, y: 0.1 },
  { x: -0.4, y: -0.1 },
  { x: -0.1, y: -0.1 },
];

function circlePoints(diameter: number, n: number) {
  const r = diameter / 2;
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
}

function transformed(
  points: Array<{ x: number; y: number }>,
  angle: number,
  reverse = false,
) {
  const source = reverse ? [...points].reverse() : points;
  return source.map(({ x, y }) => ({
    x: x * Math.cos(angle) - y * Math.sin(angle) + 2.3,
    y: x * Math.sin(angle) + y * Math.cos(angle) - 1.7,
  }));
}

describe('classifyColumnProfile', () => {
  it('passes through IfcRectangleProfileDef', () => {
    const r = classifyColumnProfile({
      type: 'IfcRectangleProfileDef',
      xDim: 0.4,
      yDim: 0.3,
    });
    expect(r).toEqual({
      ok: true,
      shape: 'RECTANGULAR',
      width: 0.4,
      depth: 0.3,
      source: 'NATIVE_RECTANGLE',
    });
  });

  it('passes through IfcCircleProfileDef as diameter = 2×Radius', () => {
    const r = classifyColumnProfile({
      type: 'IfcCircleProfileDef',
      radius: 0.2,
    });
    expect(r).toEqual({
      ok: true,
      shape: 'CIRCULAR',
      diameter: 0.4,
      source: 'NATIVE_CIRCLE',
    });
  });

  it('does not map IfcCircleHollowProfileDef as solid Circular', () => {
    const r = classifyColumnProfile({
      type: 'IfcCircleHollowProfileDef',
      radius: 0.2,
    });
    expect(r.ok).toBe(false);
  });

  it('identifies an L-shaped 6-gon with one concave corner', () => {
    const r = classifyColumnProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: L_POINTS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shape).toBe('L_SHAPED');
    expect(r.source).toBe('ARBITRARY_LSHAPE');
    if (r.shape === 'L_SHAPED') {
      expect(r.width).toBeCloseTo(0.6);
      expect(r.depth).toBeCloseTo(0.5);
      expect(r.legThickness).toBeCloseTo(0.2);
    }
  });

  it('still identifies L after collinear mid-edge points are simplified', () => {
    const withMid = [
      { x: 0, y: 0 },
      { x: 0.3, y: 0 },
      { x: 0.6, y: 0 },
      { x: 0.6, y: 0.2 },
      { x: 0.2, y: 0.2 },
      { x: 0.2, y: 0.5 },
      { x: 0, y: 0.5 },
    ];
    expect(simplifyClosedPolygon(withMid)?.length).toBe(6);
    const r = classifyColumnProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: withMid,
    });
    expect(r.ok && r.shape === 'L_SHAPED').toBe(true);
  });

  it('rejects an L with unequal leg thicknesses instead of guessing t', () => {
    const unequal = [
      { x: 0, y: 0 },
      { x: 0.6, y: 0 },
      { x: 0.6, y: 0.2 },
      { x: 0.15, y: 0.2 },
      { x: 0.15, y: 0.5 },
      { x: 0, y: 0.5 },
    ];
    const r = classifyColumnProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: unequal,
    });
    expect(r.ok).toBe(false);
  });

  it('identifies a T-shaped 8-gon with two concave corners', () => {
    const r = classifyColumnProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: T_POINTS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shape).toBe('T_SHAPED');
    if (r.shape === 'T_SHAPED') {
      expect(r.flangeWidth).toBeCloseTo(0.6);
      expect(r.overallDepth).toBeCloseTo(0.5);
      expect(r.flangeThickness).toBeCloseTo(0.2);
      expect(r.webThickness).toBeCloseTo(0.2);
    }
  });

  it('rejects an eccentric T that the centred T variant cannot represent', () => {
    const eccentricT = [
      { x: -0.1, y: 0 },
      { x: 0.1, y: 0 },
      { x: 0.1, y: 0.3 },
      { x: 0.4, y: 0.3 },
      { x: 0.4, y: 0.5 },
      { x: -0.2, y: 0.5 },
      { x: -0.2, y: 0.3 },
      { x: -0.1, y: 0.3 },
    ];
    expect(
      classifyColumnProfile({
        type: 'IfcArbitraryClosedProfileDef',
        boundaryPoints: eccentricT,
      }).ok,
    ).toBe(false);
  });

  it('identifies a cruciform 12-gon with four concave corners', () => {
    const r = classifyColumnProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: CROSS_POINTS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shape).toBe('CRUCIFORM');
    if (r.shape === 'CRUCIFORM') {
      expect(r.width).toBeCloseTo(0.8);
      expect(r.depth).toBeCloseTo(0.6);
      expect(r.armThickness).toBeCloseTo(0.2);
    }
  });

  it('rejects an eccentric cross that the centred Cruciform variant cannot represent', () => {
    const eccentricCross = CROSS_POINTS.map(({ x, y }) => ({
      x: Math.abs(y) > 0.1 ? x - 0.05 : x,
      y,
    }));
    expect(
      classifyColumnProfile({
        type: 'IfcArbitraryClosedProfileDef',
        boundaryPoints: eccentricCross,
      }).ok,
    ).toBe(false);
  });

  it.each([
    ['L_SHAPED', L_POINTS],
    ['T_SHAPED', T_POINTS],
    ['CRUCIFORM', CROSS_POINTS],
  ] as const)(
    'is invariant to rotation, translation, winding, and start vertex for %s',
    (shape, points) => {
      for (const reverse of [false, true]) {
        for (let start = 0; start < points.length; start += 1) {
          const shifted = points.map(
            (_, index) => points[(index + start) % points.length],
          );
          const result = classifyColumnProfile({
            type: 'IfcArbitraryClosedProfileDef',
            boundaryPoints: transformed(shifted, 0.713, reverse),
          });
          expect(result.ok && result.shape).toBe(shape);
        }
      }
    },
  );

  it('identifies a tessellated circular arbitrary profile (n≥12)', () => {
    const r = classifyColumnProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: circlePoints(0.4, 16),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shape).toBe('CIRCULAR');
    if (r.shape === 'CIRCULAR') {
      expect(r.diameter).toBeCloseTo(0.4, 5);
      expect(r.source).toBe('ARBITRARY_CIRCLE');
    }
  });

  it('identifies an arbitrary profile whose OuterCurve is an IfcCircle', () => {
    expect(
      classifyColumnProfile({
        type: 'IfcArbitraryClosedProfileDef',
        outerCurveType: 'IfcCircle',
        radius: 0.2,
      }),
    ).toEqual({
      ok: true,
      shape: 'CIRCULAR',
      diameter: 0.4,
      source: 'ARBITRARY_CIRCLE',
    });
  });

  it('rejects a sparse irregular cyclic 12-gon rather than calling it circular', () => {
    const baseAngles = [0, 0.03, 0.06, 0.5, 1.5, 2.8];
    const angles = [
      ...baseAngles,
      ...baseAngles.map((angle) => angle + Math.PI),
    ].sort((a, b) => a - b);
    const boundaryPoints = angles.map((angle) => ({
      x: 0.2 * Math.cos(angle),
      y: 0.2 * Math.sin(angle),
    }));
    expect(
      classifyColumnProfile({
        type: 'IfcArbitraryClosedProfileDef',
        boundaryPoints,
      }).ok,
    ).toBe(false);
  });

  it('does not force an octagon into Circular', () => {
    const r = classifyColumnProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: circlePoints(0.4, 8),
    });
    expect(r.ok).toBe(false);
  });

  it('does not force an I-section into Cruciform', () => {
    const iBeam = [
      { x: -0.3, y: -0.25 },
      { x: 0.3, y: -0.25 },
      { x: 0.3, y: -0.15 },
      { x: 0.1, y: -0.15 },
      { x: 0.1, y: 0.15 },
      { x: 0.3, y: 0.15 },
      { x: 0.3, y: 0.25 },
      { x: -0.3, y: 0.25 },
      { x: -0.3, y: 0.15 },
      { x: -0.1, y: 0.15 },
      { x: -0.1, y: -0.15 },
      { x: -0.3, y: -0.15 },
    ];
    const r = classifyColumnProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: iBeam,
    });
    expect(r.ok).toBe(false);
  });

  it('maps native IfcLShapeProfileDef and IfcTShapeProfileDef', () => {
    const l = classifyColumnProfile({
      type: 'IfcLShapeProfileDef',
      lShape: { depth: 0.5, width: 0.6, thickness: 0.2 },
    });
    expect(l.ok && l.shape === 'L_SHAPED').toBe(true);
    const t = classifyColumnProfile({
      type: 'IfcTShapeProfileDef',
      tShape: {
        depth: 0.5,
        flangeWidth: 0.6,
        webThickness: 0.2,
        flangeThickness: 0.2,
      },
    });
    expect(t.ok && t.shape === 'T_SHAPED').toBe(true);
  });

  it('rejects rounded native L/T profiles that sharp-corner variants cannot represent', () => {
    expect(
      classifyColumnProfile({
        type: 'IfcLShapeProfileDef',
        lShape: {
          depth: 0.5,
          width: 0.6,
          thickness: 0.2,
          filletRadius: 0.05,
        },
      }).ok,
    ).toBe(false);
    expect(
      classifyColumnProfile({
        type: 'IfcTShapeProfileDef',
        tShape: {
          depth: 0.5,
          flangeWidth: 0.6,
          webThickness: 0.2,
          flangeThickness: 0.2,
          flangeEdgeRadius: 0.03,
        },
      }).ok,
    ).toBe(false);
  });
});

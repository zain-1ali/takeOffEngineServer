import { classifyBeamSectionProfile } from '../../services/ifcBeamProfile';
import { classifyColumnProfile } from '../../services/ifcColumnProfile';

/** Same 6-gon as Columns L hand-check: overall 0.6×0.5, equal leg t=0.2. */
const L_POINTS = [
  { x: 0, y: 0 },
  { x: 0.6, y: 0 },
  { x: 0.6, y: 0.2 },
  { x: 0.2, y: 0.2 },
  { x: 0.2, y: 0.5 },
  { x: 0, y: 0.5 },
];

/** Same 8-gon as Columns T hand-check: flange 0.6, overall 0.5, tf=tw=0.2. */
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

describe('classifyBeamSectionProfile', () => {
  it('reuses Columns rectangle detection', () => {
    const profile = {
      type: 'IfcRectangleProfileDef',
      xDim: 0.3,
      yDim: 0.5,
    };
    expect(classifyColumnProfile(profile)).toMatchObject({
      ok: true,
      shape: 'RECTANGULAR',
    });
    expect(classifyBeamSectionProfile(profile)).toEqual({
      ok: true,
      shape: 'RECTANGULAR',
      width: 0.3,
      depth: 0.5,
      source: 'NATIVE_RECTANGLE',
    });
  });

  it('remaps Columns L_SHAPED → L_SECTION (equal-thickness legs)', () => {
    const col = classifyColumnProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: L_POINTS,
    });
    expect(col).toMatchObject({
      ok: true,
      shape: 'L_SHAPED',
      width: 0.6,
      depth: 0.5,
      legThickness: 0.2,
    });
    expect(classifyBeamSectionProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: L_POINTS,
    })).toEqual({
      ok: true,
      shape: 'L_SECTION',
      flangeWidth: 0.6,
      overallDepth: 0.5,
      flangeThickness: 0.2,
      webWidth: 0.2,
      source: 'ARBITRARY_LSHAPE',
    });
  });

  it('remaps Columns T_SHAPED → T_SECTION (webThickness → webWidth)', () => {
    const col = classifyColumnProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: T_POINTS,
    });
    expect(col).toMatchObject({
      ok: true,
      shape: 'T_SHAPED',
      flangeWidth: 0.6,
      overallDepth: 0.5,
      flangeThickness: 0.2,
      webThickness: 0.2,
    });
    expect(classifyBeamSectionProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: T_POINTS,
    })).toEqual({
      ok: true,
      shape: 'T_SECTION',
      flangeWidth: 0.6,
      overallDepth: 0.5,
      flangeThickness: 0.2,
      webWidth: 0.2,
      source: 'ARBITRARY_TSHAPE',
    });
  });

  it('rejects Circular and Cruciform — not Beams variants', () => {
    const circle = classifyBeamSectionProfile({
      type: 'IfcCircleProfileDef',
      radius: 0.2,
    });
    expect(circle.ok).toBe(false);
    if (!circle.ok) expect(circle.reason).toMatch(/Circular/i);

    const cross = classifyColumnProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: [
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
      ],
    });
    expect(cross).toMatchObject({ ok: true, shape: 'CRUCIFORM' });
    const beamCross = classifyBeamSectionProfile({
      type: 'IfcArbitraryClosedProfileDef',
      boundaryPoints: [
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
      ],
    });
    expect(beamCross.ok).toBe(false);
  });
});

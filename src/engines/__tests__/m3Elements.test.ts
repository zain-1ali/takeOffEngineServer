import { calcDuct, ductJoints, ductSurfaceM2 } from '../ducts';
import { calcPipe } from '../pipes';
import { calcElectrical } from '../electrical';
import { calcDuctFitting } from '../ductFittings';

describe('M3 ducts', () => {
  it('hand-check: L=10, 0.4×0.3 → surface 14.0; joints @1.2 → 8', () => {
    const input = {
      section: 'Rectangular' as const,
      width: 0.4,
      height: 0.3,
      length: 10,
      jointSpacing: 1.2,
    };
    expect(ductSurfaceM2(input)).toBe(14);
    expect(ductJoints(input)).toBe(8);
    const r = calcDuct(input);
    expect(r.totalLengthM).toBe(10);
    expect(r.totalSurfaceM2).toBe(14);
    expect(r.totalJoints).toBe(8);
    expect(r.totalWeightKg).toBe(112); // 14×8
  });
});

describe('M3 pipes', () => {
  it('hand-check: DN50 × 25 m insulated, 6 fittings', () => {
    const r = calcPipe({
      diameterMm: 50,
      length: 25,
      insulated: 'Yes',
      fittingsNos: 6,
    });
    expect(r.totalLengthM).toBe(25);
    expect(r.totalInsulationM).toBe(25);
    expect(r.totalFittingsNos).toBe(6);
  });
});

describe('M3 electrical', () => {
  it('hand-check: CONDUIT 40 m × 25 mm', () => {
    const r = calcElectrical({
      shape: 'CONDUIT',
      sizeMm: 25,
      length: 40,
    });
    expect(r.totalLengthM).toBe(40);
    expect(r.totalCableM).toBe(0);
  });
});

describe('M3 duct fittings', () => {
  it('hand-check: 4× Elbow eqLen 1.5 → 4 nos, 6.0 m', () => {
    const r = calcDuctFitting({
      count: 4,
      fittingType: 'Elbow',
      equivalentLength: 1.5,
    });
    expect(r.totalNos).toBe(4);
    expect(r.totalEquivalentLengthM).toBe(6);
  });
});

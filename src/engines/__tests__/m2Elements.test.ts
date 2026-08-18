import { calcSkirting } from '../skirting';
import { calcMasonry } from '../masonry';
import { calcDoorsWindows } from '../doorsWindows';
import { calcLintel, lintelLengthM } from '../lintels';

describe('M2 skirting', () => {
  it('hand-check: 5×4 room, one 0.9 m door → 17.1 m', () => {
    const r = calcSkirting({
      roomLength: 5,
      roomWidth: 4,
      openings: [{ type: 'Door', width: 0.9, count: 1 }],
    });
    expect(r.totalLengthM).toBe(17.1);
    expect(r.perUnit.grossPerimeterM).toBe(18);
    expect(r.perUnit.doorDeductionLm).toBe(0.9);
  });

  it('doorDeductionLm override wins over openings', () => {
    const r = calcSkirting({
      roomLength: 5,
      roomWidth: 4,
      doorDeductionLm: 1.8,
      openings: [{ type: 'Door', width: 0.9, count: 1 }],
    });
    expect(r.totalLengthM).toBe(16.2);
  });
});

describe('M2 masonry', () => {
  it('hand-check: 8×3, T=0.2, openings 2.0 → 22 m² / 4.4 m³ / 1.32 m³', () => {
    const r = calcMasonry(
      { wallLength: 8, wallHeight: 3, thickness: 0.2, openingArea: 2 },
      { stoneMortarFraction: 0.3 },
    );
    expect(r.totalAreaM2).toBe(22);
    expect(r.totalMasonryM3).toBe(4.4);
    expect(r.totalMortarM3).toBe(1.32);
  });
});

describe('M2 doors & windows', () => {
  it('hand-check: 2× (0.9×2.1) → 2 nos, 3.78 m², 12.0 m peri', () => {
    const r = calcDoorsWindows({
      count: 2,
      openingType: 'Door',
      width: 0.9,
      height: 2.1,
    });
    expect(r.totalNos).toBe(2);
    expect(r.totalOpeningAreaM2).toBe(3.78);
    expect(r.totalPerimeterM).toBe(12);
  });
});

describe('M2 lintels', () => {
  it('hand-check: clear 1.0 + 2×0.15 → L=1.3; 0.2×0.15 → V=0.039', () => {
    expect(
      lintelLengthM({
        shape: 'PRECAST',
        clearSpan: 1,
        bearingEach: 0.15,
      }),
    ).toBeCloseTo(1.3, 6);
    const r = calcLintel({
      shape: 'PRECAST',
      clearSpan: 1,
      bearingEach: 0.15,
      width: 0.2,
      depth: 0.15,
    });
    expect(r.totalVolumeM3).toBe(0.04); // round(0.039)=0.04 at 2dp
    expect(r.totalLengthM).toBe(1.3);
    expect(r.totalFormworkM2).toBe(0);
    expect(r.totalRebarKg).toBe(0);
  });

  it('INSITU includes formwork and rebar', () => {
    const r = calcLintel({
      shape: 'INSITU',
      clearSpan: 1,
      bearingEach: 0.15,
      width: 0.2,
      depth: 0.15,
      topBarCount: 2,
      topBarDia: 12,
      bottomBarCount: 2,
      bottomBarDia: 12,
      linkDia: 8,
      linkSpacing: 200,
    });
    expect(r.totalFormworkM2).toBeGreaterThan(0);
    expect(r.totalRebarKg).toBeGreaterThan(0);
  });
});

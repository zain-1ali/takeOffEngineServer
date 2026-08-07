import { calcStone } from '../stoneStrip';

describe('stoneStrip', () => {
  it('TRAPEZOIDAL seed STF1 — masonry, mortar 30%, blinding', () => {
    const r = calcStone(
      {
        shape: 'TRAPEZOIDAL',
        length: 30,
        baseWidth: 0.8,
        topWidth: 0.4,
        height: 0.6,
        hasBlinding: true,
        count: 1,
      },
      { stoneMortarFraction: 0.3, blindingThickness: 0.05 },
    );
    // masonry = ((0.8+0.4)/2)*0.6*30 = 10.8
    expect(r.totalMasonryM3).toBe(10.8);
    expect(r.totalMortarM3).toBe(3.24); // 10.8*0.3
    // blinding = 30*(0.8+0.1)*0.05 = 1.35
    expect(r.totalBlindingM3).toBe(1.35);
  });

  it('RECTANGULAR without blinding', () => {
    const r = calcStone({
      shape: 'RECTANGULAR',
      length: 18,
      width: 0.5,
      height: 0.5,
      hasBlinding: false,
    });
    expect(r.totalMasonryM3).toBe(4.5); // 18*0.5*0.5
    expect(r.totalBlindingM3).toBe(0);
  });

  it('STEPPED sums tier volumes', () => {
    const r = calcStone({
      shape: 'STEPPED',
      length: 16,
      baseWidth: 0.9,
      baseHeight: 0.3,
      upperWidth: 0.6,
      upperHeight: 0.3,
      hasBlinding: false,
    });
    // 16*(0.9*0.3 + 0.6*0.3) = 16*0.45 = 7.2
    expect(r.totalMasonryM3).toBe(7.2);
  });
});

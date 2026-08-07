import { calcPile, pileCrossSectionArea } from '../piles';

describe('piles', () => {
  it('matches the approved square-driven hand calculation', () => {
    const r = calcPile({
      shape: 'SQUARE_DRIVEN',
      side: 0.5,
      pileLength: 10,
      count: 4,
      longBarCount: 4,
      longBarDia: 16,
      linkDia: 8,
      linkKgPerM: 2,
    });
    expect(r.totalVolumeM3).toBe(10); // 0.5² × 10 × 4
    // Long bars: 4 bars × 10 m × 16²/162 = 63.21 kg/pile.
    // Links: 2 kg/m × 10 m = 20 kg/pile.
    expect(r.totalRebarKg).toBe(332.84);
  });

  it('computes circular and H-section cross-sectional areas', () => {
    expect(
      pileCrossSectionArea({
        shape: 'CIRCULAR_BORED',
        diameter: 0.6,
        pileLength: 10,
        longBarCount: 0,
        longBarDia: 0,
        linkDia: 0,
        linkKgPerM: 0,
      }),
    ).toBeCloseTo((Math.PI * 0.6 ** 2) / 4, 10);

    // Two 0.3×0.05 m flanges plus a 0.02×0.4 m clear web.
    expect(
      pileCrossSectionArea({
        shape: 'H_SECTION',
        sectionDepth: 0.5,
        flangeWidth: 0.3,
        flangeThickness: 0.05,
        webThickness: 0.02,
        pileLength: 10,
        longBarCount: 0,
        longBarDia: 0,
        linkDia: 0,
        linkKgPerM: 0,
      }),
    ).toBe(0.038);
  });
});

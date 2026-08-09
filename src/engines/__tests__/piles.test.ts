import { calcPile, pileCrossSectionArea, pileLinkPerimeter } from '../piles';

describe('piles', () => {
  it('CIRCULAR_BORED links match the approved bar-by-bar hand calculation', () => {
    // linkCount=floor(10/0.2)+1=51; P=π×0.6; links=51×P×64/162 → 37.98 kg.
    const r = calcPile({
      shape: 'CIRCULAR_BORED',
      diameter: 0.6,
      pileLength: 10,
      count: 1,
      longBarCount: 0,
      longBarDia: 16,
      linkDia: 8,
      linkSpacing: 200,
    });
    expect(pileLinkPerimeter({
      shape: 'CIRCULAR_BORED',
      diameter: 0.6,
      pileLength: 10,
    })).toBeCloseTo(Math.PI * 0.6, 10);
    expect(r.totalRebarKg).toBe(37.98);
    expect(r.totalVolumeM3).toBeCloseTo((Math.PI * 0.6 ** 2) / 4 * 10, 2);
  });

  it('SQUARE_DRIVEN matches approved volume and bar-by-bar links', () => {
    // V=0.5²×10×4=10. Long: 4×10×256/162=63.21. Links: 51×2×64/162=40.30.
    // Per pile 103.51; ×4 = 414.04 kg.
    const r = calcPile({
      shape: 'SQUARE_DRIVEN',
      side: 0.5,
      pileLength: 10,
      count: 4,
      longBarCount: 4,
      longBarDia: 16,
      linkDia: 8,
      linkSpacing: 200,
    });
    expect(r.totalVolumeM3).toBe(10);
    expect(r.totalRebarKg).toBe(414.04);
  });

  it('H_SECTION is structural steel only — no concrete, no RC cage', () => {
    // 82 kg/m × 10 m × 2 piles = 1640 kg.
    const r = calcPile({
      shape: 'H_SECTION',
      sectionDepth: 0.5,
      flangeWidth: 0.3,
      flangeThickness: 0.05,
      webThickness: 0.02,
      sectionKgPerM: 82,
      pileLength: 10,
      count: 2,
    });
    expect(r.totalVolumeM3).toBe(0);
    expect(r.totalFormworkM2).toBe(0);
    expect(r.totalRebarKg).toBe(1640);
    expect(pileCrossSectionArea({
      shape: 'H_SECTION',
      sectionDepth: 0.5,
      flangeWidth: 0.3,
      flangeThickness: 0.05,
      webThickness: 0.02,
      pileLength: 10,
    })).toBe(0.038);
  });
});

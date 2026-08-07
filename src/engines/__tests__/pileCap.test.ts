import { calcPileCap, pileCapConcrete } from '../pileCap';

describe('pile cap', () => {
  /** Approved hand check: 2×2×0.5 m cap, H16@150, 4 pile bundles. */
  const rectangular = {
    shape: 'RECTANGULAR' as const,
    length: 2,
    width: 2,
    thickness: 0.5,
    cover: 50,
    bottomMainDia: 16,
    bottomMainSpacing: 150,
    bottomDistDia: 16,
    bottomDistSpacing: 150,
    pileCount: 4,
    starterBarsPerPile: 4,
    starterDia: 20,
    starterProjection: 0.8,
    starterEmbedment: 0.4,
    count: 1,
  };

  it('matches the approved rectangular hand calculation', () => {
    const r = calcPileCap(rectangular);
    expect(r.totalVolumeM3).toBe(2); // 2 × 2 × 0.5
    expect(r.totalFormworkM2).toBe(4); // perimeter 8 × 0.5
    // Bottom mesh = 78.06 kg.
    // Starters = 4 piles × 4 bars × 1.2 m × 20²/162 = 47.41 kg.
    expect(r.totalRebarKg).toBe(125.47);
    expect((r.perUnit.rebar.starterBars as { barCount: number }).barCount).toBe(16);
  });

  it('computes triangular, regular-hexagonal and centred-trapezoidal plans', () => {
    const common = {
      ...rectangular,
      pileCount: 0,
      starterBarsPerPile: 0,
    };
    const triangle = pileCapConcrete({
      ...common,
      shape: 'TRIANGULAR',
      triangleBase: 4,
      triangleHeight: 3,
    });
    expect(triangle.netVolumeM3).toBe(3); // ½×4×3×0.5
    expect(triangle.formworkAreaM2).toBe(5.61);

    const hexagon = pileCapConcrete({
      ...common,
      shape: 'HEXAGONAL',
      hexSide: 2,
    });
    expect(hexagon.netVolumeM3).toBe(5.2);
    expect(hexagon.formworkAreaM2).toBe(6);

    const trapezoid = pileCapConcrete({
      ...common,
      shape: 'TRAPEZOIDAL',
      length: 3,
      baseWidth: 4,
      topWidth: 2,
    });
    expect(trapezoid.netVolumeM3).toBe(4.5);
    expect(trapezoid.formworkAreaM2).toBe(6.16);
  });

  it('scales all totals by cap count without changing piles per cap', () => {
    const one = calcPileCap(rectangular);
    const two = calcPileCap({ ...rectangular, count: 2 });
    expect(two.totalVolumeM3).toBe(one.totalVolumeM3 * 2);
    expect(two.totalFormworkM2).toBe(one.totalFormworkM2 * 2);
    expect(two.totalRebarKg).toBe(one.totalRebarKg * 2);
  });
});

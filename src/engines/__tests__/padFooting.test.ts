import { calcFooting } from '../padFooting';
import { unitWeightKgPerM, barCountForSpan, round } from '../math';

describe('padFooting', () => {
  /** Verified rectangular pad: 2 × 2 × 0.6 m, H16@150, cover 50 mm */
  const basePad = {
    shape: 'RECTANGULAR' as const,
    length: 2,
    width: 2,
    baseThickness: 0.6,
    cover: 50,
    bottomMainDia: 16,
    bottomMainSpacing: 150,
    bottomDistDia: 16,
    bottomDistSpacing: 150,
    topMeshEnabled: false,
    startersEnabled: false,
    count: 1,
  };

  it('computes concrete volume and formwork for 2×2×0.6 m pad', () => {
    const r = calcFooting(basePad);
    expect(r.totalVolumeM3).toBe(2.4); // 2*2*0.6
    expect(r.totalFormworkM2).toBe(4.8); // 2*(2*0.6)+2*(2*0.6)
  });

  it('bottom mesh H16@150 = 78.06 kg (no starters)', () => {
    const r = calcFooting(basePad);
    // mainLen = 1.9, count = floor(1.9/0.15)+1 = 13
    // uw = 256/162; each way = round(uw*1.9*13) = 39.03 → 78.06
    expect(r.totalRebarKg).toBe(78.06);
    const bottom = r.perUnit.rebar.bottomMesh as { mainBars: { barCount: number } };
    expect(bottom.mainBars.barCount).toBe(13);
  });

  it('verified H16@150 pad + starters (1.2 m bars) = 89.91 kg', () => {
    // Spec figure: mesh 78.06 + 4×H20 starters at 1.2 m = 89.91 kg
    const r = calcFooting({
      ...basePad,
      startersEnabled: true,
      starterDia: 20,
      starterCount: 4,
      starterProjection: 0.8,
      starterEmbedment: 0.4,
    });
    expect(r.totalRebarKg).toBe(89.91);
  });

  it('scales by count', () => {
    const r = calcFooting({ ...basePad, count: 6 });
    expect(r.totalVolumeM3).toBe(14.4);
    expect(r.totalRebarKg).toBe(round(78.06 * 6));
  });
});

describe('shared rebar math', () => {
  it('unitWeightKgPerM matches BS 8666 (dia²/162)', () => {
    expect(unitWeightKgPerM(16)).toBeCloseTo(256 / 162, 10);
    expect(unitWeightKgPerM(20)).toBeCloseTo(400 / 162, 10);
  });

  it('barCountForSpan uses floor(span/spc)+1', () => {
    expect(barCountForSpan(1.9, 150)).toBe(13);
  });
});

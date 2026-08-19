import { calcBeam, type BeamInput } from '../beams';
import { round, unitWeightKgPerM } from '../math';

const reinforcement = {
  spanLength: 4,
  topBarCount: 2,
  topBarDia: 16,
  bottomBarCount: 3,
  bottomBarDia: 20,
  linkDia: 8,
  linkSpacing: 200,
  count: 1,
};

function expectBeam(
  input: BeamInput,
  volume: number,
  formwork: number,
  steel: number,
) {
  const result = calcBeam(input);
  expect(result.totalVolumeM3).toBe(volume);
  expect(result.totalFormworkM2).toBe(formwork);
  expect(result.totalRebarKg).toBe(steel);
  expect((result.perUnit.rebar.links as { barCount: number }).barCount).toBe(21);
}

describe('beams', () => {
  it('RECTANGULAR measures soffit plus two sides', () => {
    // V=0.3×0.5×4=0.6; F=(0.3+2×0.5)×4=5.2.
    expectBeam(
      { ...reinforcement, shape: 'RECTANGULAR', width: 0.3, depth: 0.5 },
      0.6,
      5.2,
      55.54,
    );
  });

  it('T_SECTION matches the approved worked hand calculation', () => {
    // A=0.6×0.15+0.25×(0.5-0.15)=0.1775; V=0.71; F=6.4.
    // Web-based links: 21×2(0.25+0.5)×8²/162=12.44 kg.
    expectBeam(
      {
        ...reinforcement,
        shape: 'T_SECTION',
        flangeWidth: 0.6,
        flangeThickness: 0.15,
        webWidth: 0.25,
        overallDepth: 0.5,
      },
      0.71,
      6.4,
      54.71,
    );
  });

  it('L_SECTION uses the same exact exposed-formwork simplification', () => {
    // A=0.5×0.15+0.2×(0.45-0.15)=0.135; Pform=0.5+2×0.45.
    expectBeam(
      {
        ...reinforcement,
        shape: 'L_SECTION',
        flangeWidth: 0.5,
        flangeThickness: 0.15,
        webWidth: 0.2,
        overallDepth: 0.45,
      },
      0.54,
      5.6,
      53.06,
    );
  });

  it('CANTILEVER_TAPERED uses average depth and sloping soffit', () => {
    // V=0.3×(0.6+0.3)/2×4=0.54.
    // F=0.3×sqrt(4²+0.3²)+4×(0.6+0.3)=4.80.
    expectBeam(
      {
        ...reinforcement,
        shape: 'CANTILEVER_TAPERED',
        width: 0.3,
        supportDepth: 0.6,
        tipDepth: 0.3,
      },
      0.54,
      4.8,
      54.71,
    );
  });

  it('GROUND_TIE measures side formwork only', () => {
    // V=0.3×0.5×4=0.6; F=2×0.5×4=4.0.
    expectBeam(
      { ...reinforcement, shape: 'GROUND_TIE', width: 0.3, depth: 0.5 },
      0.6,
      4,
      55.54,
    );
  });

  it('topBars/bottomBars multi-diameter matches hand calc', () => {
    // Rect 0.3×0.5×4 m; top 2×H16 + 2×H12; bottom 3×H20; links Ø8@200
    // Top H16: 2×4×(16²/162) = 12.6419… → 12.64
    // Top H12: 2×4×(12²/162) = 7.1111…  → 7.11
    // Top sum = 19.75
    // Bot H20: 3×4×(20²/162) = 29.6296… → 29.63
    // Links: floor(4/0.2)+1=21; P=2(0.3+0.5)=1.6
    //   21×1.6×(8²/162) = 13.274… → 13.27
    // Total = 19.75 + 29.63 + 13.27 = 62.65
    const top16 = round(2 * 4 * unitWeightKgPerM(16));
    const top12 = round(2 * 4 * unitWeightKgPerM(12));
    const bot20 = round(3 * 4 * unitWeightKgPerM(20));
    const links = round(21 * 1.6 * unitWeightKgPerM(8));
    expect(top16).toBe(12.64);
    expect(top12).toBe(7.11);
    expect(round(top16 + top12)).toBe(19.75);
    expect(bot20).toBe(29.63);
    expect(links).toBe(13.27);
    expect(round(19.75 + 29.63 + 13.27)).toBe(62.65);

    const result = calcBeam({
      shape: 'RECTANGULAR',
      width: 0.3,
      depth: 0.5,
      spanLength: 4,
      topBars: [
        { diameterMm: 16, barCount: 2 },
        { diameterMm: 12, barCount: 2 },
      ],
      bottomBars: [{ diameterMm: 20, barCount: 3 }],
      linkDia: 8,
      linkSpacing: 200,
      count: 1,
    });

    expect(result.perUnit.rebar.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ diameterMm: 16, weightKg: 12.64 }),
        expect.objectContaining({ diameterMm: 12, weightKg: 7.11 }),
        expect.objectContaining({ diameterMm: 20, weightKg: 29.63 }),
        expect.objectContaining({ diameterMm: 8, weightKg: 13.27 }),
      ]),
    );
    expect(result.totalRebarKg).toBe(62.65);
    expect(result.perUnit.rebar.topBars).toEqual([
      { diameterMm: 16, barCount: 2, weightKg: 12.64 },
      { diameterMm: 12, barCount: 2, weightKg: 7.11 },
    ]);
  });

  it('falls back to legacy topBarCount/topBarDia when arrays absent', () => {
    const legacy = calcBeam({
      ...reinforcement,
      shape: 'RECTANGULAR',
      width: 0.3,
      depth: 0.5,
    });
    const viaArray = calcBeam({
      shape: 'RECTANGULAR',
      width: 0.3,
      depth: 0.5,
      spanLength: 4,
      topBars: [{ diameterMm: 16, barCount: 2 }],
      bottomBars: [{ diameterMm: 20, barCount: 3 }],
      linkDia: 8,
      linkSpacing: 200,
      count: 1,
    });
    expect(viaArray.totalRebarKg).toBe(legacy.totalRebarKg);
  });
});

import { calcBeam, type BeamInput } from '../beams';

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
});

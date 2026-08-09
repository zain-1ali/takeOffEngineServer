import { calcSlab, type SlabInput } from '../slabs';

const reinforcement = {
  count: 1,
  length: 6,
  width: 4,
  cover: 50,
  bottomMainDia: 12,
  bottomMainSpacing: 200,
  bottomDistDia: 12,
  bottomDistSpacing: 200,
  ribBarsPerRib: 2,
};

function expectSlab(
  input: SlabInput,
  volume: number,
  formwork: number,
  steel: number,
) {
  const result = calcSlab(input);
  expect(result.totalVolumeM3).toBe(volume);
  expect(result.totalFormworkM2).toBe(formwork);
  expect(result.totalRebarKg).toBe(steel);
}

describe('slabs', () => {
  it('FLAT measures solid volume, soffit and edge forms', () => {
    // V=6×4×0.2=4.8; F=6×4+2(6+4)×0.2=28.0.
    // Mesh=20×5.9×12²/162 + 30×3.9×12²/162=208.89 kg.
    expectSlab(
      { ...reinforcement, shape: 'FLAT', thickness: 0.2 },
      4.8,
      28,
      208.89,
    );
  });

  it('SLOPED uses average thickness and true sloping soffit', () => {
    // V=24×(0.2+0.3)/2=6.0.
    // F=4×sqrt(6²+0.1²)+(6+4)(0.2+0.3)=29.0033 -> 29.00.
    expectSlab(
      {
        ...reinforcement,
        shape: 'SLOPED',
        startThickness: 0.2,
        endThickness: 0.3,
      },
      6,
      29,
      208.89,
    );
  });

  it('DROP_PANEL includes the replacement drop soffit and vertical sides', () => {
    // V=24×0.2+2×2×0.15=5.4.
    // F=(24-4)+4+20×0.2+2(2+2)×0.15=29.2.
    // Bottom mesh 208.89 + 2-way 2×2 top mesh 33.78 = 242.67 kg.
    expectSlab(
      {
        ...reinforcement,
        shape: 'DROP_PANEL',
        thickness: 0.2,
        dropLength: 2,
        dropWidth: 2,
        extraDropDepth: 0.15,
      },
      5.4,
      29.2,
      242.67,
    );
  });

  it('WAFFLE applies rib intersection inclusion-exclusion', () => {
    // nX=floor(4/1)+1=5; nY=floor(6/1)+1=7.
    // Vflange=6×4×0.1=2.40.
    // Vrib=[5×6×0.15+7×4×0.15-5×7×0.15²]×0.3=2.37375.
    // V=4.77375 -> 4.77.
    // F=24 + 2×0.3[5×6+7×4-2×5×7×0.15]
    //   + 20×0.1 + 2(5+7)×0.15×0.3 = 55.58.
    // Rib bars=5×2×5.9×12²/162 + 7×2×3.9×12²/162=100.97 kg.
    expectSlab(
      {
        ...reinforcement,
        shape: 'WAFFLE',
        flangeThickness: 0.1,
        ribSpacing: 1,
        ribWidth: 0.15,
        ribDepth: 0.3,
      },
      4.77,
      55.58,
      100.97,
    );
  });
});

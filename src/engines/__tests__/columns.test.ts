import { calcColumn, type ColumnInput } from '../columns';

const rebar = {
  clearHeight: 3,
  longBarCount: 8,
  longBarDia: 16,
  tieDia: 8,
  tieSpacing: 200,
  count: 1,
};

function expectColumn(
  input: ColumnInput,
  volume: number,
  formwork: number,
  steel: number,
) {
  const result = calcColumn(input);
  expect(result.totalVolumeM3).toBe(volume);
  expect(result.totalFormworkM2).toBe(formwork);
  expect(result.totalRebarKg).toBe(steel);
  expect((result.perUnit.rebar.ties as { barCount: number }).barCount).toBe(16);
}

describe('columns', () => {
  it('RECTANGULAR matches the worked 0.4×0.3×3 m hand calculation', () => {
    expectColumn(
      { ...rebar, shape: 'RECTANGULAR', width: 0.4, depth: 0.3 },
      0.36,
      4.2,
      46.78,
    );
  });

  it('CIRCULAR uses πd²/4 area and πd perimeter', () => {
    // d=0.4: V=π×0.4²/4×3=0.38; F=π×0.4×3=3.77.
    expectColumn(
      { ...rebar, shape: 'CIRCULAR', diameter: 0.4 },
      0.38,
      3.77,
      45.87,
    );
  });

  it('L_SHAPED subtracts the overlapping leg square', () => {
    // A=0.6×0.2 + 0.5×0.2 - 0.2²=0.18; P=2(0.6+0.5)=2.2.
    expectColumn(
      {
        ...rebar,
        shape: 'L_SHAPED',
        width: 0.6,
        depth: 0.5,
        legThickness: 0.2,
      },
      0.54,
      6.6,
      51.84,
    );
  });

  it('T_SHAPED sums flange and clear web areas', () => {
    // A=0.6×0.2 + 0.2×(0.5-0.2)=0.18; P=2(0.6+0.5)=2.2.
    expectColumn(
      {
        ...rebar,
        shape: 'T_SHAPED',
        flangeWidth: 0.6,
        overallDepth: 0.5,
        flangeThickness: 0.2,
        webThickness: 0.2,
      },
      0.54,
      6.6,
      51.84,
    );
  });

  it('CRUCIFORM subtracts the central arm overlap', () => {
    // A=0.8×0.2 + 0.6×0.2 - 0.2²=0.24; P=2(0.8+0.6)=2.8.
    expectColumn(
      {
        ...rebar,
        shape: 'CRUCIFORM',
        width: 0.8,
        depth: 0.6,
        armThickness: 0.2,
      },
      0.72,
      8.4,
      55.63,
    );
  });
});

import { calcColumn, type ColumnInput } from '../columns';
import { round, unitWeightKgPerM } from '../math';

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

  it('longBars multi-diameter matches hand calc (4×H16 + 4×H12 @ 3 m)', () => {
    // Longitudinal only (ties excluded from this subtotal):
    //   H16: 4 × 3 × (16²/162) = 12 × 256/162 = 18.96296… → 18.96
    //   H12: 4 × 3 × (12²/162) = 12 × 144/162 = 10.6666…  → 10.67
    //   long sum = 29.63
    // Rect 0.4×0.3: P=1.4; ties: floor(3/0.2)+1=16
    //   ties: 16 × 1.4 × (8²/162) = 22.4 × 64/162 = 8.849… → 8.85
    // Total = 29.63 + 8.85 = 38.48
    const h16 = round(4 * 3 * unitWeightKgPerM(16));
    const h12 = round(4 * 3 * unitWeightKgPerM(12));
    expect(h16).toBe(18.96);
    expect(h12).toBe(10.67);
    expect(round(h16 + h12)).toBe(29.63);

    const result = calcColumn({
      shape: 'RECTANGULAR',
      width: 0.4,
      depth: 0.3,
      clearHeight: 3,
      longBars: [
        { diameterMm: 16, barCount: 4 },
        { diameterMm: 12, barCount: 4 },
      ],
      tieDia: 8,
      tieSpacing: 200,
      count: 1,
    });

    const groups = result.perUnit.rebar.groups;
    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ diameterMm: 16, weightKg: 18.96 }),
        expect.objectContaining({ diameterMm: 12, weightKg: 10.67 }),
        expect.objectContaining({ diameterMm: 8, weightKg: 8.85 }),
      ]),
    );
    expect(result.totalRebarKg).toBe(38.48);
    expect(result.perUnit.rebar.longitudinalBars).toEqual([
      { diameterMm: 16, barCount: 4, weightKg: 18.96 },
      { diameterMm: 12, barCount: 4, weightKg: 10.67 },
    ]);
  });

  it('falls back to legacy longBarCount/longBarDia when longBars absent', () => {
    const legacy = calcColumn({
      ...rebar,
      shape: 'RECTANGULAR',
      width: 0.4,
      depth: 0.3,
    });
    const viaArray = calcColumn({
      shape: 'RECTANGULAR',
      width: 0.4,
      depth: 0.3,
      clearHeight: 3,
      longBars: [{ diameterMm: 16, barCount: 8 }],
      tieDia: 8,
      tieSpacing: 200,
      count: 1,
    });
    expect(viaArray.totalRebarKg).toBe(legacy.totalRebarKg);
  });
});

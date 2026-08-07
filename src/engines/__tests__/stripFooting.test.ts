import { calcStrip } from '../stripFooting';

describe('stripFooting', () => {
  it('FLAT 24×0.6×0.3 m (seed SF1) — volume and side formwork', () => {
    const r = calcStrip({
      shape: 'FLAT',
      length: 24,
      width: 0.6,
      height: 0.3,
      cover: 50,
      mainDia: 12,
      mainSpacing: 150,
      distDia: 12,
      distSpacing: 250,
      startersEnabled: false,
      topMeshEnabled: false,
    });
    expect(r.totalVolumeM3).toBe(4.32); // 24*0.6*0.3
    expect(r.totalFormworkM2).toBe(14.4); // 2*24*0.3
  });

  it('TAPERED cross-section average width', () => {
    const r = calcStrip({
      shape: 'TAPERED',
      length: 10,
      baseWidth: 0.8,
      topWidth: 0.4,
      height: 0.4,
      cover: 50,
      mainDia: 12,
      mainSpacing: 150,
      distDia: 12,
      distSpacing: 250,
    });
    // crossArea = ((0.8+0.4)/2)*0.4 = 0.24; vol = 2.4
    expect(r.totalVolumeM3).toBe(2.4);
  });

  it('STEPPED sums base + upper volumes', () => {
    const r = calcStrip({
      shape: 'STEPPED',
      length: 12,
      baseWidth: 0.9,
      baseHeight: 0.3,
      upperWidth: 0.45,
      upperHeight: 0.3,
      cover: 50,
      mainDia: 12,
      mainSpacing: 150,
      distDia: 12,
      distSpacing: 250,
    });
    // 12*(0.9*0.3 + 0.45*0.3) = 12*0.405 = 4.86
    expect(r.totalVolumeM3).toBe(4.86);
    expect(r.totalFormworkM2).toBe(14.4); // 2*12*0.3 + 2*12*0.3
  });
});

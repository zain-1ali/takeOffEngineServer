import { calcBeam } from '../beams';
import { calcSlab } from '../slabs';
import { calcWall } from '../walls';

describe('formwork soffit / vertical split', () => {
  it('RECTANGULAR beam splits soffit vs sides (hand-check)', () => {
    // span=4, w=0.3, d=0.5 → soffit=1.2, sides=4.0, total=5.2
    const r = calcBeam({
      shape: 'RECTANGULAR',
      spanLength: 4,
      width: 0.3,
      depth: 0.5,
      topBarCount: 2,
      topBarDia: 16,
      bottomBarCount: 3,
      bottomBarDia: 20,
      linkDia: 8,
      linkSpacing: 200,
    });
    expect(r.totalFormworkM2).toBe(5.2);
    expect(r.totalSoffitFormworkM2).toBe(1.2);
    expect(r.totalVerticalFormworkM2).toBe(4);
    // Defaults 12 kg/m² props, 5 kg/m² bracing
    expect(r.totalSoffitFormworkM2 * 12).toBeCloseTo(14.4, 5);
    expect(r.totalVerticalFormworkM2 * 5).toBeCloseTo(20, 5);
  });

  it('FLAT slab splits soffit vs edges (hand-check)', () => {
    // 6×4×0.2 → soffit=24, edges=2(6+4)×0.2=4, total=28
    const r = calcSlab({
      shape: 'FLAT',
      length: 6,
      width: 4,
      thickness: 0.2,
      cover: 50,
      bottomMainDia: 12,
      bottomMainSpacing: 200,
      bottomDistDia: 12,
      bottomDistSpacing: 200,
      ribBarsPerRib: 2,
    });
    expect(r.totalFormworkM2).toBe(28);
    expect(r.totalSoffitFormworkM2).toBe(24);
    expect(r.totalVerticalFormworkM2).toBe(4);
    expect(r.totalSoffitFormworkM2 * 12).toBe(288);
    expect(r.totalVerticalFormworkM2 * 5).toBe(20);
  });

  it('walls are vertical-only (no soffit props)', () => {
    const r = calcWall({
      shape: 'LINEAR',
      length: 8,
      thickness: 0.25,
      height: 3.5,
      cover: 40,
      vertDia: 12,
      vertSpacing: 200,
      horizDia: 12,
      horizSpacing: 250,
      bothFaces: true,
      startersEnabled: false,
      count: 1,
    });
    expect(r.totalFormworkM2).toBe(56);
    expect(r.totalSoffitFormworkM2).toBe(0);
    expect(r.totalVerticalFormworkM2).toBe(56);
  });
});

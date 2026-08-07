import { calcFinish } from '../finishes';

describe('finishes', () => {
  it('FLOOR tiled room 6×5 ×3 — area, screed, tiles with 10% wastage', () => {
    const r = calcFinish(
      'FLOOR',
      { roomLength: 6, roomWidth: 5, count: 3, spec: 'Ceramic tile on screed' },
      { screedThickness: 0.05, tileWastage: 0.1 },
    );
    expect(r.totalAreaM2).toBe(90); // 30*3
    expect(r.totalScreedM3).toBe(4.5); // 30*0.05*3
    expect(r.totalTilesM2).toBe(99); // 30*1.1*3
  });

  it('WALL plaster finish deducts openings', () => {
    const r = calcFinish(
      'WALL',
      {
        wallLength: 40,
        wallHeight: 3.5,
        openingArea: 12,
        count: 1,
        spec: 'Cement plaster + emulsion',
      },
      { plasterThickness: 0.015, paintCoats: 2 },
    );
    // net = 40*3.5 - 12 = 128
    expect(r.totalAreaM2).toBe(128);
    expect(r.totalPlasterM3).toBe(1.92); // 128*0.015
    expect(r.totalPaintL).toBe(25.6); // 128*2/10
    expect(r.totalTilesM2).toBe(0);
  });

  it('CEILING paint/skim uses 0.7 plaster factor', () => {
    const r = calcFinish(
      'CEILING',
      { roomLength: 6, roomWidth: 5, count: 3, spec: 'Plaster + emulsion paint' },
      { plasterThickness: 0.015, paintCoats: 2 },
    );
    expect(r.totalAreaM2).toBe(90);
    // plaster = 30*0.015*0.7 = 0.315 → round → 0.31; ×3 → round(0.945) → 0.94 (IEEE)
    expect(r.perUnit.plasterM3).toBe(0.31);
    expect(r.totalPlasterM3).toBe(0.94);
    expect(r.totalPaintL).toBe(18); // 30*2/10 * 3
  });
});

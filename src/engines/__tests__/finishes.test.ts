import { calcFinish, finishNetArea, hasAreaOverride } from '../finishes';

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
    expect(r.areaFromOverride).toBe(false);
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

  it('FLOOR deducts openingArea from L×W', () => {
    expect(
      finishNetArea('FLOOR', {
        roomLength: 6,
        roomWidth: 5,
        openingArea: 4,
        spec: 'Vinyl on screed',
      }),
    ).toBe(26);
  });

  it('CEILING deducts openingArea from L×W', () => {
    expect(
      finishNetArea('CEILING', {
        roomLength: 6,
        roomWidth: 5,
        openingArea: 2.5,
        spec: 'Plaster + emulsion paint',
      }),
    ).toBe(27.5);
  });

  it('areaOverride bypasses L×W and openings for all kinds', () => {
    expect(
      finishNetArea('FLOOR', {
        roomLength: 6,
        roomWidth: 5,
        openingArea: 4,
        areaOverride: 22.5,
        spec: 'x',
      }),
    ).toBe(22.5);
    expect(
      finishNetArea('WALL', {
        wallLength: 40,
        wallHeight: 3.5,
        openingArea: 12,
        areaOverride: 100,
        spec: 'x',
      }),
    ).toBe(100);
    expect(hasAreaOverride({ areaOverride: 0, spec: 'x' })).toBe(true);
    expect(hasAreaOverride({ spec: 'x' })).toBe(false);
  });

  it('FLOOR override drives screed/tiles; marks areaFromOverride', () => {
    const r = calcFinish(
      'FLOOR',
      {
        roomLength: 6,
        roomWidth: 5,
        areaOverride: 20,
        count: 2,
        spec: 'Cement screed + ceramic tiles',
      },
      { screedThickness: 0.05, tileWastage: 0.1 },
    );
    expect(r.areaFromOverride).toBe(true);
    expect(r.totalAreaM2).toBe(40);
    expect(r.totalScreedM3).toBe(2); // 20*0.05*2
    expect(r.totalTilesM2).toBe(44); // 20*1.1*2
  });

  it('instance tileWastage overrides project materials', () => {
    const r = calcFinish(
      'FLOOR',
      {
        roomLength: 10,
        roomWidth: 10,
        count: 1,
        spec: 'Ceramic tiles',
        tileWastage: 0.05,
      },
      { tileWastage: 0.1 },
    );
    expect(r.totalTilesM2).toBe(105); // 100 * 1.05
  });
});

import { calcEarthwork } from '../earthworks';

describe('earthworks', () => {
  it('matches the approved pit excavation and bulked-disposal calculation', () => {
    const r = calcEarthwork(
      {
        shape: 'ISOLATED_PIT',
        length: 4,
        width: 3,
        depth: 2,
        count: 1,
      },
      { earthworkBulkingFactor: 0.25 },
    );
    expect(r.totalExcavationM3).toBe(24);
    expect(r.totalDisposalM3).toBe(30);
  });

  it('uses trench width and scales both quantities by count', () => {
    const r = calcEarthwork(
      {
        shape: 'LINEAR_TRENCH',
        length: 10,
        trenchWidth: 0.6,
        depth: 1.5,
        count: 2,
      },
      { earthworkBulkingFactor: 0.2 },
    );
    expect(r.totalExcavationM3).toBe(18);
    expect(r.totalDisposalM3).toBe(21.6);
  });

  it('defaults the indicative bulking factor to 25%', () => {
    const r = calcEarthwork({
      shape: 'BULK_BASIN',
      length: 5,
      width: 4,
      depth: 1,
    });
    expect(r.totalExcavationM3).toBe(20);
    expect(r.totalDisposalM3).toBe(25);
  });
});

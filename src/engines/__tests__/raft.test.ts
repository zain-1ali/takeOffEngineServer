import { calcRaft, raftConcrete } from '../raft';

describe('raft foundation', () => {
  /** Hand check: 4×3×0.5 m, H12@250 top and bottom, 50 mm cover. */
  const monolithic = {
    shape: 'MONOLITHIC' as const,
    length: 4,
    width: 3,
    thickness: 0.5,
    cover: 50,
    bottomMainDia: 12,
    bottomMainSpacing: 250,
    bottomDistDia: 12,
    bottomDistSpacing: 250,
    count: 1,
  };

  it('matches the approved monolithic hand calculation', () => {
    const r = calcRaft(monolithic);
    expect(r.totalVolumeM3).toBe(6); // 4 × 3 × 0.5
    expect(r.totalFormworkM2).toBe(7); // 2(4 + 3) × 0.5

    // Effective lengths: 3.9 m and 2.9 m.
    // One mesh: (12 × 3.9 × 12²/162) + (16 × 2.9 × 12²/162)
    // = 41.60 + 41.24 = 82.84 kg; top + bottom = 165.68 kg.
    expect(r.totalRebarKg).toBe(165.68);
  });

  it('adds only the perimeter-ring downstand volume', () => {
    const r = raftConcrete({
      ...monolithic,
      shape: 'THICKENED_EDGE',
      thickness: 0.3,
      edgeWidth: 0.5,
      edgeExtraDepth: 0.2,
    });
    // Slab = 4×3×0.3 = 3.6.
    // Ring = [12 - (4-1)(3-1)]×0.2 = (12-6)×0.2 = 1.2.
    expect(r.netVolumeM3).toBe(4.8);
    expect(r.formworkAreaM2).toBe(7); // perimeter 14 × total depth 0.5
  });

  it('scales all totals by count', () => {
    const r = calcRaft({ ...monolithic, count: 2 });
    expect(r.totalVolumeM3).toBe(12);
    expect(r.totalFormworkM2).toBe(14);
    expect(r.totalRebarKg).toBe(331.36);
  });
});

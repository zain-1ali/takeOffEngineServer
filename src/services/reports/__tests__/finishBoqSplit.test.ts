import { calcFinish } from '../../../engines/finishes';
import { DEFAULT_MATERIALS } from '../../../engines/types';
import { DEFAULT_PRICING, DEFAULT_RATE_LIB } from '../../../defaults/projectDefaults';
import { makeRateAccessors } from '../pricing';
import { buildFinishReports, makeEntries } from '../builders';
import { computeCostPlanCascade } from '../../costPlan/cascade';
import type { IInstance } from '../../../models/Instance';
import { Types } from 'mongoose';

function fakeInst(partial: {
  spec: string;
  roomLength: number;
  roomWidth: number;
  count?: number;
  roomLabel?: string;
}): IInstance {
  return {
    _id: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    floorId: 'GF',
    elementKey: 'FLOOR_FINISH',
    shape: 'AREA',
    mark: 'FF1',
    count: partial.count ?? 1,
    geometry: {
      roomLength: partial.roomLength,
      roomWidth: partial.roomWidth,
      ...(partial.roomLabel ? { roomLabel: partial.roomLabel } : {}),
    },
    concreteGrade: null,
    reinforcement: null,
    spec: partial.spec,
    location: null,
  } as unknown as IInstance;
}

describe('buildFinishReports multi-material BOQ', () => {
  const rates = makeRateAccessors(DEFAULT_RATE_LIB as any, DEFAULT_PRICING, true);
  const materials = { ...DEFAULT_MATERIALS };

  it('splits Screed+tiles into screed m³ + tiles m² BOQ lines with separate rates', () => {
    const inst = fakeInst({
      spec: 'Cement screed + ceramic tiles',
      roomLength: 6,
      roomWidth: 5,
      count: 1,
    });
    const calc = calcFinish(
      'FLOOR',
      { roomLength: 6, roomWidth: 5, count: 1, spec: 'Cement screed + ceramic tiles' },
      materials,
    );
    expect(calc.totalScreedM3).toBeGreaterThan(0);
    expect(calc.totalTilesM2).toBeGreaterThan(0);

    const bundle = buildFinishReports(
      'FLOOR_FINISH',
      'FLOOR',
      makeEntries([inst]),
      materials,
      rates,
    );

    const items = bundle.boq.filter((l) => l.kind === 'item');
    expect(items).toHaveLength(2);
    expect(items[0].description).toMatch(/Screed/);
    expect(items[0].unit).toBe('m³');
    expect(items[0].qty).toBe(calc.totalScreedM3);
    expect(items[1].description).toMatch(/Tiles/);
    expect(items[1].unit).toBe('m²');
    expect(items[1].qty).toBe(calc.totalTilesM2);

    expect(bundle.summary).toEqual({
      screed: calc.totalScreedM3,
      tiles: calc.totalTilesM2,
    });
    expect(bundle.summary).not.toHaveProperty('area');

    const screedAmt = items[0].amount || 0;
    const tilesAmt = items[1].amount || 0;
    expect(bundle.cost.boq).toBeCloseTo(screedAmt + tilesAmt, 2);
  });

  it('elemental cost from two lines feeds cascade without double-count', () => {
    const inst = fakeInst({
      spec: 'Cement screed + porcelain tiles',
      roomLength: 10,
      roomWidth: 8,
      count: 2,
    });
    const bundle = buildFinishReports(
      'FLOOR_FINISH',
      'FLOOR',
      makeEntries([inst]),
      materials,
      rates,
    );
    const items = bundle.boq.filter((l) => l.kind === 'item');
    const sumLines = items.reduce((s, l) => s + (l.amount || 0), 0);
    expect(bundle.cost.boq).toBeCloseTo(sumLines, 2);

    const cascade = computeCostPlanCascade(bundle.cost.boq, {
      designAllowancePercent: 6,
      overheadPercent: 9,
      profitPercent: 5,
      inflationPercent: 3.5,
    });
    expect(cascade.elementalCost).toBe(bundle.cost.boq);
    expect(cascade.constructionCostSCC).toBeGreaterThan(cascade.elementalCost);
  });

  it('non-tile floor finish stays a single area BOQ line', () => {
    const inst = fakeInst({
      spec: 'Granolithic screed',
      roomLength: 4,
      roomWidth: 3,
    });
    const bundle = buildFinishReports(
      'FLOOR_FINISH',
      'FLOOR',
      makeEntries([inst]),
      materials,
      rates,
    );
    const items = bundle.boq.filter((l) => l.kind === 'item');
    expect(items).toHaveLength(1);
    expect(items[0].unit).toBe('m²');
    expect(bundle.summary).toEqual({ area: 12 });
  });

  it('screed BOM uses screedMix (10.8 bags / 1.20 m³ sand for 1.5 m³ @ 360/0.8)', () => {
    const materialsWithScreed = {
      ...materials,
      screedMix: { cementKgPerM3: 360, sandM3PerM3: 0.8 },
      plasterMix: { cementKgPerM3: 280, sandM3PerM3: 1.0 },
    };
    const inst = fakeInst({
      spec: 'Cement screed',
      roomLength: 10,
      roomWidth: 3,
    });
    // 30 m² × 0.05 m = 1.5 m³ screed
    const calc = calcFinish(
      'FLOOR',
      { roomLength: 10, roomWidth: 3, count: 1, spec: 'Cement screed' },
      materialsWithScreed,
    );
    expect(calc.totalScreedM3).toBeCloseTo(1.5, 5);

    const bundle = buildFinishReports(
      'FLOOR_FINISH',
      'FLOOR',
      makeEntries([inst]),
      materialsWithScreed,
      rates,
    );
    const cement = bundle.bom.find((l) =>
      String(l.description).includes('Cement for screed'),
    );
    const sand = bundle.bom.find((l) =>
      String(l.description).includes('Sand for screed'),
    );
    expect(cement?.qty).toBeCloseTo(10.8, 5);
    expect(sand?.qty).toBeCloseTo(1.2, 5);
  });
});

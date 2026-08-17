import { Types } from 'mongoose';
import { buildCostPlan } from '../../services/costPlan/buildCostPlan';
import type { IInstance } from '../../models/Instance';
import type { IProject } from '../../models/Project';
import { DEFAULT_MATERIALS, DEFAULT_RATE_LIB } from '../../defaults/projectDefaults';

function fakeInst(
  patch: Partial<IInstance> & {
    elementKey: string;
    shape: string;
    mark: string;
  },
): IInstance {
  return {
    _id: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    floorId: 'GF',
    count: 1,
    geometry: {},
    concreteGrade: 'C25/30',
    reinforcement: {
      cover: 40,
      vertDia: 12,
      vertSpacing: 200,
      horizDia: 12,
      horizSpacing: 250,
      bothFaces: true,
    },
    spec: null,
    location: null,
    ...patch,
  } as unknown as IInstance;
}

describe('buildCostPlan', () => {
  const project = {
    currency: 'USD',
    useRateAnalysis: false,
    materials: DEFAULT_MATERIALS,
    rateLib: DEFAULT_RATE_LIB,
  } as IProject;

  it('groups by element type with Concrete/Formwork/Reinforcement subheaders', () => {
    const instances = [
      fakeInst({
        elementKey: 'PAD_FOOTING',
        shape: 'RECTANGULAR',
        mark: 'F1',
        geometry: {
          length: 2,
          width: 2,
          baseThickness: 0.5,
        },
        reinforcement: {
          cover: 50,
          bottomMainDia: 16,
          bottomMainSpacing: 150,
          bottomDistDia: 16,
          bottomDistSpacing: 150,
        },
      }),
      fakeInst({
        elementKey: 'WALLS',
        shape: 'LINEAR',
        mark: 'W1',
        location: 'Interior',
        geometry: { length: 5, thickness: 0.25, height: 3 },
      }),
      fakeInst({
        elementKey: 'WALLS',
        shape: 'LINEAR',
        mark: 'W2',
        location: 'Exterior',
        geometry: { length: 4, thickness: 0.25, height: 3 },
      }),
    ];

    const plan = buildCostPlan(project, instances, { scope: 'project' });

    expect(plan.currency).toBe('USD');
    expect(plan.groups.some((g) => g.id === 'PAD_FOOTING')).toBe(true);
    expect(plan.groups.some((g) => g.id === 'WALLS')).toBe(true);

    const pad = plan.groups.find((g) => g.id === 'PAD_FOOTING');
    expect(pad?.heading).toMatch(/Pad Foundation/);
    expect(pad?.uniformatCodes).toContain('A1010');
    expect(
      plan.lines.some(
        (l) => l.kind === 'total' && l.description === 'Pad Foundation total',
      ),
    ).toBe(true);

    // Within Pad Foundation, work categories as subheaders
    const padStart = plan.lines.findIndex(
      (l) => l.kind === 'group' && /Pad Foundation/i.test(l.description || ''),
    );
    const padEnd = plan.lines.findIndex(
      (l) => l.kind === 'total' && l.description === 'Pad Foundation total',
    );
    const padSlice = plan.lines.slice(padStart + 1, padEnd);
    const catHeaders = padSlice
      .filter((l) => l.kind === 'group' && l.workCategory)
      .map((l) => l.description);
    expect(catHeaders).toEqual(
      expect.arrayContaining(['Concrete', 'Formwork', 'Reinforcement']),
    );
    const ci = catHeaders.indexOf('Concrete');
    const fi = catHeaders.indexOf('Formwork');
    const ri = catHeaders.indexOf('Reinforcement');
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(fi).toBeGreaterThan(ci);
    expect(ri).toBeGreaterThan(fi);

    // Interior + Exterior walls share one Walls element section
    expect(plan.lines.some((l) => /Walls/i.test(l.description || '') && l.kind === 'group' && !l.workCategory)).toBe(
      true,
    );
    expect(plan.grandTotal).toBeGreaterThanOrEqual(0);
  });

  it('places manual BOQ under Manual BOQ section', () => {
    const plan = buildCostPlan(project, [], { scope: 'project' }, [
      {
        description: 'Special allowance',
        unit: 'sum',
        quantity: 1,
        labourMode: 'none',
        outputPerDay: null,
        gangDescription: null,
        appliedUnitRate: 1000,
        appliedBomUnitLines: [],
        appliedLabUnitLines: [],
        uniformatCode: 'A1010',
      },
    ]);

    const manual = plan.groups.find((g) => g.id === 'MANUAL');
    expect(manual).toBeTruthy();
    expect(
      manual!.categories.some((c) =>
        c.lines.some(
          (l) => l.source === 'MANUAL' && l.description === 'Special allowance',
        ),
      ),
    ).toBe(true);
    expect(manual!.subtotal).toBe(1000);
    expect(plan.grandTotal).toBe(1000);
    expect(plan.cascade.elementalCost).toBe(1000);
    expect(plan.cascade.constructionCostSCC).toBeGreaterThan(1000);
  });

  it('omits ratePerM2 when gfaM2 is not set', () => {
    const plan = buildCostPlan(project, [], { scope: 'project' }, [
      {
        description: 'Special allowance',
        unit: 'sum',
        quantity: 1,
        labourMode: 'none',
        outputPerDay: null,
        gangDescription: null,
        appliedUnitRate: 1000,
        appliedBomUnitLines: [],
        appliedLabUnitLines: [],
        uniformatCode: 'A1010',
      },
    ]);

    expect(plan.gfaM2).toBeNull();
    expect(plan.lines.every((l) => l.ratePerM2 === undefined)).toBe(true);
  });

  it('adds ratePerM2 = amount ÷ gfaM2 on items and subtotals when gfa set', () => {
    const withGfa = { ...project, gfaM2: 500 } as IProject;
    const plan = buildCostPlan(withGfa, [], { scope: 'project' }, [
      {
        description: 'Special allowance',
        unit: 'sum',
        quantity: 1,
        labourMode: 'none',
        outputPerDay: null,
        gangDescription: null,
        appliedUnitRate: 1000,
        appliedBomUnitLines: [],
        appliedLabUnitLines: [],
        uniformatCode: 'A1010',
      },
    ]);

    expect(plan.gfaM2).toBe(500);

    const item = plan.lines.find(
      (l) => l.kind === 'item' && l.description === 'Special allowance',
    );
    expect(item?.amount).toBe(1000);
    expect(item?.ratePerM2).toBe(2);

    const elSub = plan.lines.find(
      (l) => l.kind === 'total' && l.description === 'Manual BOQ total',
    );
    expect(elSub?.ratePerM2).toBe(2);

    const grand = plan.lines.find(
      (l) =>
        l.kind === 'total' &&
        l.description.includes('COST PLAN TOTAL'),
    );
    expect(grand?.ratePerM2).toBe(2);

    expect(plan.lines.filter((l) => l.kind === 'group').every((l) => l.ratePerM2 === undefined)).toBe(
      true,
    );
  });

  it('includes Item-type manual lines in Manual BOQ and elementalCost', () => {
    const plan = buildCostPlan(
      {
        ...project,
        designAllowancePercent: 0,
        overheadPercent: 0,
        profitPercent: 0,
        inflationPercent: 0,
      } as IProject,
      [],
      { scope: 'project' },
      [
        {
          description: 'Survey control for setting out',
          unit: 'Item',
          quantity: 1,
          labourMode: 'none',
          outputPerDay: null,
          gangDescription: null,
          appliedUnitRate: 2500,
          appliedBomUnitLines: [],
          appliedLabUnitLines: [],
          uniformatCode: 'G20',
        },
      ],
    );

    expect(plan.grandTotal).toBe(2500);
    expect(plan.cascade.elementalCost).toBe(2500);
    expect(plan.cascade.constructionCostSCC).toBe(2500);
    expect(
      plan.lines.some(
        (l) =>
          l.kind === 'item' &&
          l.description === 'Survey control for setting out' &&
          l.source === 'MANUAL',
      ),
    ).toBe(true);
  });

  it('uses Screed/Tiling categories for multi-material floor finish', () => {
    const plan = buildCostPlan(project, [
      fakeInst({
        elementKey: 'FLOOR_FINISH',
        shape: 'AREA',
        mark: 'FF1',
        spec: 'Cement screed + ceramic tiles',
        geometry: { roomLength: 6, roomWidth: 5, roomLabel: 'ROOM 1' },
      }),
    ], { scope: 'project' });

    const floor = plan.groups.find((g) => g.id === 'FLOOR_FINISH');
    expect(floor).toBeTruthy();
    const cats = floor!.categories.map((c) => c.category);
    expect(cats).toEqual(expect.arrayContaining(['Screed', 'Tiling']));
    expect(cats).not.toContain('Concrete');
    expect(cats).not.toContain('Formwork');

    // Cost Plan reads BOQ descriptions directly — templated, no room/label glue
    const items = plan.lines.filter((l) => l.kind === 'item');
    expect(
      items.some((l) =>
        /Cement and sand screed to floor, \d+mm thick, to receive tiling/.test(
          l.description || '',
        ),
      ),
    ).toBe(true);
    expect(
      items.some((l) =>
        /Ceramic floor tiles, bedded and pointed in cement mortar/.test(
          l.description || '',
        ),
      ),
    ).toBe(true);
    for (const it of items) {
      expect(it.description).not.toMatch(/ROOM 1/i);
      expect(it.description).not.toMatch(/Floor Finishes\s*—/i);
    }
  });
});

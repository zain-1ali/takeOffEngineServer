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

  it('groups pad foundations under A1010 and walls by location', () => {
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
    expect(plan.groups.some((g) => g.id === 'A')).toBe(true);
    expect(plan.groups.some((g) => g.id === 'B')).toBe(true);
    expect(plan.groups.some((g) => g.id === 'C')).toBe(true);

    const a1010 = plan.groups
      .flatMap((g) => g.codes)
      .find((c) => c.code === 'A1010');
    expect(a1010?.heading).toBe('A1010 - Standard Foundations');
    expect(
      plan.lines.some(
        (l) =>
          l.kind === 'total' &&
          l.description === 'A1010 - Standard Foundations · Sub-total',
      ),
    ).toBe(true);

    expect(plan.lines.some((l) => l.description === 'A - Substructure')).toBe(
      true,
    );
    expect(
      plan.lines.some((l) => l.description === 'B2010 - Exterior Walls'),
    ).toBe(true);
    expect(plan.lines.some((l) => l.description === 'C1010 - Partitions')).toBe(
      true,
    );
    expect(plan.grandTotal).toBeGreaterThanOrEqual(0);

    // Within A1010, work categories appear as subheaders before their items
    const a1010Start = plan.lines.findIndex(
      (l) => l.kind === 'group' && l.description === 'A1010 - Standard Foundations',
    );
    const a1010End = plan.lines.findIndex(
      (l) =>
        l.kind === 'total' &&
        l.description === 'A1010 - Standard Foundations · Sub-total',
    );
    const a1010Slice = plan.lines.slice(a1010Start + 1, a1010End);
    const catHeaders = a1010Slice
      .filter((l) => l.kind === 'group' && l.workCategory)
      .map((l) => l.description);
    expect(catHeaders).toEqual(
      expect.arrayContaining(['Concrete', 'Formwork', 'Reinforcement']),
    );
    // Categories must appear in canonical order (Concrete before Formwork before Reinforcement)
    const ci = catHeaders.indexOf('Concrete');
    const fi = catHeaders.indexOf('Formwork');
    const ri = catHeaders.indexOf('Reinforcement');
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(fi).toBeGreaterThan(ci);
    expect(ri).toBeGreaterThan(fi);
  });

  it('places manual BOQ under its uniformatCode', () => {
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

    const a1010 = plan.groups
      .flatMap((g) => g.codes)
      .find((c) => c.code === 'A1010');
    expect(a1010).toBeTruthy();
    expect(
      a1010!.lines.some(
        (l) => l.source === 'MANUAL' && l.description === 'Special allowance',
      ),
    ).toBe(true);
    expect(a1010!.subtotal).toBe(1000);
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

    const codeSub = plan.lines.find(
      (l) =>
        l.kind === 'total' &&
        l.description === 'A1010 - Standard Foundations · Sub-total',
    );
    expect(codeSub?.ratePerM2).toBe(2);

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

  it('includes Item-type manual lines in UniFormat group and elementalCost', () => {
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
        {
          description: 'Unclassified provisional',
          unit: 'Item',
          quantity: 1,
          labourMode: 'none',
          outputPerDay: null,
          gangDescription: null,
          appliedUnitRate: 500,
          appliedBomUnitLines: [],
          appliedLabUnitLines: [],
          uniformatCode: null,
        },
      ],
    );

    const survey = plan.lines.find(
      (l) =>
        l.kind === 'item' &&
        l.source === 'MANUAL' &&
        l.description === 'Survey control for setting out',
    );
    expect(survey).toMatchObject({
      qty: 1,
      unit: 'Item',
      amount: 2500,
      uniformatCode: 'G20',
    });
    expect(
      plan.lines.some(
        (l) => l.description === 'G20 - Site Improvements',
      ),
    ).toBe(true);

    const unclassified = plan.lines.find(
      (l) =>
        l.kind === 'item' &&
        l.description === 'Unclassified provisional',
    );
    expect(unclassified?.uniformatCode).toBe('Z9990');
    expect(plan.unclassifiedCount).toBe(1);

    expect(plan.grandTotal).toBe(3000);
    expect(plan.cascade.elementalCost).toBe(3000);
    expect(plan.cascade.constructionCostSCC).toBe(3000);
  });
});

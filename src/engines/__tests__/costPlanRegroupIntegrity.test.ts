/**
 * Prove category regrouping does not drop/duplicate/alter priced line items —
 * only reorders them under Concrete / Formwork / … subheaders.
 */
import { Types } from 'mongoose';
import {
  buildCostPlan,
  getLastCostPlanRegroupIntegrity,
} from '../../services/costPlan/buildCostPlan';
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

describe('category regroup integrity', () => {
  const project = {
    currency: 'USD',
    useRateAnalysis: false,
    materials: DEFAULT_MATERIALS,
    rateLib: DEFAULT_RATE_LIB,
    designAllowancePercent: 0,
    overheadPercent: 0,
    profitPercent: 0,
    inflationPercent: 0,
  } as IProject;

  it('preserves LINE ITEM COUNT and GRAND TOTAL (before === after)', () => {
    const instances = [
      fakeInst({
        elementKey: 'PAD_FOOTING',
        shape: 'RECTANGULAR',
        mark: 'F1',
        geometry: { length: 2, width: 2, baseThickness: 0.5 },
        reinforcement: {
          cover: 50,
          bottomMainDia: 16,
          bottomMainSpacing: 150,
          bottomDistDia: 16,
          bottomDistSpacing: 150,
        },
      }),
      fakeInst({
        elementKey: 'STRIP_FOOTING',
        shape: 'RECTANGULAR',
        mark: 'SF1',
        geometry: { length: 10, width: 0.6, baseThickness: 0.4 },
        reinforcement: {
          cover: 50,
          bottomMainDia: 12,
          bottomMainSpacing: 150,
          bottomDistDia: 12,
          bottomDistSpacing: 200,
        },
      }),
      fakeInst({
        elementKey: 'WALLS',
        shape: 'LINEAR',
        mark: 'W1',
        location: 'Exterior',
        geometry: { length: 8, thickness: 0.2, height: 3 },
      }),
      fakeInst({
        elementKey: 'WALLS',
        shape: 'LINEAR',
        mark: 'W2',
        location: 'Interior',
        geometry: { length: 5, thickness: 0.15, height: 3 },
      }),
      fakeInst({
        elementKey: 'COLUMNS',
        shape: 'RECTANGULAR',
        mark: 'C1',
        geometry: { length: 0.4, width: 0.4, height: 3 },
      }),
      fakeInst({
        elementKey: 'MASONRY',
        shape: 'LINEAR',
        mark: 'M1',
        location: 'Exterior',
        geometry: { length: 6, thickness: 0.2, height: 2.5 },
      }),
      fakeInst({
        elementKey: 'FLOOR_FINISH',
        shape: 'RECTANGULAR',
        mark: 'FF1',
        geometry: { length: 4, width: 5 },
      }),
    ];

    const manuals = [
      {
        description: 'Survey control for setting out',
        unit: 'Item',
        quantity: 1,
        labourMode: 'none' as const,
        outputPerDay: null,
        gangDescription: null,
        appliedUnitRate: 2500,
        appliedBomUnitLines: [],
        appliedLabUnitLines: [],
        uniformatCode: 'G20',
      },
      {
        description: 'Provisional sum',
        unit: 'Item',
        quantity: 1,
        labourMode: 'none' as const,
        outputPerDay: null,
        gangDescription: null,
        appliedUnitRate: 500,
        appliedBomUnitLines: [],
        appliedLabUnitLines: [],
        uniformatCode: 'A1010',
      },
    ];

    const plan = buildCostPlan(project, instances, { scope: 'project' }, manuals);
    const integrity = getLastCostPlanRegroupIntegrity();

    expect(integrity).toBeTruthy();
    const {
      beforeItemCount,
      afterItemCount,
      beforeGrandTotal,
      afterGrandTotal,
    } = integrity!;

    // Proof for the verification report
    // eslint-disable-next-line no-console
    console.log(
      [
        'CATEGORY REGROUP INTEGRITY',
        `  LINE ITEM COUNT  before=${beforeItemCount}  after=${afterItemCount}`,
        `  GRAND TOTAL       before=${beforeGrandTotal}  after=${afterGrandTotal}`,
      ].join('\n'),
    );

    expect(afterItemCount).toBe(beforeItemCount);
    expect(afterGrandTotal).toBe(beforeGrandTotal);
    expect(plan.grandTotal).toBe(afterGrandTotal);

    const emittedItems = plan.lines.filter((l) => l.kind === 'item');
    expect(emittedItems.length).toBe(afterItemCount);
  });
});

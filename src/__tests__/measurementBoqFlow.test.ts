import { Types } from 'mongoose';
import {
  arcLengthMetres,
  circleRadiusMetres,
  linearMetres,
  polygonAreaMetres2,
  polygonPairMetres,
} from '../../../frontend/src/lib/measureGeometry';
import {
  areaDimensionPatchForFocus,
  countPatchForTarget,
  scalarPatchForFocus,
} from '../../../frontend/src/lib/measurementFieldApply';
import { DEFAULT_MATERIALS, DEFAULT_RATE_LIB } from '../defaults/projectDefaults';
import { buildCostPlan } from '../services/costPlan/buildCostPlan';
import type { IInstance } from '../models/Instance';
import type { IProject } from '../models/Project';

type ApplyPatch = {
  geometry?: Record<string, unknown>;
  count?: number;
};

const project = {
  currency: 'USD',
  useRateAnalysis: false,
  materials: DEFAULT_MATERIALS,
  rateLib: DEFAULT_RATE_LIB,
} as IProject;

function beam(): IInstance {
  return {
    _id: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    floorId: 'GF',
    elementKey: 'BEAMS',
    shape: 'RECTANGULAR',
    mark: 'B-MEASURE',
    count: 1,
    geometry: { spanLength: 1, width: 0.3, depth: 0.5 },
    concreteGrade: 'C25/30',
    reinforcement: {
      cover: 40,
      topBarCount: 2,
      topBarDia: 12,
      bottomBarCount: 2,
      bottomBarDia: 12,
      linkDia: 8,
      linkSpacing: 200,
    },
    spec: null,
    location: null,
  } as unknown as IInstance;
}

function pad(): IInstance {
  return {
    _id: new Types.ObjectId(),
    projectId: new Types.ObjectId(),
    floorId: 'FDN',
    elementKey: 'PAD_FOOTING',
    shape: 'RECTANGULAR',
    mark: 'F-MEASURE',
    count: 1,
    geometry: { length: 1, width: 1, baseThickness: 0.5 },
    concreteGrade: 'C25/30',
    reinforcement: {
      cover: 50,
      bottomMainDia: 16,
      bottomMainSpacing: 150,
      bottomDistDia: 16,
      bottomDistSpacing: 150,
    },
    spec: null,
    location: null,
  } as unknown as IInstance;
}

/** Same merge semantics as ScheduleTab's MeasureSessionModal onApply. */
function applySchedulePatch(instance: IInstance, patch: ApplyPatch): IInstance {
  return {
    ...instance,
    count: patch.count ?? instance.count,
    geometry: {
      ...(instance.geometry || {}),
      ...(patch.geometry || {}),
    },
  } as IInstance;
}

function costSignature(instance: IInstance) {
  const plan = buildCostPlan(project, [instance], { scope: 'project' });
  const items = plan.lines
    .filter((line) => line.kind === 'item')
    .map((line) => ({
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      rate: line.rate,
      amount: line.amount,
    }));
  expect(items.length).toBeGreaterThan(0);
  expect(items.some((line) => (line.amount ?? 0) > 0)).toBe(true);
  expect(plan.grandTotal).toBeGreaterThan(0);
  return { items, grandTotal: plan.grandTotal };
}

function expectMeasuredEqualsManual(
  base: IInstance,
  patch: ApplyPatch,
): void {
  const measured = applySchedulePatch(base, patch);
  const manual = {
    ...base,
    count: patch.count ?? base.count,
    geometry: {
      ...(base.geometry || {}),
      ...(patch.geometry || {}),
    },
  } as IInstance;
  expect(costSignature(measured)).toEqual(costSignature(manual));
}

describe('measurement value → schedule instance → costed BOQ', () => {
  const scale = 0.1; // metres per image pixel

  it('Linear reaches BOQ exactly like a manually typed span', () => {
    const value = linearMetres([{ x: 0, y: 0 }, { x: 60, y: 0 }], scale, 'm');
    expect(value).toBe(6);
    const patch = scalarPatchForFocus(
      {
        target: {
          kind: 'geometry',
          id: 'spanLength',
          label: 'Span',
          key: 'spanLength',
          defaultMode: 'LINEAR',
        },
      },
      value!,
    );
    expect(patch).toEqual({ geometry: { spanLength: 6 } });
    expectMeasuredEqualsManual(beam(), patch!);
  });

  it('Polyline sums every segment and reaches BOQ like a manual span', () => {
    const value = linearMetres(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 40 },
        { x: 50, y: 40 },
      ],
      scale,
      'm',
    );
    expect(value).toBe(9);
    // Regression: a scalar Polyline launched from a paired field must update
    // only the clicked member, never enter the Area/Rectangle "both" branch.
    const patch = scalarPatchForFocus(
      {
        target: {
          kind: 'geometryPair',
          id: 'lw',
          label: 'L + W',
          keys: ['length', 'width'],
          labels: ['L', 'W'],
          defaultMode: 'AREA',
        },
        clickedKey: 'length',
        clickedLabel: 'L',
      },
      value!,
    );
    expect(patch).toEqual({ geometry: { length: 9 } });
    expectMeasuredEqualsManual(pad(), patch!);
  });

  it('Area reaches BOQ through measured footprint dimensions', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 0, y: 30 },
    ];
    const sides = polygonPairMetres(points, scale, 'm');
    const area = polygonAreaMetres2(points, scale, 'm');
    expect(sides).toEqual({ a: 4, b: 3 });
    expect(area).toBe(12);
    const dimensions = areaDimensionPatchForFocus(
      {
        target: {
          kind: 'geometryPair',
          id: 'lw',
          label: 'L + W',
          keys: ['length', 'width'],
          labels: ['L', 'W'],
          defaultMode: 'AREA',
        },
        clickedKey: 'length',
        clickedLabel: 'L',
      },
      'both',
      sides!,
    );
    const patch = {
      geometry: {
        ...dimensions!.geometry,
        areaOverride: area,
      },
    };
    expect(patch.geometry).toEqual({
      length: 4,
      width: 3,
      areaOverride: 12,
    });
    expectMeasuredEqualsManual(pad(), patch);
  });

  it('Rectangle reaches BOQ through the same measured footprint path', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 0, y: 30 },
    ];
    const sides = polygonPairMetres(points, scale, 'm');
    const area = polygonAreaMetres2(points, scale, 'm');
    expect(sides).toEqual({ a: 4, b: 3 });
    expect(area).toBe(12);
    const dimensions = areaDimensionPatchForFocus(
      {
        target: {
          kind: 'geometryPair',
          id: 'lw',
          label: 'L + W',
          keys: ['length', 'width'],
          labels: ['L', 'W'],
          defaultMode: 'AREA',
        },
        clickedKey: 'length',
        clickedLabel: 'L',
      },
      'both',
      sides!,
    );
    const patch = {
      geometry: {
        ...dimensions!.geometry,
        areaOverride: area,
      },
    };
    expect(patch.geometry).toEqual({
      length: 4,
      width: 3,
      areaOverride: 12,
    });
    expectMeasuredEqualsManual(pad(), patch);
  });

  it('Circle radius reaches BOQ exactly like a manually typed length field', () => {
    const radius = circleRadiusMetres(
      [{ x: 0, y: 0 }, { x: 60, y: 0 }],
      scale,
      'm',
    );
    expect(radius).toBe(6);
    const patch = scalarPatchForFocus(
      {
        target: {
          kind: 'geometry',
          id: 'spanLength',
          label: 'Span',
          key: 'spanLength',
          defaultMode: 'LINEAR',
        },
      },
      radius!,
    );
    expect(patch).toEqual({ geometry: { spanLength: 6 } });
    expectMeasuredEqualsManual(beam(), patch!);
  });

  it('Arc length reaches BOQ exactly like a manually typed length field', () => {
    const length = arcLengthMetres(
      [
        { x: 0, y: 0 },
        { x: 30, y: 30 },
        { x: 60, y: 0 },
      ],
      scale,
      'm',
    );
    expect(length).not.toBeNull();
    expect(length!).toBeGreaterThan(6);
    const patch = scalarPatchForFocus(
      {
        target: {
          kind: 'geometry',
          id: 'spanLength',
          label: 'Span',
          key: 'spanLength',
          defaultMode: 'LINEAR',
        },
      },
      length!,
    );
    expect(patch?.geometry?.spanLength).toBe(length);
    expectMeasuredEqualsManual(beam(), patch!);
  });

  it('Count reaches BOQ exactly like a manually typed instance count', () => {
    const patch = countPatchForTarget(
      { kind: 'count', id: 'count', label: 'No.', defaultMode: 'COUNT' },
      3,
    );
    expect(patch).toEqual({ count: 3 });
    expectMeasuredEqualsManual(beam(), patch!);
  });
});

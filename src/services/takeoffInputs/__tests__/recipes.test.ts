import {
  attachInputQuantities,
  evaluateLineInput,
  recipeForLine,
} from '..';
import type { SelectedBoqReportItem } from '../../selectedBoq';

describe('Take off Input quantity recipes', () => {
  it.each([
    ['nr', 'count'],
    ['m', 'length'],
    ['m²', 'area'],
    ['m³', 'volume'],
    ['kg', 'weight'],
    ['day', 'time'],
    ['%', 'percent'],
    ['sum', 'direct'],
  ])('always provides a safe recipe for %s', (unit, method) => {
    expect(recipeForLine({ unit }).method).toBe(method);
  });

  it('uses formula wording to improve an otherwise unknown unit', () => {
    expect(
      recipeForLine({
        unit: 'item',
        formulaText: 'Number × excavation Length × Width × Depth',
      }).method,
    ).toBe('volume');
  });

  it('calculates excavation with count, working dimensions and extra allowance', () => {
    expect(
      evaluateLineInput({
        recipe: recipeForLine({ unit: 'm³' }),
        input: {
          method: 'volume',
          count: 2,
          length: 4,
          width: 3,
          depth: 1.5,
          wastePct: 10,
        },
      }),
    ).toEqual({ quantity: 39.6, source: 'input', method: 'volume' });
  });

  it('supports conditional exclusion and sibling-derived quantities', () => {
    expect(
      evaluateLineInput({
        recipe: recipeForLine({ unit: 'm²' }),
        input: { enabled: false, method: 'area' },
      })?.quantity,
    ).toBe(0);
    expect(
      evaluateLineInput({
        recipe: recipeForLine({ unit: 'm²' }),
        input: { sourceLineKey: 'base', factor: 1.2 },
        resolvedLines: { base: 10 },
      }),
    ).toEqual({ quantity: 12, source: 'derived', method: 'area' });
  });

  it('attaches floor-scoped and project-scoped calculated quantities', () => {
    const lines: SelectedBoqReportItem[] = [
      {
        id: 'a',
        floorId: 'GF',
        elementKey: 'PAD_FOOTING',
        catalogueRef: '1.04',
        lineKey: 'M01:1.04',
        description: 'Extra excavation',
        unit: 'm³',
        quantity: 0,
      },
      {
        id: 'b',
        floorId: '__PROJECT__',
        elementKey: 'CAT_M00_E001',
        catalogueRef: '1.01',
        lineKey: 'M00:1.01',
        description: 'Mobilisation',
        unit: 'item',
        quantity: 0,
      },
    ];
    const result = attachInputQuantities(lines, [
      {
        floorId: 'GF',
        elementKey: 'PAD_FOOTING',
        shared: {},
        lineInputs: {
          'M01:1.04': {
            method: 'volume',
            count: 1,
            length: 4,
            width: 2,
            depth: 0.5,
          },
        },
      },
      {
        floorId: '__PROJECT__',
        elementKey: 'CAT_M00_E001',
        shared: {},
        lineInputs: {
          'M00:1.01': { method: 'direct', quantity: 1 },
        },
      },
    ] as any);

    expect(result.map((line) => line.inputQuantity)).toEqual([4, 1]);
  });
});

import { bbsQuantity, cuttingLength, emptyBar, unitMass } from '../bbs';
import {
  evalNumber,
  itemQuantity,
  lineOutputs,
  sanitizeLines,
  takeoffKindFor,
} from '../measurement';

describe('boq takeoff engine', () => {
  it('evaluates cell formulas', () => {
    expect(evalNumber('8*2')).toBe(16);
    expect(evalNumber('(3.6+1.2)/2')).toBe(2.4);
    expect(evalNumber('nope', 7)).toBe(7);
  });

  it('maps unit to volume / area / linear / count', () => {
    const lines = sanitizeLines([
      {
        id: '1',
        shape: 'rect',
        nr: '2',
        dims: { a: '8.0', b: '3.0' },
        depth: '0.25',
      },
    ]);
    expect(itemQuantity('m³', lines).total).toBe(12);
    expect(itemQuantity('m2', lines).total).toBe(48);
    expect(itemQuantity('m', lines).total).toBe(44);
    expect(itemQuantity('nr', lines).total).toBe(2);
  });

  it('applies deductions and waste', () => {
    const lines = sanitizeLines([
      {
        id: 'a',
        shape: 'rect',
        nr: 1,
        dims: { a: 4, b: 3 },
        depth: 0.2,
      },
      {
        id: 'b',
        shape: 'rect',
        ded: true,
        nr: 1,
        dims: { a: 1, b: 1 },
        depth: 0.2,
      },
    ]);
    expect(itemQuantity('m³', lines).total).toBeCloseTo(2.2, 2);
    expect(itemQuantity('m³', lines, 10).total).toBeCloseTo(2.42, 2);
  });

  it('treats t/kg as BBS and others as dim', () => {
    expect(takeoffKindFor('t')).toBe('bbs');
    expect(takeoffKindFor('kg')).toBe('bbs');
    expect(takeoffKindFor('m³')).toBe('dim');
  });

  it('computes a straight bar mass', () => {
    const bar = emptyBar({
      shapeCode: '00',
      dims: { A: 3000 },
      dia: 16,
      mbrs: 2,
      each: 10,
    });
    expect(cuttingLength(bar)).toBe(3000);
    const q = bbsQuantity('t', [bar], 0);
    const expectedKg = (2 * 10 * 3) * unitMass(16);
    expect(q.totalKg).toBeCloseTo(expectedKg, 2);
    expect(q.total).toBeCloseTo(expectedKg / 1000, 3);
  });

  it('computes closed-link cut length', () => {
    const bar = emptyBar({
      shapeCode: '51',
      dims: { A: 200, B: 450 },
      dia: 10,
      mbrs: 1,
      each: 1,
    });
    const out = lineOutputs({
      id: 'x',
      shape: 'direct',
      nr: 1,
      direct: { value: 5, prim: 'area' },
    });
    expect(out.area).toBe(5);
    expect(cuttingLength(bar)).toBeGreaterThan(1000);
  });
});

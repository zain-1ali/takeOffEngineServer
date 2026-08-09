import {
  convertQuantity,
  lengthFromDisplay,
  lengthToDisplay,
  M3_TO_FT3,
  parseUnitSystem,
} from '../units';

describe('units conversion', () => {
  it('parses project units strings', () => {
    expect(parseUnitSystem('metric')).toBe('metric');
    expect(parseUnitSystem('Metric (m, m³)')).toBe('metric');
    expect(parseUnitSystem('imperial')).toBe('imperial');
    expect(parseUnitSystem('Imperial (ft, ft³)')).toBe('imperial');
  });

  it('converts 1 m³ to 35.31 ft³ (not a relabel)', () => {
    const c = convertQuantity(1, 'm³', 'imperial');
    expect(c.unit).toBe('ft³');
    expect(c.value).toBeCloseTo(35.31, 2);
    expect(c.value).toBeCloseTo(M3_TO_FT3, 6);
    expect(c.value).not.toBe(1);
  });

  it('converts area and length', () => {
    expect(convertQuantity(1, 'm²', 'imperial').value).toBeCloseTo(10.76, 2);
    expect(convertQuantity(1, 'm', 'imperial').unit).toBe('ft');
    expect(lengthToDisplay(1, 'imperial')).toBeCloseTo(3.28084, 4);
    expect(lengthFromDisplay(3.280839895, 'imperial')).toBeCloseTo(1, 6);
  });

  it('leaves non-geometric units unchanged', () => {
    expect(convertQuantity(100, 'kg', 'imperial')).toEqual({
      value: 100,
      unit: 'kg',
    });
    expect(convertQuantity(2, 'bags', 'imperial').unit).toBe('bags');
  });

  it('metric system is identity', () => {
    expect(convertQuantity(1.5, 'm³', 'metric')).toEqual({
      value: 1.5,
      unit: 'm³',
    });
  });
});

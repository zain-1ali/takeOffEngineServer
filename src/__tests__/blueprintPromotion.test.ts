import {
  measurementValueToMetric,
  promotionDefinition,
  promotionOptions,
} from '../services/blueprintPromotion';

describe('blueprint promotion metadata', () => {
  it('only returns area-compatible element types for an area measurement', () => {
    const options = promotionOptions('AREA');
    expect(options.map((option) => option.elementKey)).toEqual([
      'FLOOR_FINISH',
      'WALL_FINISH',
      'CEILING_FINISH',
      'MASONRY',
    ]);
    expect(options.every((option) => option.mappedField === 'areaOverride')).toBe(
      true,
    );
  });

  it('maps traced wall length directly into the Walls length field', () => {
    const definition = promotionDefinition('WALLS', 'LINEAR');
    expect(definition).not.toBeNull();
    expect(definition!.geometry(7.25, 'Wall A')).toMatchObject({
      length: 7.25,
    });
    expect(promotionDefinition('WALLS', 'AREA')).toBeNull();
  });

  it('converts blueprint values to the metric units used by calc()', () => {
    expect(measurementValueToMetric(100, 'ft²', 'AREA')).toBeCloseTo(
      9.290304,
      8,
    );
    expect(measurementValueToMetric(10, 'ft', 'LINEAR')).toBeCloseTo(3.048, 8);
    expect(measurementValueToMetric(12, 'm²', 'AREA')).toBe(12);
  });
});

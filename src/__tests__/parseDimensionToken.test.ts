import {
  parseDimensionPair,
  parseDimensionToken,
  sanitizeRoomDimensions,
} from '../utils/parseDimension';

describe('parseDimensionToken — thousands commas, not decimals', () => {
  it('treats "3,765" as 3765, not 3.765', () => {
    expect(parseDimensionToken('3,765')).toBe(3765);
  });

  it('strips multi-group thousands separators', () => {
    expect(parseDimensionToken('12,345,678')).toBe(12345678);
  });

  it('parses pairs like "3,765 x 2,851"', () => {
    expect(parseDimensionPair('3,765 x 2,851')).toEqual({
      a: 3765,
      b: 2851,
    });
  });

  it('recomputes area and perimeter from corrected integer dims', () => {
    const sanitized = sanitizeRoomDimensions({
      dimensions: '3,765x2,851',
      calculated_area: 3.765 * 2.851,
      perimeter: 2 * (3.765 + 2.851),
    });
    expect(sanitized.dimensionA).toBe(3765);
    expect(sanitized.dimensionB).toBe(2851);
    expect(sanitized.calculatedArea).toBe(3765 * 2851);
    expect(sanitized.calculatedPerimeter).toBe(2 * (3765 + 2851));
    expect(sanitized.dimensionUnit).toBe('mm');
  });
});

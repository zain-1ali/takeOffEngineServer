import {
  defaultLocationForElement,
  formatUniformatHeading,
  resolveUniformatCode,
} from '../../services/costPlan/uniformat';

describe('resolveUniformatCode', () => {
  it('maps fixed foundation / frame elements 1:1', () => {
    expect(resolveUniformatCode('PAD_FOOTING').code).toBe('A1010');
    expect(resolveUniformatCode('STRIP_FOOTING').code).toBe('A1010');
    expect(resolveUniformatCode('STONE_STRIP').code).toBe('A1010');
    expect(resolveUniformatCode('PILE_CAP').code).toBe('A1020');
    expect(resolveUniformatCode('PILES').code).toBe('A1020');
    expect(resolveUniformatCode('COLUMNS').code).toBe('B10');
    expect(resolveUniformatCode('BEAMS').code).toBe('B10');
    expect(resolveUniformatCode('PIPES').code).toBe('D20');
    expect(resolveUniformatCode('DUCTS').code).toBe('D30');
    expect(resolveUniformatCode('ELECTRICAL').code).toBe('D50');
  });

  it('maps walls by location', () => {
    expect(
      resolveUniformatCode('WALLS', { location: 'Below-grade' }).code,
    ).toBe('A20');
    expect(resolveUniformatCode('WALLS', { location: 'Exterior' }).code).toBe(
      'B2010',
    );
    expect(resolveUniformatCode('WALLS', { location: 'Interior' }).code).toBe(
      'C1010',
    );
  });

  it('maps slabs by location', () => {
    expect(resolveUniformatCode('SLABS', { location: 'On-grade' }).code).toBe(
      'A1030',
    );
    expect(
      resolveUniformatCode('SLABS', { location: 'Elevated floor' }).code,
    ).toBe('B1010');
    expect(resolveUniformatCode('SLABS', { location: 'Roof' }).code).toBe(
      'B1020',
    );
  });

  it('maps doors/windows and wall finishes by location', () => {
    expect(
      resolveUniformatCode('DOORS_WINDOWS', { location: 'Exterior' }).code,
    ).toBe('B2020');
    expect(
      resolveUniformatCode('DOORS_WINDOWS', { location: 'Interior' }).code,
    ).toBe('C1020');
    expect(
      resolveUniformatCode('WALL_FINISH', { location: 'Exterior' }).code,
    ).toBe('B2010');
    expect(
      resolveUniformatCode('WALL_FINISH', { location: 'Interior' }).code,
    ).toBe('C3010');
  });

  it('defaults slab location from floor id when location omitted', () => {
    expect(defaultLocationForElement('SLABS', 'FDN')).toBe('On-grade');
    expect(defaultLocationForElement('SLABS', 'GF')).toBe('On-grade');
    expect(defaultLocationForElement('SLABS', 'L01')).toBe('Elevated floor');
    expect(defaultLocationForElement('SLABS', 'ROOF')).toBe('Roof');
    expect(resolveUniformatCode('SLABS', { floorId: 'GF' }).code).toBe('A1030');
    expect(resolveUniformatCode('WALLS', { floorId: 'L01' }).code).toBe('C1010');
  });

  it('formats UniFormat headings like the reference PDF', () => {
    expect(formatUniformatHeading('A1010')).toBe(
      'A1010 - Standard Foundations',
    );
  });
});

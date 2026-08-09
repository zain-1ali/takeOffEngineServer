import { normalizeLlmRows, parseCategory, parseUnitCost } from '../../services/ratePdfImport/normalize';

describe('rate PDF normalize', () => {
  it('maps category aliases and unit costs', () => {
    expect(parseCategory('Labor')).toBe('labour');
    expect(parseCategory('Plant')).toBe('equipment');
    expect(parseUnitCost('$1,234.50')).toBe(1234.5);
  });

  it('drops incomplete LLM rows and marks survivors PENDING', () => {
    const rows = normalizeLlmRows([
      { category: 'Materials', name: 'Cement', unit: 'bag', unitCost: 9.5, confidence: 0.9 },
      { category: 'Labour', name: '', unit: 'day', unitCost: 20 },
      { category: 'Nope', name: 'X', unit: 'm', unitCost: 1 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].category).toBe('materials');
    expect(rows[0].unitCost).toBe(9.5);
  });
});

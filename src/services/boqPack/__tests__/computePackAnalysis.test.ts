import { parsePercentCell } from '../parsePercent'
import { computePackAnalysis } from '../computePackAnalysis'

describe('parsePercentCell', () => {
  it('reads Excel fractions and percent labels', () => {
    expect(parsePercentCell(0.05)).toBe(0.05)
    expect(parsePercentCell(10)).toBe(0.1)
    expect(parsePercentCell('10%')).toBe(0.1)
    expect(parsePercentCell('2.5% of labour + plant')).toBe(0.025)
    expect(parsePercentCell('5% of materials')).toBe(0.05)
  })
})

describe('computePackAnalysis', () => {
  it('matches the workbook M00:1.01 build-up using databank unit rates', () => {
    const computed = computePackAnalysis({
      lines: [
        { sourceCode: 'MAT-002', quantity: 0.02 },
        { sourceCode: 'LAB-015', quantity: 6 },
        { sourceCode: 'LAB-001', quantity: 8 },
        { sourceCode: 'PLT-018', quantity: 0.25 },
        { sourceCode: 'SUB-009', quantity: 0.1 },
        { sourceCode: 'MAT-096', quantity: 0.02 },
      ],
      resourcesByCode: {
        'MAT-002': {
          code: 'MAT-002',
          category: 'MAT',
          description: 'Ancillary',
          unit: 'item',
          unitRate: 38.64,
          wastePct: 0.05,
        },
        'LAB-015': {
          code: 'LAB-015',
          category: 'LAB',
          description: 'Site engineer',
          unit: 'hr',
          unitRate: 3.86,
          wastePct: 0,
        },
        'LAB-001': {
          code: 'LAB-001',
          category: 'LAB',
          description: 'Specialist',
          unit: 'hr',
          unitRate: 3.86,
          wastePct: 0,
        },
        'PLT-018': {
          code: 'PLT-018',
          category: 'PLT',
          description: 'Test instruments',
          unit: 'day',
          unitRate: 38.64,
          wastePct: 0,
        },
        'SUB-009': {
          code: 'SUB-009',
          category: 'SUB',
          description: 'Testing',
          unit: 'item',
          unitRate: 579.6,
          wastePct: 0,
        },
        'MAT-096': {
          code: 'MAT-096',
          category: 'MAT',
          description: 'Signage',
          unit: 'nr',
          unitRate: 115.92,
          wastePct: 0.05,
        },
      },
      allowances: {
        transportPctMaterials: 0.05,
        sundriesPctLabourPlantSubcontract: 0.025,
        overheadPct: 0.1,
        profitPct: 0.1,
      },
    })

    expect(computed.missingCodes).toEqual([])
    expect(computed.compositeRate).toBeGreaterThan(150)
    expect(computed.compositeRate).toBeLessThan(160)
  })

  it('marks missing resource codes', () => {
    const computed = computePackAnalysis({
      lines: [{ sourceCode: 'NOPE', quantity: 1 }],
      resourcesByCode: {},
      allowances: {
        transportPctMaterials: 0,
        sundriesPctLabourPlantSubcontract: 0,
        overheadPct: 0,
        profitPct: 0,
      },
    })
    expect(computed.missingCodes).toEqual(['NOPE'])
    expect(computed.compositeRate).toBe(0)
  })
})

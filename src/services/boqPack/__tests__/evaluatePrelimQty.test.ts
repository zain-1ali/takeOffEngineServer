import {
  evaluatePrelimLine,
  normalizePrelimUnit,
  positiveOrNull,
} from '../evaluatePrelimQty'
import { PROJECT_SCOPE_FLOOR_ID } from '../scope'

const base = {
  id: 'x',
  floorId: PROJECT_SCOPE_FLOOR_ID,
  moduleNo: 0,
  scope: 'PROJECT',
  quantity: 0,
  catalogueRef: '2.01',
  description: 'Staff',
  compositeRate: 10,
  reconciliationStatus: 'ACTIVE',
}

describe('evaluatePrelimLine', () => {
  it('maps unambiguous weeks to programmeWeeks', () => {
    const row = evaluatePrelimLine(
      {
        ...base,
        unit: 'wk',
        formulaText: 'Weeks on site (programme duration)',
      },
      { programmeWeeks: 40, gfaM2: null, contractValue: null },
    )
    expect(row.eligible).toBe(true)
    expect(row.proposedQty).toBe(40)
    expect(row.proposedAmount).toBe(400)
    expect(row.basis).toBe('programmeWeeks')
  })

  it('skips weeks × staff', () => {
    const row = evaluatePrelimLine(
      {
        ...base,
        unit: 'wk',
        formulaText: 'Weeks × number of staff',
      },
      { programmeWeeks: 40, gfaM2: null, contractValue: null },
    )
    expect(row.eligible).toBe(false)
    expect(row.skipReason).toBe('FORMULA_AMBIGUOUS')
  })

  it('maps GIFA cleaning lines to gfaM2 and skips measured storage', () => {
    const gifa = evaluatePrelimLine(
      {
        ...base,
        catalogueRef: '11.03',
        unit: 'm²',
        formulaText: 'Gross internal floor area',
        compositeRate: 1.59,
      },
      { programmeWeeks: null, gfaM2: 1200, contractValue: null },
    )
    expect(gifa.eligible).toBe(true)
    expect(gifa.proposedQty).toBe(1200)

    const storage = evaluatePrelimLine(
      {
        ...base,
        unit: 'm2',
        formulaText: 'Measured storage area',
      },
      { programmeWeeks: null, gfaM2: 1200, contractValue: null },
    )
    expect(storage.skipReason).toBe('SITE_AREA_NOT_GFA')
  })

  it('rejects % rates that are not decimal fractions', () => {
    const row = evaluatePrelimLine(
      {
        ...base,
        unit: '%',
        formulaText: '% of contract value',
        compositeRate: 10.11,
      },
      { programmeWeeks: null, gfaM2: null, contractValue: 1_000_000 },
    )
    expect(row.eligible).toBe(false)
    expect(row.skipReason).toBe('RATE_INVALID')
  })

  it('applies contract % when rate is a fraction', () => {
    const row = evaluatePrelimLine(
      {
        ...base,
        unit: '%',
        formulaText: '% of contract value',
        compositeRate: 0.05,
      },
      { programmeWeeks: null, gfaM2: null, contractValue: 1_000_000 },
    )
    expect(row.eligible).toBe(true)
    expect(row.proposedQty).toBe(1_000_000)
    expect(row.proposedAmount).toBe(50000)
  })

  it('never overwrites TAKEOFF rows', () => {
    const row = evaluatePrelimLine(
      {
        ...base,
        unit: 'wk',
        formulaText: 'Weeks',
        quantityMode: 'TAKEOFF',
      },
      { programmeWeeks: 12, gfaM2: null, contractValue: null },
    )
    expect(row.skipReason).toBe('TAKEOFF')
  })

  it('normalizes 0 to null', () => {
    expect(positiveOrNull(0)).toBeNull()
    expect(positiveOrNull(12.5)).toBe(12.5)
    expect(normalizePrelimUnit('m²')).toBe('m2')
  })
})

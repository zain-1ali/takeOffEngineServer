import fs from 'fs'
import path from 'path'
import { CORE_QTY_BINDINGS } from '../../reports/boqCatalogue/types'
import { EXISTING_ENGINE_KEY_SET } from '../existingEngines'
import { parseIssueTrackerWorkbook } from '../parseIssueTrackerWorkbook'
import { resolveDefaultBoqPackSeedPath } from '../seedPath'

const CLIENT_XLSX = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Downloads',
  'PROJECT  ISSUE TRACKER.xlsx',
)
const workbookPath = fs.existsSync(CLIENT_XLSX)
  ? CLIENT_XLSX
  : resolveDefaultBoqPackSeedPath()
const describeIf = workbookPath ? describe : describe.skip

describeIf('parseIssueTrackerWorkbook', () => {
  const pack = parseIssueTrackerWorkbook(
    fs.readFileSync(workbookPath as string),
    path.basename(workbookPath as string),
  )

  it('parses required modules without Module 14', () => {
    expect(pack.errors).toEqual([])
    expect(pack.pricing.currency).toBe('USD')
    const nos = pack.modules.map((m) => m.moduleNo)
    expect(nos).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17])
    expect(nos).not.toContain(14)
  })

  it('reads about 1,108 BOQ lines and 124 elements', () => {
    expect(pack.items.length).toBeGreaterThanOrEqual(1100)
    expect(pack.items.length).toBeLessThanOrEqual(1120)
    expect(pack.elements.length).toBeGreaterThanOrEqual(110)
    expect(pack.elements.length).toBeLessThanOrEqual(140)
  })

  it('maps structure headings to existing engines (never catalogue stubs)', () => {
    const pad = pack.elements.find((e) => /pad foundation/i.test(e.label))
    expect(pad?.bindingKind).toBe('ENGINE')
    expect(pad?.elementKey).toBe('PAD_FOOTING')
    expect(EXISTING_ENGINE_KEY_SET.has(pad!.elementKey)).toBe(true)

    const prelim = pack.elements.find((e) => e.moduleNo === 0)
    expect(prelim?.bindingKind).toBe('CATALOGUE')
    expect(prelim?.scope).toBe('PROJECT')
    expect(prelim?.elementKey.startsWith('CAT_')).toBe(true)
  })

  it('keeps refs as text (1.1 ≠ 1.10) and attaches rates by lineKey', () => {
    const keys = pack.items.map((i) => i.lineKey)
    expect(keys.some((k) => k.includes(':1.1'))).toBe(true)
    const byKey = new Map(pack.rates.map((r) => [r.lineKey, r]))
    const withRate = pack.items.filter((i) => byKey.get(i.lineKey)?.compositeRate)
    expect(withRate.length).toBeGreaterThan(1000)
  })

  it('loads prices databank resources', () => {
    expect(pack.resources.length).toBeGreaterThan(200)
    expect(pack.analysisCount).toBeGreaterThan(1000)
    expect(pack.analyses.length).toBe(pack.analysisCount)
    const padConcrete = pack.analyses.find((a) => a.lineKey === 'M01:1.07')
    expect(padConcrete).toBeTruthy()
    expect(padConcrete!.lines.length).toBeGreaterThan(0)
    expect(padConcrete!.allowances.overheadPct).toBeCloseTo(0.1)
    expect(padConcrete!.allowances.profitPct).toBeCloseTo(0.1)
    const prelim = pack.analyses.find((a) => a.lineKey === 'M00:1.01')
    expect(prelim?.allowances.transportPctMaterials).toBeCloseTo(0.05)
    expect(prelim?.allowances.sundriesPctLabourPlantSubcontract).toBeCloseTo(
      0.025,
    )
  })

  it('keeps CORE_QTY_BINDINGS refs on mapped engines (pad 1.06/1.07/1.08 and M2 finishes)', () => {
    const refsByElement = new Map()
    for (let i = 0; i < pack.items.length; i++) {
      const it = pack.items[i]
      let set = refsByElement.get(it.elementKey)
      if (!set) {
        set = new Set()
        refsByElement.set(it.elementKey, set)
      }
      set.add(it.ref)
    }

    const padRefs = refsByElement.get('PAD_FOOTING')
    expect(padRefs.has('1.06')).toBe(true)
    expect(padRefs.has('1.07')).toBe(true)
    expect(padRefs.has('1.08')).toBe(true)

    const keys = Object.keys(CORE_QTY_BINDINGS)
    for (let i = 0; i < keys.length; i++) {
      const elementKey = keys[i]
      const bindings = CORE_QTY_BINDINGS[elementKey]
      const refs = refsByElement.get(elementKey)
      expect(refs).toBeTruthy()
      const roles = Object.keys(bindings)
      for (let j = 0; j < roles.length; j++) {
        const ref = bindings[roles[j]]
        if (ref) expect(refs.has(ref)).toBe(true)
      }
    }

    const floor = pack.elements.find((e) => e.elementKey === 'FLOOR_FINISH')
    expect(floor?.bindingKind).toBe('ENGINE')
    expect(refsByElement.get('FLOOR_FINISH').has('16.12')).toBe(true)
  })
})

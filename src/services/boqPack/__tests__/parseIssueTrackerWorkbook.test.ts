import fs from 'fs'
import path from 'path'
import type { IProject } from '../../../models/Project'
import {
  DEFAULT_MATERIALS,
  DEFAULT_RATE_LIB,
} from '../../../defaults/projectDefaults'
import { buildCostPlan } from '../../costPlan/buildCostPlan'
import { resolveUniformatCode } from '../../costPlan/uniformat'
import { CORE_QTY_BINDINGS } from '../../reports/boqCatalogue/types'
import type { SelectedBoqReportItem } from '../../selectedBoq'
import { EXISTING_ENGINE_KEY_SET } from '../existingEngines'
import {
  bindingNeedsReview,
  buildPackMatchIndexes,
  findPackMatch,
} from '../packSelection'
import { parseIssueTrackerWorkbook } from '../parseIssueTrackerWorkbook'
import { resolveDefaultBoqPackSeedPath } from '../seedPath'
import { visibleSchemaForLines } from '../../takeoffInputs/schemas'

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

  it('gives every active pack line a Take off Input quantity path', () => {
    const unresolved = []
    const byElement = new Map()
    for (const item of pack.items) {
      const list = byElement.get(item.elementKey) || []
      list.push(item)
      byElement.set(item.elementKey, list)
    }
    for (const [elementKey, items] of byElement) {
      const engineKey = pack.elements.find((el) => el.elementKey === elementKey)
        ?.engineKey
      const visible = visibleSchemaForLines(
        elementKey,
        items.map((item) => ({
          lineKey: item.lineKey,
          catalogueRef: item.ref,
          description: item.description,
          unit: item.unit,
          quantityBasis: item.quantityBasis,
          workCategory: item.workCategory,
        })),
        engineKey,
      )
      for (const item of items) {
        if (!visible.recipes[item.ref] && !visible.recipes[item.lineKey]) {
          unresolved.push(`${elementKey}:${item.ref}`)
        }
      }
    }
    expect(unresolved).toEqual([])
  })

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
    expect(pack.elements).toHaveLength(124)
    expect(new Set(pack.elements.map((e) => e.elementKey)).size).toBe(124)
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

  it('keeps Roof Slab and Soil/Waste as distinct report headings', () => {
    const roof = pack.elements.find((e) => /^roof slab$/i.test(e.label))
    const slabs = pack.elements.find((e) => /^slabs$/i.test(e.label))
    const ducts = pack.elements.find((e) => /ductwork systems/i.test(e.label))
    const soilWaste = pack.elements.find((e) => /soil.*waste.*pipework/i.test(e.label))

    expect(roof?.elementKey).toBe('CAT_M01_E014')
    expect(roof?.elementKey).not.toBe('SLABS')
    expect(roof?.engineKey).toBe('SLABS')
    expect(slabs?.elementKey).toBe('SLABS')
    expect(ducts?.elementKey).toBe('DUCTS')
    expect(soilWaste?.elementKey).toBe('CAT_M03_E020')
  })

  it('classifies known client lines without unit-based false positives', () => {
    const byLineKey = new Map(pack.items.map((item) => [item.lineKey, item]))
    expect(byLineKey.get('M01:14.06')?.workCategory).toBe('Waterproofing')
    expect(byLineKey.get('M01:14.06')?.workCategory).not.toBe('Formwork')
    expect(byLineKey.get('M01:3.01')?.workCategory).toBe('Earthworks')
    expect(byLineKey.get('M01:3.01')?.workCategory).not.toBe('Masonry')
    expect(['Ceiling Finishes', 'Finishes']).toContain(
      byLineKey.get('M02:18.01')?.workCategory,
    )
    expect(byLineKey.get('M02:18.01')?.workCategory).not.toBe('Tiling')
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
    const engineByElement = new Map(
      pack.elements.map((element) => [
        element.elementKey,
        element.engineKey || element.elementKey,
      ]),
    )
    for (let i = 0; i < pack.items.length; i++) {
      const it = pack.items[i]
      const qtyKey = engineByElement.get(it.elementKey) || it.elementKey
      let set = refsByElement.get(qtyKey)
      if (!set) {
        set = new Set()
        refsByElement.set(qtyKey, set)
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

  it('maps workbook modules and Roof Slab into Cost Plan headings', () => {
    const prelim = pack.elements.find((e) => e.moduleNo === 0)!
    const plumbing = pack.elements.find((e) => e.moduleNo === 3)!
    const roof = pack.elements.find((e) => /^roof slab$/i.test(e.label))!

    expect(
      resolveUniformatCode(prelim.elementKey, {
        moduleNo: prelim.moduleNo,
        headingLabel: prelim.label,
      }).code,
    ).toBe('P10')
    expect(
      resolveUniformatCode(plumbing.elementKey, {
        moduleNo: plumbing.moduleNo,
        headingLabel: plumbing.label,
      }).code,
    ).toBe('D20')

    const chosen = [prelim, plumbing, roof]
    const packElementMeta = Object.fromEntries(
      chosen.map((element) => [
        element.elementKey,
        {
          label: element.label,
          moduleNo: element.moduleNo,
          sortOrder: element.sortOrder,
          bindingKind: element.bindingKind,
          engineKey: element.engineKey,
          scope: element.scope,
        },
      ]),
    )
    const selectedBoqItems = chosen.map((element, index) => {
      const item = pack.items.find((candidate) => candidate.elementKey === element.elementKey)!
      return {
        id: `selected-${index}`,
        floorId: 'GF',
        elementKey: item.elementKey,
        catalogueRef: item.ref,
        description: item.description,
        unit: item.unit,
        workCategory: item.workCategory,
        quantity: 1,
        lineKey: item.lineKey,
        moduleNo: item.moduleNo,
      }
    }) as SelectedBoqReportItem[]
    const packRatesByLineKey = Object.fromEntries(
      selectedBoqItems.map((item) => [item.lineKey!, 1]),
    )
    const project = {
      currency: 'USD',
      useRateAnalysis: false,
      materials: DEFAULT_MATERIALS,
      rateLib: DEFAULT_RATE_LIB,
    } as IProject
    const costPlan = buildCostPlan(project, [], {
      scope: 'project',
      hasActivePack: true,
      packElementMeta,
      packRatesByLineKey,
      selectedBoqItems,
    })

    expect(costPlan.groups.find((g) => g.id === prelim.elementKey)?.uniformatCodes).toContain('P10')
    expect(costPlan.groups.find((g) => g.id === plumbing.elementKey)?.uniformatCodes).toContain('D20')
    expect(costPlan.groups.find((g) => g.id === roof.elementKey)?.heading).toContain('Roof Slab')
    expect(costPlan.groups.find((g) => g.id === roof.elementKey)?.uniformatCodes).toContain('B1020')
  })

  it('reconciles an existing Slabs roof line by lineKey without review', () => {
    const roofItem = pack.items.find((item) => item.lineKey === 'M01:14.01')!
    const matchItem = {
      _id: 'roof-pack-item',
      ...roofItem,
      scope: 'FLOOR' as const,
    }
    const selected = {
      catalogueRef: '14.01',
      elementKey: 'SLABS',
      unit: roofItem.unit,
      lineKey: 'M01:14.01',
      moduleNo: 1,
      scope: 'FLOOR' as const,
      floorId: 'ROOF',
    }
    const match = findPackMatch(
      selected,
      buildPackMatchIndexes([matchItem]),
    )

    expect(match?.elementKey).toBe('CAT_M01_E014')
    expect(bindingNeedsReview(selected, match!)).toBe(false)
    expect(selected.lineKey).toBe('M01:14.01')
  })
})

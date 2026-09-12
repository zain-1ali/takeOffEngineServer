import fs from 'fs'
import path from 'path'
import { parseIssueTrackerWorkbook } from '../../boqPack/parseIssueTrackerWorkbook'
import { applyPackAnalysisToBomLabour } from '../applyPackAnalysisToBomLabour'
import type { ElementReportBundle } from '../types'

const CLIENT_XLSX = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Downloads',
  'PROJECT  ISSUE TRACKER.xlsx',
)

function emptyBundle(
  partial: Partial<ElementReportBundle> = {},
): ElementReportBundle {
  return {
    elementKey: 'CAT_M08_E001',
    num: 8001,
    suffix: '',
    label: 'Decorative Finishes & Painting',
    kind: 'finish',
    units: 0,
    boq: [],
    bom: [],
    labour: { activities: [], trades: [], totalManDays: 0, totalCost: 0 },
    summary: {},
    cost: { boq: 0, bom: 0, labour: 0 },
    ...partial,
  }
}

describe('applyPackAnalysisToBomLabour', () => {
  const resourcesByCode = {
    'MAT-1': {
      code: 'MAT-1',
      category: 'MAT',
      description: 'Emulsion paint',
      unit: 'L',
      unitRate: 10,
      wastePct: 0.1,
    },
    'LAB-1': {
      code: 'LAB-1',
      category: 'LAB',
      description: 'Painter',
      unit: 'md',
      unitRate: 20,
      wastePct: 0,
    },
  }

  it('builds catalogue BOM and labour from rate analysis resources', () => {
    const out = applyPackAnalysisToBomLabour(
      [
        emptyBundle({
          boq: [
            {
              kind: 'item',
              ref: '8.01',
              description: 'Internal emulsion',
              qty: 2,
              unit: 'm2',
              lineKey: 'M08:8.01',
              source: 'CATALOGUE',
            },
          ],
        }),
      ],
      {
        analysesByLineKey: {
          'M08:8.01': {
            lines: [
              { sourceCode: 'MAT-1', quantity: 0.2 },
              { sourceCode: 'LAB-1', quantity: 0.05 },
            ],
          },
        },
        resourcesByCode,
      },
    )

    const paint = out[0].bom.find(
      (l) => l.kind === 'item' && /Emulsion/.test(l.description || ''),
    )
    expect(paint?.qty).toBeCloseTo(0.44)
    expect(paint?.amount).toBeCloseTo(4.4)
    expect(out[0].labour.activities.some((a) => /Painter/.test(a.activity))).toBe(
      true,
    )
    expect(out[0].labour.totalManDays).toBeCloseTo(0.1)
    expect(out[0].labour.totalCost).toBeCloseTo(2)
    expect(out[0].cost.bom).toBeCloseTo(4.4)
  })

  it('does not replace engine-built BOM or labour', () => {
    const out = applyPackAnalysisToBomLabour(
      [
        emptyBundle({
          kind: 'structural',
          elementKey: 'PAD_FOOTING',
          boq: [
            {
              kind: 'item',
              ref: '1.01',
              description: 'Concrete',
              qty: 1,
              unit: 'm3',
              lineKey: 'M01:1.01',
              source: 'CATALOGUE',
            },
          ],
          bom: [
            {
              kind: 'item',
              description: 'Schedule cement',
              qty: 7,
              unit: 'bags',
              source: 'MODELLED',
            },
          ],
          labour: {
            activities: [
              {
                ref: 'L1',
                activity: 'Schedule pour',
                qty: 1,
                unit: 'm3',
                outputRate: '1',
                gang: 'Gang',
                days: 1,
              },
            ],
            trades: [],
            totalManDays: 1,
            totalCost: 10,
          },
        }),
      ],
      {
        analysesByLineKey: {
          'M01:1.01': { lines: [{ sourceCode: 'MAT-1', quantity: 1 }] },
        },
        resourcesByCode,
      },
    )
    expect(out[0].bom[0].description).toBe('Schedule cement')
    expect(out[0].labour.activities[0].activity).toBe('Schedule pour')
  })

  const describeClient = fs.existsSync(CLIENT_XLSX) ? it : it.skip
  describeClient(
    'builds Decorative Finishes BOM/labour from the client Issue Tracker',
    () => {
      const pack = parseIssueTrackerWorkbook(
        fs.readFileSync(CLIENT_XLSX),
        path.basename(CLIENT_XLSX),
      )
      expect(pack.errors).toEqual([])
      const resourcesByCode = {}
      for (let i = 0; i < pack.resources.length; i++) {
        const r = pack.resources[i]
        resourcesByCode[r.code] = r
      }
      const analysesByLineKey = {}
      for (let i = 0; i < pack.analyses.length; i++) {
        const a = pack.analyses[i]
        analysesByLineKey[a.lineKey] = {
          lines: a.lines,
          allowances: a.allowances,
        }
      }
      const paint = pack.items.find((it) => it.lineKey === 'M17:110.01')
      expect(paint).toBeTruthy()
      const out = applyPackAnalysisToBomLabour(
        [
          emptyBundle({
            elementKey: 'CAT_M17_E110',
            label: 'Decorative Finishes & Painting',
            boq: [
              {
                kind: 'item',
                ref: paint!.ref,
                description: paint!.description,
                qty: 10,
                unit: paint!.unit,
                lineKey: paint!.lineKey,
                source: 'CATALOGUE',
              },
            ],
          }),
        ],
        { analysesByLineKey, resourcesByCode },
      )
      expect(out[0].bom.some((l) => l.kind === 'item')).toBe(true)
      expect(out[0].labour.activities.length).toBeGreaterThan(0)
      expect(out[0].labour.totalManDays).toBeGreaterThan(0)
    },
  )
})

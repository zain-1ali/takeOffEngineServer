import {
  emptyElementBundle,
  mergeSelectedBoqIntoByElement,
} from '../mergeSelectedBoq'
import { rateKeyForBoqLine } from '../boqCatalogue/rateKeyForLine'
import type { SelectedBoqReportItem } from '../../selectedBoq'

function sel(
  partial: Partial<SelectedBoqReportItem> & Pick<SelectedBoqReportItem, 'id' | 'elementKey' | 'catalogueRef'>,
): SelectedBoqReportItem {
  return {
    floorId: 'F1',
    description: partial.description || 'Line',
    unit: partial.unit || 'm3',
    quantity: 0,
    ...partial,
  }
}

describe('emptyElementBundle', () => {
  it('builds a catalogue shell for CAT_* keys', () => {
    const shell = emptyElementBundle('CAT_M00_E001', {
      CAT_M00_E001: {
        label: "Employer's Requirements",
        moduleNo: 0,
        sortOrder: 1,
        bindingKind: 'CATALOGUE',
        scope: 'PROJECT',
      },
    })
    expect(shell?.elementKey).toBe('CAT_M00_E001')
    expect(shell?.label).toBe("Employer's Requirements")
    expect(shell?.kind).toBe('finish')
  })

  it('still returns engine meta for PAD_FOOTING', () => {
    expect(emptyElementBundle('PAD_FOOTING')?.num).toBe(1)
  })
})

describe('mergeSelectedBoqIntoByElement pack rates', () => {
  const rates = {
    boqRate: () => 99,
    matRate: () => 0,
    labRate: () => 0,
  }

  it('resolves Roof Slab fallback rates through its SLABS engine', () => {
    expect(
      rateKeyForBoqLine({
        elementKey: 'CAT_M01_E014',
        engineKey: 'SLABS',
        headingLabel: 'Roof Slab',
        catalogueRef: '14.02',
        unit: 'm³',
      }),
    ).toBe('concrete')
    expect(
      rateKeyForBoqLine({
        elementKey: 'CAT_M01_E014',
        engineKey: 'SLABS',
        headingLabel: 'Roof Slab',
        catalogueRef: '11.03',
        unit: 'm³',
      }),
    ).toBeNull()
  })

  it('returns the Roof Slab heading bundle, not the linked SLABS engine shell', () => {
    const out = mergeSelectedBoqIntoByElement(
      [
        {
          elementKey: 'SLABS',
          num: 10,
          suffix: '',
          label: 'Slabs',
          kind: 'structural',
          engineKey: 'SLABS',
          units: 1,
          boq: [],
          bom: [],
          labour: { activities: [], trades: [], totalManDays: 0, totalCost: 0 },
          summary: { concrete: 4.8, formwork: 28, steel: 208.9 },
          cost: { boq: 0, bom: 0, labour: 0 },
        },
      ],
      [
        sel({
          id: 'r',
          floorId: 'RF',
          elementKey: 'CAT_M01_E014',
          catalogueRef: '14.02',
          lineKey: 'M01:14.02',
          moduleNo: 1,
          description: 'Roof slab concrete',
          unit: 'm³',
          quantity: 0,
          workCategory: 'Concrete',
        }),
      ],
      {
        floorId: 'RF',
        elementKey: 'CAT_M01_E014',
        rates,
        hasActivePack: true,
        packRatesByLineKey: { 'M01:14.02': 17.91 },
        packElementMeta: {
          CAT_M01_E014: {
            label: 'Roof Slab',
            moduleNo: 1,
            sortOrder: 14,
            bindingKind: 'ENGINE',
            engineKey: 'SLABS',
            scope: 'FLOOR',
          },
        },
        floorLevelTypesByElement: {
          SLABS: ['Roof'],
          CAT_M01_E014: ['Roof'],
        },
      },
    )
    expect(out).toHaveLength(1)
    expect(out[0].elementKey).toBe('CAT_M01_E014')
    expect(out[0].label).toBe('Roof Slab')
    const item = out[0].boq.find((l) => l.kind === 'item')
    expect(item?.ref).toBe('14.02')
    expect(item?.qty).toBe(4.8)
    expect(item?.suggestedQty).toBe(4.8)
    expect(item?.qtySource).toBe('engine')
    expect(item?.rate).toBe(17.91)
  })

  it('prices pack lines from compositeRate, not rateLib', () => {
    const out = mergeSelectedBoqIntoByElement(
      [],
      [
        sel({
          id: '1',
          elementKey: 'PAD_FOOTING',
          catalogueRef: '1.01',
          lineKey: 'M01:1.01',
          quantity: 2,
        }),
      ],
      {
        rates,
        hasActivePack: true,
        packRatesByLineKey: { 'M01:1.01': 10.5 },
      },
    )
    const item = out[0].boq.find((l) => l.kind === 'item')
    expect(item?.rate).toBe(10.5)
    expect(item?.amount).toBe(21)
    expect(item?.lineKey).toBe('M01:1.01')
  })

  it('drops ORPHANED lines and excludes NEEDS_REVIEW from totals', () => {
    const out = mergeSelectedBoqIntoByElement(
      [],
      [
        sel({
          id: 'a',
          elementKey: 'CAT_M00_E001',
          catalogueRef: '0.01',
          lineKey: 'M00:0.01',
          quantity: 1,
          reconciliationStatus: 'ORPHANED',
        }),
        sel({
          id: 'b',
          elementKey: 'CAT_M00_E001',
          catalogueRef: '0.02',
          lineKey: 'M00:0.02',
          quantity: 1,
          reconciliationStatus: 'NEEDS_REVIEW',
        }),
        sel({
          id: 'c',
          elementKey: 'CAT_M00_E001',
          catalogueRef: '0.03',
          lineKey: 'M00:0.03',
          quantity: 1,
          reconciliationStatus: 'ACTIVE',
        }),
      ],
      {
        hasActivePack: true,
        packRatesByLineKey: {
          'M00:0.02': 50,
          'M00:0.03': 50,
        },
        packElementMeta: {
          CAT_M00_E001: {
            label: 'Prelims',
            moduleNo: 0,
            sortOrder: 1,
            bindingKind: 'CATALOGUE',
            scope: 'PROJECT',
          },
        },
      },
    )
    const items = out[0].boq.filter((l) => l.kind === 'item')
    expect(items.map((l) => l.ref)).toEqual(['0.02', '0.03'])
    expect(items.find((l) => l.ref === '0.02')?.amount).toBeNull()
    expect(out[0].cost.boq).toBe(50)
  })

  it('overlays pack rates on pad CORE bindings without dropping suggestedQty or double-counting engine BOQ', () => {
    const out = mergeSelectedBoqIntoByElement(
      [
        {
          elementKey: 'PAD_FOOTING',
          num: 1,
          suffix: '',
          label: 'Pad Foundation',
          kind: 'structural',
          units: 2,
          boq: [
            {
              kind: 'item',
              ref: 'A',
              description: 'Engine concrete',
              qty: 4.2,
              unit: 'm³',
              rate: 99,
              amount: 415.8,
              source: 'MODELLED',
            },
          ],
          bom: [],
          labour: { activities: [], trades: [], totalManDays: 0, totalCost: 0 },
          summary: { concrete: 4.2, formwork: 18.5, steel: 210 },
          cost: { boq: 415.8, bom: 0, labour: 0 },
        },
      ],
      [
        sel({
          id: 'c',
          elementKey: 'PAD_FOOTING',
          catalogueRef: '1.07',
          lineKey: 'M01:1.07',
          moduleNo: 1,
          description: 'Concrete pads',
          unit: 'm³',
          quantity: 4.2,
          workCategory: 'Concrete',
        }),
        sel({
          id: 'f',
          elementKey: 'PAD_FOOTING',
          catalogueRef: '1.08',
          lineKey: 'M01:1.08',
          moduleNo: 1,
          description: 'Formwork to pads',
          unit: 'm²',
          quantity: 18.5,
          workCategory: 'Formwork',
        }),
        sel({
          id: 's',
          elementKey: 'PAD_FOOTING',
          catalogueRef: '1.06',
          lineKey: 'M01:1.06',
          moduleNo: 1,
          description: 'Rebar',
          unit: 't',
          quantity: 0.21,
          workCategory: 'Reinforcement',
        }),
      ],
      {
        rates,
        hasActivePack: true,
        packRatesByLineKey: {
          'M01:1.06': 1200,
          'M01:1.07': 185.5,
          'M01:1.08': 42,
        },
      },
    )

    const items = out[0].boq.filter((l) => l.kind === 'item')
    expect(items.map((l) => l.ref)).toEqual(['1.06', '1.07', '1.08'])
    expect(items.some((l) => l.ref === 'A')).toBe(false)

    const concrete = items.find((l) => l.ref === '1.07')
    expect(concrete?.qty).toBe(4.2)
    expect(concrete?.suggestedQty).toBe(4.2)
    expect(concrete?.qtySource).toBe('engine')
    expect(concrete?.rate).toBe(185.5)
    expect(concrete?.amount).toBeCloseTo(4.2 * 185.5)

    const formwork = items.find((l) => l.ref === '1.08')
    expect(formwork?.suggestedQty).toBe(18.5)
    expect(formwork?.qtySource).toBe('engine')
    expect(formwork?.rate).toBe(42)

    const rebar = items.find((l) => l.ref === '1.06')
    expect(rebar?.suggestedQty).toBe(0.21)
    expect(rebar?.qtySource).toBe('engine')
    expect(rebar?.rate).toBe(1200)
  })

  it('keeps TYPED qty instead of the live engine qty', () => {
    const out = mergeSelectedBoqIntoByElement(
      [
        {
          elementKey: 'PAD_FOOTING',
          num: 1,
          suffix: '',
          label: 'Pad Foundation',
          kind: 'structural',
          units: 1,
          boq: [],
          bom: [],
          labour: { activities: [], trades: [], totalManDays: 0, totalCost: 0 },
          summary: { concrete: 4.8 },
          cost: { boq: 0, bom: 0, labour: 0 },
        },
      ],
      [
        sel({
          id: 'c',
          elementKey: 'PAD_FOOTING',
          catalogueRef: '1.07',
          quantity: 1,
          quantityMode: 'TYPED',
        }),
      ],
    )
    const item = out[0].boq.find((l) => l.kind === 'item')
    expect(item?.qty).toBe(1)
    expect(item?.suggestedQty).toBe(4.8)
    expect(item?.qtySource).toBe('typed')
  })

  it('keeps TAKEOFF qty instead of the live engine qty', () => {
    const out = mergeSelectedBoqIntoByElement(
      [
        {
          elementKey: 'PAD_FOOTING',
          num: 1,
          suffix: '',
          label: 'Pad Foundation',
          kind: 'structural',
          units: 1,
          boq: [],
          bom: [],
          labour: { activities: [], trades: [], totalManDays: 0, totalCost: 0 },
          summary: { concrete: 4.8 },
          cost: { boq: 0, bom: 0, labour: 0 },
        },
      ],
      [
        sel({
          id: 'c',
          elementKey: 'PAD_FOOTING',
          catalogueRef: '1.07',
          quantity: 2.2,
          quantityMode: 'TAKEOFF',
          takeoffKind: 'dim',
        }),
      ],
    )
    const item = out[0].boq.find((l) => l.kind === 'item')
    expect(item?.qty).toBe(2.2)
    expect(item?.qtySource).toBe('takeoff')
  })

  it('leaves unbound catalogue qty at the stored number', () => {
    const out = mergeSelectedBoqIntoByElement(
      [
        {
          elementKey: 'PAD_FOOTING',
          num: 1,
          suffix: '',
          label: 'Pad Foundation',
          kind: 'structural',
          units: 1,
          boq: [],
          bom: [],
          labour: { activities: [], trades: [], totalManDays: 0, totalCost: 0 },
          summary: { concrete: 4.8 },
          cost: { boq: 0, bom: 0, labour: 0 },
        },
      ],
      [
        sel({
          id: 'w',
          elementKey: 'PAD_FOOTING',
          catalogueRef: '1.09',
          quantity: 0,
        }),
      ],
    )
    const item = out[0].boq.find((l) => l.kind === 'item')
    expect(item?.qty).toBe(0)
    expect(item?.suggestedQty).toBeUndefined()
    expect(item?.qtySource).toBe('stored')
  })

  it('does not use rateLib heuristics for M2 finishes when the pack is active', () => {
    const out = mergeSelectedBoqIntoByElement(
      [
        {
          elementKey: 'FLOOR_FINISH',
          num: 16,
          suffix: '',
          label: 'Floor Finishes',
          kind: 'finish',
          units: 1,
          boq: [
            {
              kind: 'item',
              ref: 'FF',
              description: 'Engine floor area',
              qty: 80,
              unit: 'm²',
              rate: 99,
              amount: 7920,
              source: 'MODELLED',
            },
          ],
          bom: [],
          labour: { activities: [], trades: [], totalManDays: 0, totalCost: 0 },
          summary: { area: 80 },
          cost: { boq: 7920, bom: 0, labour: 0 },
        },
      ],
      [
        sel({
          id: 'ff',
          elementKey: 'FLOOR_FINISH',
          catalogueRef: '16.12',
          moduleNo: 2,
          description: 'Ceramic floor tiles',
          unit: 'm2',
          quantity: 80,
          workCategory: 'Floor Finishes',
        }),
      ],
      {
        rates,
        hasActivePack: true,
        packRatesByLineKey: { 'M02:16.12': 55.25 },
      },
    )
    const item = out[0].boq.find((l) => l.kind === 'item')
    expect(item?.ref).toBe('16.12')
    expect(item?.rate).toBe(55.25)
    expect(item?.amount).toBe(80 * 55.25)
    expect(out[0].boq.some((l) => l.ref === 'FF')).toBe(false)
  })

  it('leaves pack line rate null when the Rates Schedule has no match', () => {
    const out = mergeSelectedBoqIntoByElement(
      [],
      [
        sel({
          id: '1',
          elementKey: 'PAD_FOOTING',
          catalogueRef: '1.07',
          lineKey: 'M01:1.07',
          moduleNo: 1,
          quantity: 2,
        }),
      ],
      {
        rates,
        hasActivePack: true,
        packRatesByLineKey: {},
      },
    )
    const item = out[0].boq.find((l) => l.kind === 'item')
    expect(item?.rate).toBeNull()
    expect(item?.amount).toBeNull()
  })

  it('keeps project-wide pack lines when filtering to a floor', () => {
    const out = mergeSelectedBoqIntoByElement(
      [],
      [
        sel({
          id: 'p',
          floorId: '__PROJECT__',
          scope: 'PROJECT',
          elementKey: 'CAT_M00_E001',
          catalogueRef: '0.01',
          lineKey: 'M00:0.01',
          quantity: 1,
        }),
        sel({
          id: 'other',
          floorId: 'F2',
          elementKey: 'PAD_FOOTING',
          catalogueRef: '1.01',
          lineKey: 'M01:1.01',
          quantity: 4,
        }),
      ],
      {
        floorId: 'F1',
        rates,
        hasActivePack: true,
        packRatesByLineKey: { 'M00:0.01': 12, 'M01:1.01': 10 },
        packElementMeta: {
          CAT_M00_E001: {
            label: "Employer's Requirements",
            moduleNo: 0,
            sortOrder: 1,
            bindingKind: 'CATALOGUE',
            scope: 'PROJECT',
          },
        },
      },
    )
    const refs = out.flatMap((be) =>
      be.boq.filter((l) => l.kind === 'item').map((l) => l.ref),
    )
    expect(refs).toContain('0.01')
    expect(refs).not.toContain('1.01')
  })
})

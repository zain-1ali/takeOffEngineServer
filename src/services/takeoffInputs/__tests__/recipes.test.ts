import { attachInputQuantities, evaluateLineInput, recipeForLine } from '..'
import { EXISTING_ENGINE_KEYS } from '../../boqPack/existingEngines'
import { billedQty } from '../../reports/billedQty'
import type { SelectedBoqReportItem } from '../../selectedBoq'
import { buildHeadingContext } from '../context'
import {
  ELEMENT_SCHEMAS,
  evaluateRecipe,
  recipeForRef,
  visibleSchemaForLines,
} from '../schemas'

describe('Take off Input quantity recipes', () => {
  it.each([
    ['nr', 'count'],
    ['m', 'length'],
    ['m²', 'area'],
    ['m³', 'volume'],
    ['kg', 'weight'],
    ['day', 'time'],
    ['%', 'percent'],
    ['sum', 'direct'],
  ])('always provides a safe recipe for %s', (unit, method) => {
    expect(recipeForLine({ unit }).method).toBe(method)
  })

  it('calculates leftover lineInputs volume with waste', () => {
    expect(
      evaluateLineInput({
        recipe: recipeForLine({ unit: 'm³' }),
        input: {
          method: 'volume',
          count: 2,
          length: 4,
          width: 3,
          depth: 1.5,
          wastePct: 10,
        },
      }),
    ).toEqual({ quantity: 39.6, source: 'input', method: 'volume' })
  })

  it('quantifies pad excavation, cart-away, backfill and blinding from shared drivers', () => {
    const instances = [
      {
        floorId: 'GF',
        elementKey: 'PAD_FOOTING',
        count: 2,
        geometry: { length: 4, width: 3, baseThickness: 0.5 },
      },
    ]
    const ctx = buildHeadingContext('PAD_FOOTING', instances, {
      excavationDepthM: 1.5,
      workingSpaceM: 0.5,
      reusePct: 20,
      importedFillM3: 1,
      blindingThicknessM: 0.05,
      blindingProjectionM: 0,
    })
    expect(ctx.excavationM3).toBeCloseTo(2 * 5 * 4 * 1.5)

    const excav = evaluateRecipe(recipeForRef('PAD_FOOTING', '1.01')!, ctx, ctx.shared)
    const cart = evaluateRecipe(recipeForRef('PAD_FOOTING', '1.02')!, ctx, ctx.shared)
    const backfill = evaluateRecipe(recipeForRef('PAD_FOOTING', '1.03')!, ctx, ctx.shared)
    const imported = evaluateRecipe(recipeForRef('PAD_FOOTING', '1.04')!, ctx, ctx.shared)
    const blinding = evaluateRecipe(recipeForRef('PAD_FOOTING', '1.05')!, ctx, ctx.shared)
    expect(excav?.quantity).toBeCloseTo(60)
    expect(cart?.quantity).toBeCloseTo(48)
    expect(imported?.quantity).toBe(1)
    expect(backfill?.quantity).toBeGreaterThan(0)
    expect(blinding?.quantity).toBeCloseTo(24 * 0.05)
  })

  it('zeros waterproofing when the switch is off', () => {
    const ctx = buildHeadingContext(
      'PAD_FOOTING',
      [{ count: 1, geometry: { length: 2, width: 2, baseThickness: 0.5 } }],
      { includeWaterproofing: false, turnUpHeightM: 0.15 },
    )
    expect(evaluateRecipe(recipeForRef('PAD_FOOTING', '1.09')!, ctx, ctx.shared)?.quantity).toBe(0)
  })

  it('covers every catalogue line with engine, formula, conditional, or direct path', () => {
    const catalogue = require('../../reports/boqCatalogue/catalogue.json')
    const byElement = new Map()
    for (const item of catalogue.items) {
      const list = byElement.get(item.elementKey) || []
      list.push(item)
      byElement.set(item.elementKey, list)
    }
    const unresolved: string[] = []
    for (const [elementKey, items] of byElement) {
      const visible = visibleSchemaForLines(
        elementKey,
        items.map((item) => ({
          catalogueRef: item.ref,
          description: item.description,
          unit: item.unit,
          quantityBasis: item.quantityBasis,
          workCategory: item.workCategory,
        })),
      )
      for (const item of items) {
        if (!visible.recipes[item.ref]) unresolved.push(`${elementKey}:${item.ref}`)
      }
    }
    expect(unresolved).toEqual([])
  })

  it('attaches pad and project-scoped quantities from shared drivers', () => {
    const lines: SelectedBoqReportItem[] = [
      {
        id: 'a',
        floorId: 'GF',
        elementKey: 'PAD_FOOTING',
        catalogueRef: '1.04',
        lineKey: 'M01:1.04',
        description: 'Imported fill',
        unit: 'm³',
        quantity: 0,
      },
      {
        id: 'b',
        floorId: '__PROJECT__',
        elementKey: 'CAT_M00_E001',
        catalogueRef: '1.01',
        lineKey: 'M00:1.01',
        description: 'Mobilisation',
        unit: 'item',
        quantity: 0,
      },
    ]
    const result = attachInputQuantities(lines, [
      {
        floorId: 'GF',
        elementKey: 'PAD_FOOTING',
        shared: { importedFillM3: 4 },
        lineInputs: {},
      },
      {
        floorId: '__PROJECT__',
        elementKey: 'CAT_M00_E001',
        shared: { 'direct:M00:1.01': 1 },
        lineInputs: {},
      },
    ] as any)
    expect(result.map((line) => line.inputQuantity)).toEqual([4, 1])
  })

  it('authors a driver schema for every engine heading', () => {
    expect(Object.keys(ELEMENT_SCHEMAS).sort()).toEqual([...EXISTING_ENGINE_KEYS].sort())
  })

  it('adds extra-over excavation onto pad 1.01 and 1.02', () => {
    const ctx = buildHeadingContext(
      'PAD_FOOTING',
      [{ count: 2, geometry: { length: 4, width: 3, baseThickness: 0.5 } }],
      {
        excavationDepthM: 1.5,
        workingSpaceM: 0.5,
        includeExtraOver: true,
        extraOverM3: 5,
        reusePct: 20,
      },
    )
    expect(evaluateRecipe(recipeForRef('PAD_FOOTING', '1.01')!, ctx, ctx.shared)?.quantity).toBeCloseTo(65)
    expect(evaluateRecipe(recipeForRef('PAD_FOOTING', '1.02')!, ctx, ctx.shared)?.quantity).toBeCloseTo(52)
  })

  it('splits floor-finish area from the finish engine', () => {
    const ctx = buildHeadingContext(
      'FLOOR_FINISH',
      [{ count: 1, geometry: { roomLength: 10, roomWidth: 4 } }],
      { includePrep: true, screedThicknessM: 0.05 },
    )
    expect(ctx.area).toBeCloseTo(40)
    expect(evaluateRecipe(recipeForRef('FLOOR_FINISH', '16.12')!, ctx, ctx.shared)?.quantity).toBeCloseTo(40)
    expect(evaluateRecipe(recipeForRef('FLOOR_FINISH', '16.04')!, ctx, ctx.shared)?.quantity).toBeCloseTo(2)
  })

  it('quantifies duct length from the MEP engine', () => {
    const ctx = buildHeadingContext(
      'DUCTS',
      [{ count: 2, geometry: { length: 12, width: 0.4, height: 0.3, section: 'Rectangular' } }],
      {},
    )
    expect(ctx.length).toBeCloseTo(24)
    const visible = visibleSchemaForLines('DUCTS', [
      {
        catalogueRef: '20.01',
        description: 'Galvanised ductwork',
        unit: 'm',
        quantityBasis: 'derived',
      },
    ])
    expect(evaluateRecipe(visible.recipes['20.01'], ctx, ctx.shared)?.quantity).toBeCloseTo(24)
  })

  it('does not attach unset additional measured work', () => {
    const lines: SelectedBoqReportItem[] = [
      {
        id: 'b',
        floorId: '__PROJECT__',
        elementKey: 'CAT_M00_E001',
        catalogueRef: '1.01',
        lineKey: 'M00:1.01',
        description: 'Mobilisation',
        unit: 'item',
        quantity: 3,
      },
    ]
    const result = attachInputQuantities(lines, [
      {
        floorId: '__PROJECT__',
        elementKey: 'CAT_M00_E001',
        shared: {},
        lineInputs: {},
      },
    ] as any)
    expect(result[0].inputQuantity).toBeUndefined()
  })

  it('shares one synthesized driver for derived catalogue lines', () => {
    const visible = visibleSchemaForLines('CAT_M05_E010', [
      {
        catalogueRef: '5.01',
        lineKey: 'M05:5.01',
        description: 'Emulsion to walls',
        unit: 'm²',
        quantityBasis: 'derived',
        workCategory: 'Painting',
      },
      {
        catalogueRef: '5.02',
        lineKey: 'M05:5.02',
        description: 'Emulsion to soffits',
        unit: 'm²',
        quantityBasis: 'derived',
        workCategory: 'Painting',
      },
      {
        catalogueRef: '5.03',
        lineKey: 'M05:5.03',
        description: 'Spot prime only',
        unit: 'item',
        quantityBasis: 'independent',
        workCategory: 'Painting',
      },
    ])
    const areaFields = visible.fields.filter((field) => field.unit === 'm²')
    expect(areaFields).toHaveLength(1)
    expect(visible.recipes['5.01'].directField).toBe(visible.recipes['5.02'].directField)
    expect(visible.recipes['5.03'].directField).toBe('direct:M05:5.03')
    expect(visible.fields.some((field) => field.group === 'Additional measured work')).toBe(true)
  })

  it('leaves Module 0 wk / GFA / percent with the prelim evaluator', () => {
    const visible = visibleSchemaForLines('CAT_M00_E001', [
      {
        catalogueRef: '0.10',
        lineKey: 'M00:0.10',
        description: 'Site management',
        unit: 'wk',
        quantityBasis: 'derived',
      },
      {
        catalogueRef: '0.11',
        lineKey: 'M00:0.11',
        description: 'Insurance',
        unit: '%',
        quantityBasis: 'derived',
      },
      {
        catalogueRef: '0.12',
        lineKey: 'M00:0.12',
        description: 'Temporary office',
        unit: 'item',
        quantityBasis: 'independent',
      },
    ])
    expect(visible.recipes['0.10'].kind).toBe('engine')
    expect(visible.recipes['0.11'].kind).toBe('engine')
    expect(visible.recipes['0.12'].kind).toBe('direct')
    expect(visible.fields).toHaveLength(1)
    expect(visible.fields[0].key).toBe('direct:M00:0.12')
  })

  it('does not attach input qty for CORE engine bindings', () => {
    const result = attachInputQuantities(
      [
        {
          id: 'c',
          floorId: 'GF',
          elementKey: 'PAD_FOOTING',
          catalogueRef: '1.07',
          lineKey: 'M01:1.07',
          description: 'Concrete',
          unit: 'm³',
          quantity: 0,
        },
      ],
      [
        {
          floorId: 'GF',
          elementKey: 'PAD_FOOTING',
          shared: { excavationDepthM: 1.5 },
          lineInputs: {},
        },
      ] as any,
    )
    expect(result[0].inputQuantity).toBeUndefined()
  })

  it('keeps TYPED ahead of takeoff input quantities', () => {
    expect(
      billedQty({
        quantityMode: 'TYPED',
        storedQty: 2,
        inputQty: 8,
        engineQty: 5,
      }),
    ).toEqual({ qty: 2, source: 'typed' })
  })
})

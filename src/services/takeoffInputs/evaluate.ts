import type { ITakeoffInputSet } from '../../models/TakeoffInputSet'
import { normalizeRef } from '../reports/boqCatalogue'
import type { SelectedBoqReportItem } from '../selectedBoq'
import {
  buildHeadingContext,
  type InstanceLike,
} from './context'
import { evaluateLineInput, recipeForLine } from './recipes'
import type { EvaluatedQuantity } from './recipes'
import {
  evaluateRecipe,
  visibleSchemaForLines,
  type SelectedLineLite,
} from './schemas'

export type CalculatedQuantityMap = Record<string, EvaluatedQuantity>

export type HeadingEngineMap = Record<string, string>

const identity = (line: Pick<SelectedBoqReportItem, 'lineKey' | 'catalogueRef'>) =>
  (line.lineKey || line.catalogueRef || '').trim()

const scoped = (line: SelectedBoqReportItem, key: string) =>
  `${line.floorId}::${line.elementKey}::${key}`

function engineKeyFor(
  elementKey: string,
  engineKeyByHeading?: HeadingEngineMap,
): string {
  return (engineKeyByHeading?.[elementKey] || '').trim() || elementKey
}

export function calculateInputQuantities(
  lines: SelectedBoqReportItem[],
  sets: Array<Pick<ITakeoffInputSet, 'floorId' | 'elementKey' | 'shared' | 'lineInputs'>>,
  opts?: {
    instances?: InstanceLike[]
    engineKeyByHeading?: HeadingEngineMap
  },
): CalculatedQuantityMap {
  const result: CalculatedQuantityMap = {}
  const instances = opts?.instances || []
  const byHeading = new Map()
  for (const line of lines) {
    const heading = `${line.floorId}::${line.elementKey}`
    const list = byHeading.get(heading) || []
    list.push(line)
    byHeading.set(heading, list)
  }

  for (const [heading, headingLines] of byHeading) {
    const [floorId, elementKey] = heading.split('::')
    const set = sets.find(
      (candidate) =>
        candidate.floorId === floorId && candidate.elementKey === elementKey,
    )
    const engineKey = engineKeyFor(elementKey, opts?.engineKeyByHeading)
    const schema = visibleSchemaForLines(
      elementKey,
      headingLines as SelectedLineLite[],
      engineKey,
    )
    const shared = { ...(set?.shared || {}) }
    for (const field of schema.fields) {
      if (shared[field.key] == null && field.default != null) {
        shared[field.key] = field.default
      }
    }
    const headingInstances = instances.filter(
      (inst) =>
        inst.floorId === floorId &&
        (inst.elementKey === elementKey || inst.elementKey === engineKey),
    )
    const ctx = buildHeadingContext(engineKey, headingInstances, shared)

    for (const line of headingLines) {
      const key = identity(line)
      const ref = normalizeRef(line.catalogueRef)
      const recipe =
        schema.recipes[ref] ||
        schema.recipes[key] ||
        schema.recipes[line.catalogueRef]
      const evaluated = recipe ? evaluateRecipe(recipe, ctx, shared) : null
      if (evaluated) {
        result[scoped(line, key)] = {
          quantity: evaluated.quantity,
          source: evaluated.source,
          method: recipe?.kind === 'direct' ? 'direct' : 'auto',
        }
        continue
      }
      const leftover =
        set?.lineInputs?.[key] || set?.lineInputs?.[line.catalogueRef]
      if (!leftover) continue
      const fallback = evaluateLineInput({
        input: leftover,
        recipe: recipeForLine(line),
        shared,
      })
      if (fallback) result[scoped(line, key)] = fallback
    }
  }
  return result
}

export function inputQuantityForLine(
  line: SelectedBoqReportItem,
  calculated: CalculatedQuantityMap,
): EvaluatedQuantity | null {
  return calculated[scoped(line, identity(line))] || null
}

export function attachInputQuantities(
  lines: SelectedBoqReportItem[],
  sets: Array<Pick<ITakeoffInputSet, 'floorId' | 'elementKey' | 'shared' | 'lineInputs'>>,
  opts?: {
    instances?: InstanceLike[]
    engineKeyByHeading?: HeadingEngineMap
  },
): SelectedBoqReportItem[] {
  const calculated = calculateInputQuantities(lines, sets, opts)
  return lines.map((line) => {
    const input = inputQuantityForLine(line, calculated)
    return input
      ? {
          ...line,
          inputQuantity: input.quantity,
          inputQtySource: input.source,
        }
      : line
  })
}

export function engineKeyByHeadingFromMeta(
  elementMeta?: Record<string, { engineKey?: string }> | null,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [key, meta] of Object.entries(elementMeta || {})) {
    const engineKey = (meta?.engineKey || '').trim()
    if (engineKey) map[key] = engineKey
  }
  return map
}

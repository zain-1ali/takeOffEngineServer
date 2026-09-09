import type { Types } from 'mongoose'
import { SelectedBoqItem } from '../../models/SelectedBoqItem'
import { BoqPackItem } from '../../models/BoqPackItem'
import { BoqPackElement } from '../../models/BoqPackElement'
import { isProjectScopedLevel } from './packLevels'
import {
  bindingNeedsReview,
  buildPackMatchIndexes,
  findPackMatch,
  type PackItemMatch,
} from './packSelection'

export type ReconcileSelectedResult = {
  preserved: number
  needsReview: number
  orphaned: number
}

function resolveItemScope(
  item: { moduleNo: number; applicableLevelRaw?: string; elementRef?: string; elementKey: string },
  elByModRef: Map<string, { scope: 'PROJECT' | 'FLOOR' }>,
): 'PROJECT' | 'FLOOR' {
  const el = elByModRef.get(`${item.moduleNo}:${item.elementRef || ''}`)
  if (el?.scope) return el.scope
  return isProjectScopedLevel(item.applicableLevelRaw || '', item.moduleNo)
    ? 'PROJECT'
    : 'FLOOR'
}

export async function loadPackItemsForMatch(
  packId: Types.ObjectId,
): Promise<PackItemMatch[]> {
  const [items, elements] = await Promise.all([
    BoqPackItem.find({ packId }).lean(),
    BoqPackElement.find({ packId }).select({
      moduleNo: 1,
      elementRef: 1,
      scope: 1,
    }).lean(),
  ])
  const elByModRef = new Map()
  for (const el of elements) {
    elByModRef.set(`${el.moduleNo}:${el.elementRef}`, el)
  }
  return items.map((it) => ({
    _id: it._id,
    moduleNo: it.moduleNo,
    ref: it.ref,
    lineKey: it.lineKey,
    elementKey: it.elementKey,
    unit: it.unit || 'nr',
    description: it.description,
    formulaText: it.formulaText || '',
    quantityBasis: it.quantityBasis,
    applicableLevelRaw: it.applicableLevelRaw || '',
    scope: resolveItemScope(it, elByModRef),
  }))
}

/**
 * Overlay rows stay in place (qty / takeoff / measurement sets kept).
 * Removed pack lines become ORPHANED; incompatible bindings NEEDS_REVIEW.
 */
export async function reconcileSelectedBoqForPack(opts: {
  projectId: Types.ObjectId
  packId: Types.ObjectId
}): Promise<ReconcileSelectedResult> {
  const packItems = await loadPackItemsForMatch(opts.packId)
  const indexes = buildPackMatchIndexes(packItems)
  const selected = await SelectedBoqItem.find({ projectId: opts.projectId })

  const result: ReconcileSelectedResult = {
    preserved: 0,
    needsReview: 0,
    orphaned: 0,
  }
  const ops: Array<Record<string, unknown>> = []

  for (const sel of selected) {
    if (sel.isManual) continue
    const snap = {
      catalogueRef: sel.catalogueRef,
      elementKey: sel.elementKey,
      unit: sel.unit,
      lineKey: sel.lineKey || '',
      moduleNo: sel.moduleNo ?? undefined,
      scope: sel.scope,
      floorId: sel.floorId,
    }
    const match = findPackMatch(snap, indexes)
    if (!match) {
      result.orphaned += 1
      if (sel.reconciliationStatus !== 'ORPHANED') {
        ops.push({
          updateOne: {
            filter: { _id: sel._id },
            update: { $set: { reconciliationStatus: 'ORPHANED' } },
          },
        })
      }
      continue
    }

    const needsReview = bindingNeedsReview(snap, match)
    const $set: Record<string, unknown> = {
      packId: opts.packId,
      packItemId: match._id,
      lineKey: match.lineKey,
      moduleNo: match.moduleNo,
      reconciliationStatus: needsReview ? 'NEEDS_REVIEW' : 'ACTIVE',
    }
    if (!needsReview) {
      $set.description = match.description
      $set.formulaText = match.formulaText || ''
      $set.unit = match.unit
      $set.scope = match.scope
      $set.quantityBasis = match.quantityBasis || sel.quantityBasis
      $set.applicableLevels = match.applicableLevelRaw
        ? [match.applicableLevelRaw]
        : sel.applicableLevels || []
      result.preserved += 1
    } else {
      result.needsReview += 1
    }

    ops.push({
      updateOne: {
        filter: { _id: sel._id },
        update: { $set },
      },
    })
  }

  if (ops.length) {
    await SelectedBoqItem.bulkWrite(ops as any, { ordered: false })
  }
  return result
}

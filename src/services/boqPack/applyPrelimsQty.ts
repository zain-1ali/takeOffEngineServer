import type { Types } from 'mongoose'
import { SelectedBoqItem } from '../../models/SelectedBoqItem'
import { BoqPackItem } from '../../models/BoqPackItem'
import { BoqPackRate } from '../../models/BoqPackRate'
import { findActiveBoqPack } from './persistBoqPack'
import {
  evaluatePrelimLine,
  type PrelimLineInput,
  type PrelimLineResult,
  type PrelimProjectInputs,
} from './evaluatePrelimQty'
import { PROJECT_SCOPE_FLOOR_ID } from './scope'

export type ApplyPrelimsQtyResult = {
  dryRun: boolean
  applied: number
  eligible: number
  skipped: number
  lines: PrelimLineResult[]
}

export async function applyPrelimsQty(opts: {
  projectId: Types.ObjectId
  project: PrelimProjectInputs
  dryRun: boolean
  itemIds?: string[]
}): Promise<ApplyPrelimsQtyResult> {
  const pack = await findActiveBoqPack(opts.projectId)
  const filter: Record<string, unknown> = {
    projectId: opts.projectId,
    floorId: PROJECT_SCOPE_FLOOR_ID,
    moduleNo: 0,
  }
  if (opts.itemIds?.length) {
    filter._id = { $in: opts.itemIds }
  }
  const selected = await SelectedBoqItem.find(filter)

  const ratesByKey: Record<string, number> = {}
  if (pack) {
    const rates = await BoqPackRate.find({ packId: pack._id })
      .select({ lineKey: 1, compositeRate: 1 })
      .lean()
    for (const r of rates) {
      if (r.lineKey) ratesByKey[r.lineKey] = Number(r.compositeRate)
    }
  }

  const packItems = pack
    ? await BoqPackItem.find({ packId: pack._id, moduleNo: 0 })
        .select({ lineKey: 1, formulaText: 1, unit: 1 })
        .lean()
    : []
  const packByKey: Record<string, { formulaText: string; unit: string }> = {}
  for (const it of packItems) {
    packByKey[it.lineKey] = {
      formulaText: it.formulaText || '',
      unit: it.unit || '',
    }
  }

  const results: PrelimLineResult[] = []
  const toSave: Array<{ id: string; qty: number }> = []

  for (const sel of selected) {
    const packRow = sel.lineKey ? packByKey[sel.lineKey] : undefined
    const input: PrelimLineInput = {
      id: sel._id.toString(),
      floorId: sel.floorId,
      moduleNo: sel.moduleNo ?? undefined,
      scope: sel.scope,
      unit: sel.unit || packRow?.unit || '',
      formulaText: sel.formulaText || packRow?.formulaText || '',
      quantityBasis: sel.quantityBasis,
      quantity: sel.quantity,
      quantityMode: sel.quantityMode,
      takeoffKind: sel.takeoffKind,
      measurementSetId: sel.measurementSetId
        ? sel.measurementSetId.toString()
        : null,
      reconciliationStatus: sel.reconciliationStatus,
      lineKey: sel.lineKey,
      catalogueRef: sel.catalogueRef,
      description: sel.description,
      compositeRate:
        sel.lineKey && ratesByKey[sel.lineKey] != null
          ? ratesByKey[sel.lineKey]
          : null,
    }
    const row = evaluatePrelimLine(input, opts.project)
    results.push(row)
    if (row.eligible && row.proposedQty != null) {
      toSave.push({ id: row.id, qty: row.proposedQty })
    }
  }

  if (!opts.dryRun) {
    for (const row of toSave) {
      await SelectedBoqItem.updateOne(
        { _id: row.id, projectId: opts.projectId },
        { $set: { quantity: row.qty, quantityMode: 'TYPED' } },
      )
    }
  }

  return {
    dryRun: opts.dryRun,
    applied: opts.dryRun ? 0 : toSave.length,
    eligible: toSave.length,
    skipped: results.filter((r) => !r.eligible).length,
    lines: results,
  }
}

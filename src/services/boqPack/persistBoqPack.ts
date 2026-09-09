import { createHash } from 'crypto'
import type { Types } from 'mongoose'
import { BoqPack, type IBoqPack } from '../../models/BoqPack'
import { BoqPackElement } from '../../models/BoqPackElement'
import { BoqPackItem } from '../../models/BoqPackItem'
import { BoqPackRate } from '../../models/BoqPackRate'
import { BoqPackResource } from '../../models/BoqPackResource'
import { BoqPackAnalysis } from '../../models/BoqPackAnalysis'
import { parseIssueTrackerWorkbook } from './parseIssueTrackerWorkbook'
import { currencyMismatchWarning } from './parsePackPricing'
import {
  analysisComputedTotals,
  analysisStatusFromComputed,
  computePackAnalysis,
} from './computePackAnalysis'
import { reconcileSelectedBoqForPack, type ReconcileSelectedResult } from './reconcileSelectedBoq'
import type { ParsedIssueTrackerPack } from './types'

const BATCH = 400

async function insertBatches<T>(
  model: { insertMany: (docs: T[], opts: { ordered: boolean }) => Promise<unknown> },
  docs: T[],
) {
  for (let i = 0; i < docs.length; i += BATCH) {
    await model.insertMany(docs.slice(i, i + BATCH), { ordered: false })
  }
}

export async function findActiveBoqPack(projectId: Types.ObjectId) {
  return BoqPack.findOne({ projectId, status: 'ACTIVE' })
}

export function toPublicBoqPack(pack: {
  _id: { toString(): string }
  version: number
  status: string
  profile: string
  source?: unknown
  pricing?: unknown
  counts?: unknown
  modules?: unknown
  validation?: unknown
}) {
  const source = (pack.source || {}) as {
    fileName?: string
    uploadedAt?: Date
    parserVersion?: string
  }
  const pricing = (pack.pricing || {}) as {
    currency?: string
    location?: string
    taxInclusive?: boolean
  }
  const counts = (pack.counts || {}) as IBoqPack['counts']
  const modules = (pack.modules || []) as Array<{
    moduleNo: number
    moduleKey: string
    title: string
    itemCount: number
  }>
  const validation = (pack.validation || {}) as { warnings?: string[] }
  return {
    id: pack._id.toString(),
    version: pack.version,
    status: pack.status,
    profile: pack.profile,
    source: {
      fileName: source.fileName || '',
      uploadedAt: source.uploadedAt ? source.uploadedAt.toISOString() : '',
      parserVersion: source.parserVersion || '',
    },
    pricing: {
      currency: pricing.currency || 'USD',
      location: pricing.location || '',
      taxInclusive: Boolean(pricing.taxInclusive),
    },
    counts: {
      modules: counts.modules || 0,
      elements: counts.elements || 0,
      items: counts.items || 0,
      rates: counts.rates || 0,
      resources: counts.resources || 0,
      analyses: counts.analyses || 0,
    },
    modules: modules.map((m) => ({
      moduleNo: m.moduleNo,
      moduleKey: m.moduleKey,
      title: m.title,
      itemCount: m.itemCount,
    })),
    warnings: validation.warnings || [],
  }
}

export function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Parse workbook and atomically replace the project's ACTIVE pack.
 * Previous ACTIVE pack is SUPERSEDED (rows kept). Failed parse does not touch ACTIVE.
 */
export async function persistBoqPackFromWorkbook(opts: {
  projectId: Types.ObjectId
  buffer: Buffer
  fileName: string
  uploadedBy?: Types.ObjectId | null
  projectCurrency?: string
}): Promise<{
  packId: string
  parsed: ParsedIssueTrackerPack
  reconcile: ReconcileSelectedResult
}> {
  const parsed = parseIssueTrackerWorkbook(opts.buffer, opts.fileName)
  const mismatch = currencyMismatchWarning(
    parsed.pricing.currency,
    opts.projectCurrency || '',
  )
  if (mismatch) parsed.warnings.push(mismatch)
  if (parsed.errors.length) {
    const err = new Error(parsed.errors.join('; '))
    ;(err as any).parsed = parsed
    throw err
  }

  const last = await BoqPack.findOne({ projectId: opts.projectId })
    .sort({ version: -1 })
    .select({ version: 1 })
  const version = (last?.version || 0) + 1

  const staging = await BoqPack.create({
    projectId: opts.projectId,
    version,
    status: 'STAGING',
    profile: parsed.profile,
    source: {
      fileName: opts.fileName,
      sha256: sha256Buffer(opts.buffer),
      uploadedBy: opts.uploadedBy || null,
      uploadedAt: new Date(),
      parserVersion: parsed.parserVersion,
    },
    pricing: parsed.pricing,
    modules: parsed.modules,
    counts: {
      modules: parsed.modules.length,
      elements: parsed.elements.length,
      items: parsed.items.length,
      rates: parsed.rates.length,
      resources: parsed.resources.length,
      analyses: parsed.analyses.length,
    },
    validation: {
      warnings: parsed.warnings,
      errors: parsed.errors,
    },
  })

  try {
    await insertBatches(
      BoqPackElement,
      parsed.elements.map((el) => ({
        projectId: opts.projectId,
        packId: staging._id,
        moduleNo: el.moduleNo,
        elementRef: el.elementRef,
        label: el.label,
        normalizedLabel: el.normalizedLabel,
        elementKey: el.elementKey,
        bindingKind: el.bindingKind,
        engineKey: el.engineKey || '',
        scope: el.scope,
        applicableLevelsRaw: el.applicableLevelsRaw,
        sortOrder: el.sortOrder,
      })),
    )

    const itemDocs = parsed.items.map((it) => ({
      projectId: opts.projectId,
      packId: staging._id,
      moduleNo: it.moduleNo,
      ref: it.ref,
      lineKey: it.lineKey,
      elementKey: it.elementKey,
      elementRef: it.elementRef,
      description: it.description || it.ref,
      unit: it.unit || 'nr',
      applicableLevelRaw: it.applicableLevelRaw,
      formulaText: it.formulaText,
      quantityBasis: it.quantityBasis,
      sourceSheet: it.sourceSheet,
      sourceRow: it.sourceRow,
      sortOrder: it.sortOrder,
    }))
    await insertBatches(BoqPackItem, itemDocs)

    const savedItems = await BoqPackItem.find({ packId: staging._id }).select({
      _id: 1,
      lineKey: 1,
    })
    const idByKey = new Map(savedItems.map((d) => [d.lineKey, d._id]))

    await insertBatches(
      BoqPackRate,
      parsed.rates.map((rt) => ({
        projectId: opts.projectId,
        packId: staging._id,
        itemId: idByKey.get(rt.lineKey) || null,
        lineKey: rt.lineKey,
        labour: rt.labour,
        material: rt.material,
        plant: rt.plant,
        subcontract: rt.subcontract,
        wastePct: rt.wastePct,
        ohpPct: rt.ohpPct,
        directCost: rt.directCost,
        compositeRate: rt.compositeRate,
        currency: parsed.pricing.currency,
        sourceSheet: rt.sourceSheet,
        sourceRow: rt.sourceRow,
        rateSource: 'SCHEDULE',
        analysisRevision: 0,
      })),
    )

    await insertBatches(
      BoqPackResource,
      parsed.resources.map((res) => ({
        projectId: opts.projectId,
        packId: staging._id,
        code: res.code,
        category: res.category,
        description: res.description,
        unit: res.unit,
        unitRate: res.unitRate,
        wastePct: res.wastePct,
        sortOrder: res.sortOrder,
      })),
    )

    const savedRates = await BoqPackRate.find({ packId: staging._id }).select({
      _id: 1,
      lineKey: 1,
    })
    const rateIdByKey = new Map(savedRates.map((d) => [d.lineKey, d._id]))

    const savedResources = await BoqPackResource.find({ packId: staging._id }).select({
      _id: 1,
      code: 1,
    })
    const resourceIdByCode = new Map(savedResources.map((d) => [d.code, d._id]))
    const resourcesByCode = Object.fromEntries(
      parsed.resources.map((res) => [res.code, res]),
    )

    const now = new Date()
    await insertBatches(
      BoqPackAnalysis,
      parsed.analyses.map((an) => {
        const computed = computePackAnalysis({
          lines: an.lines,
          resourcesByCode,
          allowances: an.allowances,
        })
        const status = analysisStatusFromComputed(computed, 0, 1)
        return {
          projectId: opts.projectId,
          packId: staging._id,
          itemId: idByKey.get(an.lineKey) || null,
          rateId: rateIdByKey.get(an.lineKey) || null,
          lineKey: an.lineKey,
          moduleNo: an.moduleNo,
          ref: an.ref,
          description: an.description,
          unit: an.unit,
          lines: an.lines.map((ln) => ({
            resourceId: resourceIdByCode.get(ln.sourceCode) || null,
            sourceCode: ln.sourceCode,
            quantity: ln.quantity,
            remarks: ln.remarks,
            sortOrder: ln.sortOrder,
          })),
          allowances: an.allowances,
          computed: { ...analysisComputedTotals(computed), calculatedAt: now },
          revision: 1,
          appliedRevision: 0,
          status,
          sourceSheet: an.sourceSheet,
          sourceRow: an.sourceRow,
        }
      }),
    )

    const previousActive = await BoqPack.findOne({
      projectId: opts.projectId,
      status: 'ACTIVE',
      _id: { $ne: staging._id },
    })

    const reconcile = await reconcileSelectedBoqForPack({
      projectId: opts.projectId,
      packId: staging._id,
    })

    await BoqPack.updateMany(
      {
        projectId: opts.projectId,
        status: 'ACTIVE',
        _id: { $ne: staging._id },
      },
      { $set: { status: 'SUPERSEDED' } },
    )
    try {
      staging.status = 'ACTIVE'
      await staging.save()
    } catch (activateErr) {
      if (previousActive) {
        previousActive.status = 'ACTIVE'
        await previousActive.save()
      }
      throw activateErr
    }

    return { packId: staging._id.toString(), parsed, reconcile }
  } catch (err) {
    if (staging.status !== 'ACTIVE') {
      staging.status = 'FAILED'
      await staging.save()
    }
    throw err
  }
}

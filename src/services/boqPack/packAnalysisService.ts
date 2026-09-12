import { Types } from 'mongoose'
import { BoqPackAnalysis } from '../../models/BoqPackAnalysis'
import { BoqPackItem } from '../../models/BoqPackItem'
import { BoqPackRate } from '../../models/BoqPackRate'
import { BoqPackResource } from '../../models/BoqPackResource'
import { SelectedBoqItem } from '../../models/SelectedBoqItem'
import {
  analysisComputedTotals,
  analysisStatusFromComputed,
  computePackAnalysis,
  type PackAnalysisResource,
} from './computePackAnalysis'
import { ensureDefaultBoqPack } from './ensureDefaultBoqPack'

export class PackAnalysisError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function requireActivePack(
  projectId: Types.ObjectId,
  packId?: string,
) {
  const pack = await ensureDefaultBoqPack({ projectId })
  if (!pack) {
    throw new PackAnalysisError(
      404,
      'NO_PACK',
      'No active BOQ pack (default Issue Tracker workbook was not found)',
    )
  }
  if (packId && pack._id.toString() !== String(packId)) {
    throw new PackAnalysisError(409, 'PACK_REPLACED', 'Active pack has been replaced')
  }
  return pack
}

function resourcesByCodeFromDocs(
  docs: Array<{
    code: string
    category: string
    description: string
    unit: string
    unitRate: number
    wastePct: number
  }>,
): Record<string, PackAnalysisResource> {
  const out: Record<string, PackAnalysisResource> = {}
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    out[d.code] = {
      code: d.code,
      category: d.category,
      description: d.description,
      unit: d.unit,
      unitRate: Number(d.unitRate) || 0,
      wastePct: Number(d.wastePct) || 0,
    }
  }
  return out
}

function defaultAllowances(raw: {
  transportPctMaterials?: number
  sundriesPctLabourPlantSubcontract?: number
  overheadPct?: number
  profitPct?: number
} | null | undefined) {
  return {
    transportPctMaterials: Number(raw?.transportPctMaterials) || 0,
    sundriesPctLabourPlantSubcontract:
      Number(raw?.sundriesPctLabourPlantSubcontract) || 0,
    overheadPct: Number(raw?.overheadPct) || 0,
    profitPct: Number(raw?.profitPct) || 0,
  }
}

function recomputeDoc(
  analysis: {
    lines: Array<{ sourceCode: string; quantity: number; remarks?: string }>
    allowances?: {
      transportPctMaterials?: number
      sundriesPctLabourPlantSubcontract?: number
      overheadPct?: number
      profitPct?: number
    } | null
    revision: number
    appliedRevision: number
  },
  resourcesByCode: Record<string, PackAnalysisResource>,
) {
  const computed = computePackAnalysis({
    lines: analysis.lines,
    resourcesByCode,
    allowances: defaultAllowances(analysis.allowances),
  })
  const status = analysisStatusFromComputed(
    computed,
    analysis.appliedRevision,
    analysis.revision,
  )
  return { computed, status }
}

export async function listPackResources(opts: {
  projectId: Types.ObjectId
  packId?: string
  category?: string
  q?: string
}) {
  const pack = await requireActivePack(opts.projectId, opts.packId)
  const filter: Record<string, unknown> = { packId: pack._id }
  if (opts.category) filter.category = opts.category.toUpperCase()
  if (opts.q) {
    const q = opts.q.trim()
    filter.$or = [
      { code: new RegExp(escapeRegex(q), 'i') },
      { description: new RegExp(escapeRegex(q), 'i') },
    ]
  }
  const resources = await BoqPackResource.find(filter).sort({ sortOrder: 1, code: 1 }).lean()
  const analyses = await BoqPackAnalysis.find({ packId: pack._id })
    .select({ lines: 1, status: 1 })
    .lean()
  const usage = new Map()
  const stale = new Map()
  for (let i = 0; i < analyses.length; i++) {
    const an = analyses[i]
    const seen = new Map()
    for (let j = 0; j < (an.lines || []).length; j++) {
      const id = an.lines[j].resourceId ? String(an.lines[j].resourceId) : ''
      if (!id || seen.get(id)) continue
      seen.set(id, true)
      usage.set(id, (usage.get(id) || 0) + 1)
      if (an.status === 'STALE' || an.status === 'INVALID') {
        stale.set(id, (stale.get(id) || 0) + 1)
      }
    }
  }
  return {
    packId: pack._id.toString(),
    resources: resources.map((r) => ({
      id: r._id.toString(),
      code: r.code,
      category: r.category,
      description: r.description,
      unit: r.unit,
      unitRate: r.unitRate,
      wastePct: r.wastePct,
      sortOrder: r.sortOrder,
      usageCount: usage.get(r._id.toString()) || 0,
      staleAnalysisCount: stale.get(r._id.toString()) || 0,
    })),
  }
}

export async function patchPackResource(opts: {
  projectId: Types.ObjectId
  resourceId: string
  packId?: string
  revision?: number
  patch: {
    code?: string
    description?: string
    unit?: string
    unitRate?: number
    wastePct?: number
    category?: string
  }
}) {
  const pack = await requireActivePack(opts.projectId, opts.packId)
  const resource = await BoqPackResource.findOne({
    _id: opts.resourceId,
    packId: pack._id,
  })
  if (!resource) {
    throw new PackAnalysisError(404, 'NOT_FOUND', 'Resource not found')
  }
  if (opts.patch.code && opts.patch.code !== resource.code) {
    const clash = await BoqPackResource.findOne({
      packId: pack._id,
      code: opts.patch.code,
      _id: { $ne: resource._id },
    })
    if (clash) {
      throw new PackAnalysisError(400, 'DUPLICATE_CODE', 'Resource code already exists')
    }
    resource.code = opts.patch.code
  }
  if (opts.patch.description != null) {
    resource.description = String(opts.patch.description).trim()
    resource.descriptionEdited = true
  }
  if (opts.patch.unit != null) resource.unit = opts.patch.unit
  if (opts.patch.unitRate != null) resource.unitRate = Number(opts.patch.unitRate) || 0
  if (opts.patch.wastePct != null) resource.wastePct = Number(opts.patch.wastePct) || 0
  if (opts.patch.category != null) {
    resource.category = String(opts.patch.category || '').toUpperCase() || resource.category
  }
  await resource.save()

  const affected = await recomputeAnalysesForResource(pack._id, resource._id)
  return {
    resource: {
      id: resource._id.toString(),
      code: resource.code,
      category: resource.category,
      description: resource.description,
      unit: resource.unit,
      unitRate: resource.unitRate,
      wastePct: resource.wastePct,
    },
    affectedAnalyses: affected,
  }
}

async function recomputeAnalysesForResource(
  packId: Types.ObjectId,
  resourceId: Types.ObjectId,
): Promise<number> {
  const analyses = await BoqPackAnalysis.find({
    packId,
    'lines.resourceId': resourceId,
  })
  if (!analyses.length) return 0
  const resources = await BoqPackResource.find({ packId }).lean()
  const byCode = resourcesByCodeFromDocs(resources)
  const now = new Date()
  for (let i = 0; i < analyses.length; i++) {
    const an = analyses[i]
    an.revision = (an.revision || 1) + 1
    const { computed, status } = recomputeDoc(an, byCode)
    an.computed = { ...analysisComputedTotals(computed), calculatedAt: now } as any
    an.status = status === 'APPLIED' ? 'STALE' : status
    await an.save()
  }
  return analyses.length
}

function categoryFromCode(code: string, category?: string): string {
  const c = String(code || '').toUpperCase()
  if (c.startsWith('MAT')) return 'MAT'
  if (c.startsWith('LAB')) return 'LAB'
  if (c.startsWith('PLT')) return 'PLT'
  if (c.startsWith('SUB')) return 'SUB'
  const cat = String(category || '').toUpperCase()
  if (cat === 'MAT' || cat === 'LAB' || cat === 'PLT' || cat === 'SUB') return cat
  return 'OTHER'
}

export async function createPackResource(opts: {
  projectId: Types.ObjectId
  packId?: string
  code: string
  category?: string
  description?: string
  unit?: string
  unitRate?: number
  wastePct?: number
}) {
  const pack = await requireActivePack(opts.projectId, opts.packId)
  const code = String(opts.code || '').trim().toUpperCase()
  if (!code) {
    throw new PackAnalysisError(400, 'BAD_CODE', 'Resource code is required')
  }
  const clash = await BoqPackResource.findOne({ packId: pack._id, code })
  if (clash) {
    throw new PackAnalysisError(400, 'DUPLICATE_CODE', 'Resource code already exists')
  }
  const last = await BoqPackResource.findOne({ packId: pack._id })
    .sort({ sortOrder: -1 })
    .select({ sortOrder: 1 })
  const resource = await BoqPackResource.create({
    projectId: opts.projectId,
    packId: pack._id,
    code,
    category: categoryFromCode(code, opts.category),
    description: String(opts.description || '').trim(),
    unit: String(opts.unit || '').trim() || 'nr',
    unitRate: Number(opts.unitRate) || 0,
    wastePct: Number(opts.wastePct) || 0,
    sortOrder: (last?.sortOrder || 0) + 1,
  })
  return {
    resource: {
      id: resource._id.toString(),
      code: resource.code,
      category: resource.category,
      description: resource.description,
      unit: resource.unit,
      unitRate: resource.unitRate,
      wastePct: resource.wastePct,
      sortOrder: resource.sortOrder,
      usageCount: 0,
      staleAnalysisCount: 0,
    },
  }
}

export async function listPackAnalyses(opts: {
  projectId: Types.ObjectId
  packId?: string
  q?: string
  status?: string
  limit?: number
  offset?: number
}) {
  const pack = await requireActivePack(opts.projectId, opts.packId)
  const filter: Record<string, unknown> = { packId: pack._id }
  if (opts.status) filter.status = opts.status.toUpperCase()
  if (opts.q) {
    const q = opts.q.trim()
    filter.$or = [
      { lineKey: new RegExp(escapeRegex(q), 'i') },
      { ref: new RegExp(escapeRegex(q), 'i') },
      { description: new RegExp(escapeRegex(q), 'i') },
    ]
  }
  const limit = Math.min(Math.max(opts.limit || 80, 1), 200)
  const offset = Math.max(opts.offset || 0, 0)
  const [rows, total, staleCount, invalidCount] = await Promise.all([
    BoqPackAnalysis.find(filter)
      .sort({ moduleNo: 1, lineKey: 1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    BoqPackAnalysis.countDocuments(filter),
    BoqPackAnalysis.countDocuments({ packId: pack._id, status: 'STALE' }),
    BoqPackAnalysis.countDocuments({ packId: pack._id, status: 'INVALID' }),
  ])
  const keys = rows.map((r) => r.lineKey)
  const rates = await BoqPackRate.find({ packId: pack._id, lineKey: { $in: keys } })
    .select({ lineKey: 1, compositeRate: 1, rateSource: 1 })
    .lean()
  const rateByKey = new Map(rates.map((r) => [r.lineKey, r]))
  return {
    packId: pack._id.toString(),
    total,
    staleCount,
    invalidCount,
    offset,
    limit,
    analyses: rows.map((an) => {
      const applied = rateByKey.get(an.lineKey)
      const calculated = an.computed?.compositeRate || 0
      const current = applied ? Number(applied.compositeRate) || 0 : 0
      return {
        id: an._id.toString(),
        lineKey: an.lineKey,
        moduleNo: an.moduleNo,
        ref: an.ref,
        description: an.description,
        unit: an.unit,
        status: an.status,
        revision: an.revision,
        appliedRevision: an.appliedRevision,
        calculatedRate: calculated,
        appliedRate: current,
        rateSource: applied?.rateSource || 'SCHEDULE',
        delta: calculated - current,
      }
    }),
  }
}

export async function getPackAnalysis(opts: {
  projectId: Types.ObjectId
  lineKey: string
  packId?: string
}) {
  const pack = await requireActivePack(opts.projectId, opts.packId)
  const lineKey = decodeURIComponent(opts.lineKey)
  const analysis = await BoqPackAnalysis.findOne({ packId: pack._id, lineKey })
  if (!analysis) {
    throw new PackAnalysisError(404, 'NOT_FOUND', `No analysis for ${lineKey}`)
  }
  const resources = await BoqPackResource.find({ packId: pack._id }).lean()
  const byCode = resourcesByCodeFromDocs(resources)
  const { computed } = recomputeDoc(analysis, byCode)
  const rate = await BoqPackRate.findOne({ packId: pack._id, lineKey }).lean()
  const appliedRate = rate ? Number(rate.compositeRate) || 0 : 0
  return {
    packId: pack._id.toString(),
    analysis: {
      id: analysis._id.toString(),
      lineKey: analysis.lineKey,
      moduleNo: analysis.moduleNo,
      ref: analysis.ref,
      description: analysis.description,
      unit: analysis.unit,
      revision: analysis.revision,
      appliedRevision: analysis.appliedRevision,
      status: analysis.status,
      allowances: analysis.allowances,
      lines: computed.lines.map((ln, i) => ({
        id: analysis.lines[i]?._id?.toString() || '',
        sourceCode: ln.sourceCode,
        quantity: ln.quantity,
        remarks: ln.remarks,
        description: ln.description,
        category: ln.category,
        unit: ln.unit,
        unitRate: ln.unitRate,
        wastePct: ln.wastePct,
        amount: ln.amount,
        missing: ln.missing,
      })),
      computed: analysisComputedTotals(computed),
    },
    pricing: {
      currency: pack.pricing?.currency || 'USD',
      location: pack.pricing?.location || '',
      taxInclusive: Boolean(pack.pricing?.taxInclusive),
    },
    applied: rate
      ? {
          compositeRate: appliedRate,
          rateSource: rate.rateSource || 'SCHEDULE',
          material: rate.material,
          labour: rate.labour,
          plant: rate.plant,
          subcontract: rate.subcontract,
        }
      : null,
    delta: computed.compositeRate - appliedRate,
  }
}

export async function patchPackAnalysis(opts: {
  projectId: Types.ObjectId
  lineKey: string
  packId?: string
  revision: number
  apply?: boolean
  description?: string
  lines?: Array<{ sourceCode: string; quantity: number; remarks?: string }>
  allowances?: {
    transportPctMaterials?: number
    sundriesPctLabourPlantSubcontract?: number
    overheadPct?: number
    profitPct?: number
  }
}) {
  const pack = await requireActivePack(opts.projectId, opts.packId)
  const lineKey = decodeURIComponent(opts.lineKey)
  const analysis = await BoqPackAnalysis.findOne({ packId: pack._id, lineKey })
  if (!analysis) {
    throw new PackAnalysisError(404, 'NOT_FOUND', `No analysis for ${lineKey}`)
  }
  if (analysis.revision !== opts.revision) {
    throw new PackAnalysisError(409, 'STALE_REVISION', 'Analysis was updated elsewhere')
  }
  if (opts.description != null) {
    const description = String(opts.description).trim()
    if (!description) {
      throw new PackAnalysisError(400, 'INVALID_DESCRIPTION', 'Description is required')
    }
    if (description.length > 4000) {
      throw new PackAnalysisError(
        400,
        'INVALID_DESCRIPTION',
        'Description must be 4000 characters or fewer',
      )
    }
    analysis.description = description
    await Promise.all([
      BoqPackItem.updateMany(
        { packId: pack._id, lineKey },
        { $set: { description, descriptionEdited: true } },
      ),
      SelectedBoqItem.updateMany(
        { projectId: opts.projectId, packId: pack._id, lineKey },
        { $set: { description } },
      ),
    ])
  }
  const calculationChanged = Boolean(opts.lines || opts.allowances || opts.apply)
  if (!calculationChanged) {
    await analysis.save()
    return getPackAnalysis({
      projectId: opts.projectId,
      lineKey,
      packId: pack._id.toString(),
    })
  }
  if (opts.lines) {
    const resources = await BoqPackResource.find({ packId: pack._id }).lean()
    const idByCode = new Map(resources.map((r) => [r.code, r._id]))
    analysis.lines = opts.lines.map((ln, i) => ({
      resourceId: idByCode.get(ln.sourceCode) || null,
      sourceCode: String(ln.sourceCode || '').trim(),
      quantity: Number(ln.quantity) || 0,
      remarks: ln.remarks || '',
      sortOrder: i,
    })) as any
  }
  if (opts.allowances) {
    const prev = defaultAllowances(analysis.allowances)
    analysis.allowances = {
      transportPctMaterials:
        opts.allowances.transportPctMaterials ?? prev.transportPctMaterials,
      sundriesPctLabourPlantSubcontract:
        opts.allowances.sundriesPctLabourPlantSubcontract ??
        prev.sundriesPctLabourPlantSubcontract,
      overheadPct: opts.allowances.overheadPct ?? prev.overheadPct,
      profitPct: opts.allowances.profitPct ?? prev.profitPct,
    }
  }
  analysis.revision = analysis.revision + 1
  const resources = await BoqPackResource.find({ packId: pack._id }).lean()
  const byCode = resourcesByCodeFromDocs(resources)
  const { computed, status } = recomputeDoc(analysis, byCode)
  analysis.computed = {
    ...analysisComputedTotals(computed),
    calculatedAt: new Date(),
  } as any
  analysis.status = status === 'APPLIED' ? 'STALE' : status
  if (opts.apply) {
    if (computed.missingCodes.length) {
      throw new PackAnalysisError(
        400,
        'INVALID',
        'Cannot apply an analysis with missing resources',
      )
    }
    await applyComputedToRate(pack._id, analysis.lineKey, computed, analysis.revision)
    analysis.appliedRevision = analysis.revision
    analysis.status = 'APPLIED'
  }
  await analysis.save()
  return getPackAnalysis({
    projectId: opts.projectId,
    lineKey,
    packId: pack._id.toString(),
  })
}

async function applyComputedToRate(
  packId: Types.ObjectId,
  lineKey: string,
  computed: ReturnType<typeof computePackAnalysis>,
  revision: number,
) {
  const rate = await BoqPackRate.findOne({ packId, lineKey })
  if (!rate) {
    throw new PackAnalysisError(404, 'NOT_FOUND', `No Rates Schedule row for ${lineKey}`)
  }
  rate.material = computed.material
  rate.labour = computed.labour
  rate.plant = computed.plant
  rate.subcontract = computed.subcontract
  rate.directCost = computed.directResourceCost
  rate.transport = computed.transport
  rate.sundries = computed.sundries
  rate.overheadAmt = computed.overhead
  rate.profitAmt = computed.profit
  rate.compositeRate = computed.compositeRate
  rate.rateSource = 'ANALYSIS'
  rate.analysisRevision = revision
  await rate.save()
}

export async function recalculatePackAnalyses(opts: {
  projectId: Types.ObjectId
  packId?: string
  resourceIds?: string[]
  lineKeys?: string[]
  all?: boolean
  apply: boolean
}) {
  const pack = await requireActivePack(opts.projectId, opts.packId)
  const filter: Record<string, unknown> = { packId: pack._id }
  if (opts.resourceIds?.length) {
    filter['lines.resourceId'] = {
      $in: opts.resourceIds.map((id) => new Types.ObjectId(id)),
    }
  } else if (opts.lineKeys?.length) {
    filter.lineKey = { $in: opts.lineKeys }
  } else if (!opts.all) {
    filter.status = { $in: ['STALE', 'INVALID'] }
  }
  const analyses = await BoqPackAnalysis.find(filter)
  const resources = await BoqPackResource.find({ packId: pack._id }).lean()
  const byCode = resourcesByCodeFromDocs(resources)
  const now = new Date()
  let recomputed = 0
  let applied = 0
  let skipped = 0
  for (let i = 0; i < analyses.length; i++) {
    const an = analyses[i]
    an.revision = (an.revision || 1) + 1
    const { computed, status } = recomputeDoc(an, byCode)
    an.computed = { ...analysisComputedTotals(computed), calculatedAt: now } as any
    an.status = status === 'APPLIED' ? 'STALE' : status
    recomputed++
    if (opts.apply) {
      if (computed.missingCodes.length) {
        skipped++
        await an.save()
        continue
      }
      await applyComputedToRate(pack._id, an.lineKey, computed, an.revision)
      an.appliedRevision = an.revision
      an.status = 'APPLIED'
      applied++
    }
    await an.save()
  }
  return {
    packId: pack._id.toString(),
    recomputed,
    applied,
    skipped,
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

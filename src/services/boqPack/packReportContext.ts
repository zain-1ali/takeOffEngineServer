import type { Types } from 'mongoose'
import { BoqPackAnalysis } from '../../models/BoqPackAnalysis'
import { BoqPackElement } from '../../models/BoqPackElement'
import { BoqPackRate } from '../../models/BoqPackRate'
import { BoqPackResource } from '../../models/BoqPackResource'
import type { PackAnalysisResource } from './computePackAnalysis'
import { findActiveBoqPack } from './persistBoqPack'
import { isCatalogueElementKey } from './elementAliases'
import type { PackAnalysisBreakdown } from '../reports/applyPackAnalysisToBomLabour'

export type PackElementMeta = {
  label: string
  moduleNo: number
  sortOrder: number
  bindingKind: 'ENGINE' | 'CATALOGUE'
  scope: 'PROJECT' | 'FLOOR'
}

export type PackReportContext = {
  packId: string
  ratesByLineKey: Record<string, number>
  elementMeta: Record<string, PackElementMeta>
  analysesByLineKey: Record<string, PackAnalysisBreakdown>
  resourcesByCode: Record<string, PackAnalysisResource>
  elements: Array<{
    elementKey: string
    label: string
    moduleNo: number
    bindingKind: 'ENGINE' | 'CATALOGUE'
    engineKey: string
    scope: 'PROJECT' | 'FLOOR'
    sortOrder: number
  }>
}

export async function loadActivePackReportContext(
  projectId: Types.ObjectId,
): Promise<PackReportContext | null> {
  const pack = await findActiveBoqPack(projectId)
  if (!pack) return null

  const [rates, elements, analyses, resources] = await Promise.all([
    BoqPackRate.find({ packId: pack._id })
      .select({ lineKey: 1, compositeRate: 1 })
      .lean(),
    BoqPackElement.find({ packId: pack._id })
      .sort({ moduleNo: 1, sortOrder: 1 })
      .lean(),
    BoqPackAnalysis.find({ packId: pack._id })
      .select({ lineKey: 1, lines: 1, allowances: 1 })
      .lean(),
    BoqPackResource.find({ packId: pack._id })
      .select({
        code: 1,
        category: 1,
        description: 1,
        unit: 1,
        unitRate: 1,
        wastePct: 1,
      })
      .lean(),
  ])

  const ratesByLineKey: Record<string, number> = {}
  for (const r of rates) {
    const n = Number(r.compositeRate)
    if (r.lineKey && Number.isFinite(n)) ratesByLineKey[r.lineKey] = n
  }

  const elementMeta: Record<string, PackElementMeta> = {}
  const publicElements: PackReportContext['elements'] = []
  for (const el of elements) {
    const meta: PackElementMeta = {
      label: el.label,
      moduleNo: el.moduleNo,
      sortOrder: el.sortOrder,
      bindingKind: el.bindingKind,
      scope: el.scope,
    }
    if (!elementMeta[el.elementKey]) elementMeta[el.elementKey] = meta
    publicElements.push({
      elementKey: el.elementKey,
      label: el.label,
      moduleNo: el.moduleNo,
      bindingKind: el.bindingKind,
      engineKey: el.engineKey || '',
      scope: el.scope,
      sortOrder: el.sortOrder,
    })
  }

  const analysesByLineKey: Record<string, PackAnalysisBreakdown> = {}
  for (const an of analyses) {
    if (!an.lineKey) continue
    analysesByLineKey[an.lineKey] = {
      lines: (an.lines || []).map((ln) => ({
        sourceCode: ln.sourceCode,
        quantity: Number(ln.quantity) || 0,
        remarks: ln.remarks || '',
      })),
      allowances: an.allowances || undefined,
    }
  }

  const resourcesByCode: Record<string, PackAnalysisResource> = {}
  for (const res of resources) {
    if (!res.code) continue
    resourcesByCode[res.code] = {
      code: res.code,
      category: res.category,
      description: res.description,
      unit: res.unit,
      unitRate: Number(res.unitRate) || 0,
      wastePct: Number(res.wastePct) || 0,
    }
  }

  return {
    packId: pack._id.toString(),
    ratesByLineKey,
    elementMeta,
    analysesByLineKey,
    resourcesByCode,
    elements: publicElements,
  }
}

export function isReportableElementKey(
  elementKey: string,
  reportableKeys: readonly string[],
): boolean {
  if (reportableKeys.includes(elementKey)) return true
  return isCatalogueElementKey(elementKey)
}

import type { Types } from 'mongoose'
import { BoqPackElement } from '../../models/BoqPackElement'
import { BoqPackRate } from '../../models/BoqPackRate'
import { findActiveBoqPack } from './persistBoqPack'
import { isCatalogueElementKey } from './elementAliases'

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

  const [rates, elements] = await Promise.all([
    BoqPackRate.find({ packId: pack._id })
      .select({ lineKey: 1, compositeRate: 1 })
      .lean(),
    BoqPackElement.find({ packId: pack._id })
      .sort({ moduleNo: 1, sortOrder: 1 })
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

  return {
    packId: pack._id.toString(),
    ratesByLineKey,
    elementMeta,
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

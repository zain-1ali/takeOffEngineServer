import { Types } from 'mongoose'
import { BoqPackAnalysis } from '../../models/BoqPackAnalysis'
import { BoqPackRate } from '../../models/BoqPackRate'
import { BoqPackResource } from '../../models/BoqPackResource'
import { ManualBoqItem } from '../../models/ManualBoqItem'
import { findActiveBoqPack } from './persistBoqPack'
import { round } from '../../engines/math'

function scale(n: number, rate: number): number {
  return round((Number(n) || 0) * rate, 4)
}

/**
 * Multiply stored pack + manual BOQ money fields by an FX rate and retag currency.
 * Percentages and quantities are left unchanged.
 * Pack rows use `packRate` (workbook currency → target). Manual BOQ uses `rate`
 * (project currency → target). Pack conversion is skipped when already tagged
 * with the target currency so a retried confirm cannot double-scale.
 */
export async function convertActivePackCurrency(opts: {
  projectId: Types.ObjectId
  toCurrency: string
  rate: number
  packRate?: number
}): Promise<{ packConverted: boolean; resources: number; rates: number }> {
  const pack = await findActiveBoqPack(opts.projectId)
  const to = opts.toCurrency.toUpperCase()
  const fx = opts.rate
  const packFx =
    typeof opts.packRate === 'number' && opts.packRate > 0 ? opts.packRate : fx

  const manuals = await ManualBoqItem.find({ projectId: opts.projectId })
  for (let i = 0; i < manuals.length; i++) {
    const m = manuals[i]
    if (m.appliedUnitRate != null) m.appliedUnitRate = scale(m.appliedUnitRate, fx)
    const bom = m.appliedBomUnitLines || []
    for (let j = 0; j < bom.length; j++) {
      bom[j].rate = scale(bom[j].rate, fx)
    }
    const lab = m.appliedLabUnitLines || []
    for (let j = 0; j < lab.length; j++) {
      lab[j].dayRate = scale(lab[j].dayRate, fx)
    }
    m.markModified('appliedBomUnitLines')
    m.markModified('appliedLabUnitLines')
    await m.save()
  }

  if (!pack) return { packConverted: false, resources: 0, rates: 0 }

  const packCurrency = String(pack.pricing?.currency || '').trim().toUpperCase()
  const alreadyTarget = packCurrency === to
  const resources = await BoqPackResource.find({ packId: pack._id })
  const rates = await BoqPackRate.find({ packId: pack._id })
  if (!alreadyTarget) {
    for (let i = 0; i < resources.length; i++) {
      resources[i].unitRate = scale(resources[i].unitRate, packFx)
      await resources[i].save()
    }

    for (let i = 0; i < rates.length; i++) {
      const row = rates[i]
      row.labour = scale(row.labour, packFx)
      row.material = scale(row.material, packFx)
      row.plant = scale(row.plant, packFx)
      row.subcontract = scale(row.subcontract, packFx)
      row.directCost = scale(row.directCost, packFx)
      row.compositeRate = scale(row.compositeRate, packFx)
      row.transport = scale(row.transport, packFx)
      row.sundries = scale(row.sundries, packFx)
      row.overheadAmt = scale(row.overheadAmt, packFx)
      row.profitAmt = scale(row.profitAmt, packFx)
      row.currency = to
      await row.save()
    }

    const analyses = await BoqPackAnalysis.find({ packId: pack._id })
    for (let i = 0; i < analyses.length; i++) {
      const an = analyses[i]
      const c = an.computed
      if (c) {
        c.material = scale(c.material, packFx)
        c.labour = scale(c.labour, packFx)
        c.plant = scale(c.plant, packFx)
        c.subcontract = scale(c.subcontract, packFx)
        c.baseResourceCost = scale(c.baseResourceCost, packFx)
        c.wasteAllowance = scale(c.wasteAllowance, packFx)
        c.directResourceCost = scale(c.directResourceCost, packFx)
        c.transport = scale(c.transport, packFx)
        c.sundries = scale(c.sundries, packFx)
        c.primeCost = scale(c.primeCost, packFx)
        c.overhead = scale(c.overhead, packFx)
        c.profit = scale(c.profit, packFx)
        c.compositeRate = scale(c.compositeRate, packFx)
        an.markModified('computed')
      }
      await an.save()
    }
  } else {
    for (let i = 0; i < rates.length; i++) {
      if (rates[i].currency !== to) {
        rates[i].currency = to
        await rates[i].save()
      }
    }
  }

  pack.pricing = {
    ...(pack.pricing || {}),
    currency: to,
    location: pack.pricing?.location || '',
    taxInclusive: Boolean(pack.pricing?.taxInclusive),
  }
  pack.markModified('pricing')
  await pack.save()

  return {
    packConverted: true,
    resources: resources.length,
    rates: rates.length,
  }
}

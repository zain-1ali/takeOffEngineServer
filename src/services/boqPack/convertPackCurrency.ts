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
 */
export async function convertActivePackCurrency(opts: {
  projectId: Types.ObjectId
  toCurrency: string
  rate: number
}): Promise<{ packConverted: boolean; resources: number; rates: number }> {
  const pack = await findActiveBoqPack(opts.projectId)
  const to = opts.toCurrency.toUpperCase()
  const fx = opts.rate

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

  const resources = await BoqPackResource.find({ packId: pack._id })
  for (let i = 0; i < resources.length; i++) {
    resources[i].unitRate = scale(resources[i].unitRate, fx)
    await resources[i].save()
  }

  const rates = await BoqPackRate.find({ packId: pack._id })
  for (let i = 0; i < rates.length; i++) {
    const row = rates[i]
    row.labour = scale(row.labour, fx)
    row.material = scale(row.material, fx)
    row.plant = scale(row.plant, fx)
    row.subcontract = scale(row.subcontract, fx)
    row.directCost = scale(row.directCost, fx)
    row.compositeRate = scale(row.compositeRate, fx)
    row.transport = scale(row.transport, fx)
    row.sundries = scale(row.sundries, fx)
    row.overheadAmt = scale(row.overheadAmt, fx)
    row.profitAmt = scale(row.profitAmt, fx)
    row.currency = to
    await row.save()
  }

  const analyses = await BoqPackAnalysis.find({ packId: pack._id })
  for (let i = 0; i < analyses.length; i++) {
    const an = analyses[i]
    const c = an.computed
    if (c) {
      c.material = scale(c.material, fx)
      c.labour = scale(c.labour, fx)
      c.plant = scale(c.plant, fx)
      c.subcontract = scale(c.subcontract, fx)
      c.baseResourceCost = scale(c.baseResourceCost, fx)
      c.wasteAllowance = scale(c.wasteAllowance, fx)
      c.directResourceCost = scale(c.directResourceCost, fx)
      c.transport = scale(c.transport, fx)
      c.sundries = scale(c.sundries, fx)
      c.primeCost = scale(c.primeCost, fx)
      c.overhead = scale(c.overhead, fx)
      c.profit = scale(c.profit, fx)
      c.compositeRate = scale(c.compositeRate, fx)
      an.markModified('computed')
    }
    await an.save()
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

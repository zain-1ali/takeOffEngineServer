import { Types } from 'mongoose'
import { BoqPackAnalysis } from '../../models/BoqPackAnalysis'
import { BoqPackRate } from '../../models/BoqPackRate'
import { BoqPackResource } from '../../models/BoqPackResource'
import { ManualBoqItem } from '../../models/ManualBoqItem'
import { findActiveBoqPack } from './persistBoqPack'
import { round } from '../../engines/math'

const RATE_MONEY_KEYS = [
  'labour',
  'material',
  'plant',
  'subcontract',
  'directCost',
  'compositeRate',
  'transport',
  'sundries',
  'overheadAmt',
  'profitAmt',
]

const ANALYSIS_MONEY_KEYS = [
  'material',
  'labour',
  'plant',
  'subcontract',
  'baseResourceCost',
  'wasteAllowance',
  'directResourceCost',
  'transport',
  'sundries',
  'primeCost',
  'overhead',
  'profit',
  'compositeRate',
]

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
    m.appliedBomUnitLines = (m.appliedBomUnitLines || []).map((ln) => ({
      ...ln,
      rate: scale(ln.rate, fx),
    }))
    m.appliedLabUnitLines = (m.appliedLabUnitLines || []).map((ln) => ({
      ...ln,
      dayRate: scale(ln.dayRate, fx),
    }))
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
    for (let k = 0; k < RATE_MONEY_KEYS.length; k++) {
      const key = RATE_MONEY_KEYS[k]
      ;(row as any)[key] = scale((row as any)[key], fx)
    }
    row.currency = to
    await row.save()
  }

  const analyses = await BoqPackAnalysis.find({ packId: pack._id })
  for (let i = 0; i < analyses.length; i++) {
    const an = analyses[i]
    const computed = an.computed || ({} as any)
    for (let k = 0; k < ANALYSIS_MONEY_KEYS.length; k++) {
      const key = ANALYSIS_MONEY_KEYS[k]
      computed[key] = scale(computed[key], fx)
    }
    an.computed = computed
    an.markModified('computed')
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

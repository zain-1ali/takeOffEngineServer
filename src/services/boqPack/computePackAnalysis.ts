export type PackResourceCategory = 'MAT' | 'LAB' | 'PLT' | 'SUB' | 'OTHER'

export type PackAnalysisAllowances = {
  transportPctMaterials: number
  sundriesPctLabourPlantSubcontract: number
  overheadPct: number
  profitPct: number
}

export type PackAnalysisResource = {
  code: string
  category: PackResourceCategory | string
  description: string
  unit: string
  unitRate: number
  wastePct: number
}

export type PackAnalysisLineInput = {
  sourceCode: string
  quantity: number
  remarks?: string
}

export type ComputedAnalysisLine = {
  sourceCode: string
  description: string
  category: string
  unit: string
  quantity: number
  unitRate: number
  wastePct: number
  base: number
  waste: number
  amount: number
  remarks: string
  missing: boolean
}

export type ComputedPackAnalysis = {
  material: number
  labour: number
  plant: number
  subcontract: number
  baseResourceCost: number
  wasteAllowance: number
  directResourceCost: number
  transport: number
  sundries: number
  primeCost: number
  overhead: number
  profit: number
  compositeRate: number
  missingCodes: string[]
  lines: ComputedAnalysisLine[]
}

function categoryOf(cat: string): PackResourceCategory {
  const c = String(cat || '').toUpperCase()
  if (c === 'MAT' || c === 'LAB' || c === 'PLT' || c === 'SUB') return c
  return 'OTHER'
}

/**
 * Pack-local rate build-up. Does not call analyseRate / rateLib.
 * Intermediate values are not rounded; callers round for display only.
 */
export function computePackAnalysis(args: {
  lines: PackAnalysisLineInput[]
  resourcesByCode: Record<string, PackAnalysisResource>
  allowances: PackAnalysisAllowances
}): ComputedPackAnalysis {
  const missingCodes: string[] = []
  const lines: ComputedAnalysisLine[] = []
  let material = 0
  let labour = 0
  let plant = 0
  let subcontract = 0
  let baseResourceCost = 0
  let wasteAllowance = 0

  for (let i = 0; i < args.lines.length; i++) {
    const row = args.lines[i]
    const code = String(row.sourceCode || '').trim()
    const qty = Number(row.quantity) || 0
    const res = args.resourcesByCode[code]
    if (!res) {
      missingCodes.push(code)
      lines.push({
        sourceCode: code,
        description: `${code} (missing)`,
        category: 'OTHER',
        unit: '',
        quantity: qty,
        unitRate: 0,
        wastePct: 0,
        base: 0,
        waste: 0,
        amount: 0,
        remarks: row.remarks || '',
        missing: true,
      })
      continue
    }
    const wastePct = Number(res.wastePct) || 0
    const unitRate = Number(res.unitRate) || 0
    const base = qty * unitRate
    const waste = base * wastePct
    const amount = base + waste
    baseResourceCost += base
    wasteAllowance += waste
    const cat = categoryOf(res.category)
    if (cat === 'MAT') material += amount
    else if (cat === 'LAB') labour += amount
    else if (cat === 'PLT') plant += amount
    else if (cat === 'SUB') subcontract += amount
    lines.push({
      sourceCode: code,
      description: res.description,
      category: cat,
      unit: res.unit,
      quantity: qty,
      unitRate,
      wastePct,
      base,
      waste,
      amount,
      remarks: row.remarks || '',
      missing: false,
    })
  }

  const directResourceCost = material + labour + plant + subcontract
  const transport = material * (Number(args.allowances.transportPctMaterials) || 0)
  const sundries =
    (labour + plant + subcontract) *
    (Number(args.allowances.sundriesPctLabourPlantSubcontract) || 0)
  const primeCost = directResourceCost + transport + sundries
  const overhead = primeCost * (Number(args.allowances.overheadPct) || 0)
  const profit = (primeCost + overhead) * (Number(args.allowances.profitPct) || 0)
  const compositeRate = primeCost + overhead + profit

  return {
    material,
    labour,
    plant,
    subcontract,
    baseResourceCost,
    wasteAllowance,
    directResourceCost,
    transport,
    sundries,
    primeCost,
    overhead,
    profit,
    compositeRate,
    missingCodes,
    lines,
  }
}

export function analysisComputedTotals(computed: ComputedPackAnalysis) {
  return {
    material: computed.material,
    labour: computed.labour,
    plant: computed.plant,
    subcontract: computed.subcontract,
    baseResourceCost: computed.baseResourceCost,
    wasteAllowance: computed.wasteAllowance,
    directResourceCost: computed.directResourceCost,
    transport: computed.transport,
    sundries: computed.sundries,
    primeCost: computed.primeCost,
    overhead: computed.overhead,
    profit: computed.profit,
    compositeRate: computed.compositeRate,
  }
}

export function analysisStatusFromComputed(
  computed: ComputedPackAnalysis,
  appliedRevision: number,
  revision: number,
): 'APPLIED' | 'STALE' | 'INVALID' {
  if (computed.missingCodes.length) return 'INVALID'
  if (appliedRevision === revision && appliedRevision > 0) return 'APPLIED'
  return 'STALE'
}

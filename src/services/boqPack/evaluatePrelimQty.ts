import { lineAmount } from '../reports/pricing'
import { PROJECT_SCOPE_FLOOR_ID } from './scope'

export type PrelimSkipReason =
  | 'NOT_MODULE_0'
  | 'NOT_PROJECT_SCOPE'
  | 'TAKEOFF'
  | 'NOT_ACTIVE'
  | 'UNIT_UNSUPPORTED'
  | 'FORMULA_AMBIGUOUS'
  | 'FORMULA_CONDITIONAL'
  | 'MISSING_PROGRAMME_WEEKS'
  | 'MISSING_GFA'
  | 'MISSING_CONTRACT_VALUE'
  | 'RATE_INVALID'
  | 'PERCENT_RATE_MISMATCH'
  | 'SITE_AREA_NOT_GFA'

export type PrelimProjectInputs = {
  programmeWeeks: number | null
  gfaM2: number | null
  contractValue: number | null
}

export type PrelimLineInput = {
  id: string
  floorId: string
  moduleNo?: number
  scope?: string
  unit: string
  formulaText?: string
  quantityBasis?: string
  quantity: number
  quantityMode?: string
  takeoffKind?: string
  measurementSetId?: string | null
  reconciliationStatus?: string
  lineKey?: string
  catalogueRef: string
  description: string
  compositeRate: number | null
}

export type PrelimLineResult = {
  id: string
  catalogueRef: string
  description: string
  unit: string
  formulaText: string
  eligible: boolean
  skipReason: PrelimSkipReason | null
  currentQty: number
  proposedQty: number | null
  currentAmount: number | null
  proposedAmount: number | null
  basis: 'programmeWeeks' | 'gfaM2' | 'contractValue' | null
}

const PCT_TOLERANCE = 0.05

export function normalizePrelimUnit(raw: string): string {
  const s = String(raw || '')
    .toLowerCase()
    .replace(/²/g, '2')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
  if (s === 'wk' || s === 'week' || s === 'weeks') return 'wk'
  if (s === 'm2' || s === 'sqm' || s === 'sqmetre' || s === 'sqmeter') return 'm2'
  if (s === '%' || s === 'percent' || s === 'pct') return 'pct'
  if (s === 'item') return 'item'
  if (s === 'nr' || s === 'no' || s === 'nos') return 'nr'
  if (s === 'mth' || s === 'month' || s === 'months') return 'mth'
  if (s === 'm') return 'm'
  return s
}

function formulaOf(line: PrelimLineInput): string {
  return String(line.formulaText || '')
}

function isTakeoff(line: PrelimLineInput): boolean {
  if (line.quantityMode === 'TAKEOFF') return true
  if (line.takeoffKind === 'dim' || line.takeoffKind === 'bbs') return true
  if (line.measurementSetId) return true
  return false
}

function mentionsGfa(formula: string): boolean {
  return (
    /\bgfa\b/i.test(formula) ||
    /\bgifa\b/i.test(formula) ||
    /gross\s+(internal\s+)?floor\s+area/i.test(formula)
  )
}

function mentionsContract(formula: string): boolean {
  return /contract\s*(value|sum)|% of (the )?contract|% of value/i.test(formula)
}

function mentionsInclusivePrelims(formula: string): boolean {
  return /incl(uding)?\s+(prelim|oh\b|oh&p)/i.test(formula)
}

function hasStaffMultiplier(formula: string): boolean {
  return /×|x\s+number|number of staff|number of units|weeks\s*×/i.test(
    formula,
  )
}

function explicitPercent(formula: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(formula)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function evaluatePrelimLine(
  line: PrelimLineInput,
  project: PrelimProjectInputs,
): PrelimLineResult {
  const formula = formulaOf(line)
  const unit = normalizePrelimUnit(line.unit)
  const currentQty = Number(line.quantity) || 0
  const rate =
    line.compositeRate != null && Number.isFinite(line.compositeRate)
      ? line.compositeRate
      : null
  const base: PrelimLineResult = {
    id: line.id,
    catalogueRef: line.catalogueRef,
    description: line.description,
    unit: line.unit,
    formulaText: formula,
    eligible: false,
    skipReason: null,
    currentQty,
    proposedQty: null,
    currentAmount: lineAmount(currentQty, rate),
    proposedAmount: null,
    basis: null,
  }

  if (line.moduleNo !== 0) {
    return { ...base, skipReason: 'NOT_MODULE_0' }
  }
  if (
    line.floorId !== PROJECT_SCOPE_FLOOR_ID ||
    (line.scope && line.scope !== 'PROJECT')
  ) {
    return { ...base, skipReason: 'NOT_PROJECT_SCOPE' }
  }
  if (line.reconciliationStatus === 'ORPHANED' || line.reconciliationStatus === 'NEEDS_REVIEW') {
    return { ...base, skipReason: 'NOT_ACTIVE' }
  }
  if (isTakeoff(line)) {
    return { ...base, skipReason: 'TAKEOFF' }
  }
  if (
    line.quantityBasis === 'conditional' ||
    /\bonly where\b/i.test(formula)
  ) {
    return { ...base, skipReason: 'FORMULA_CONDITIONAL' }
  }

  if (unit === 'wk') {
    if (hasStaffMultiplier(formula)) {
      return { ...base, skipReason: 'FORMULA_AMBIGUOUS' }
    }
    if (formula && !/week|programme|duration|on site/i.test(formula)) {
      return { ...base, skipReason: 'FORMULA_AMBIGUOUS' }
    }
    if (project.programmeWeeks == null || !(project.programmeWeeks > 0)) {
      return { ...base, skipReason: 'MISSING_PROGRAMME_WEEKS' }
    }
    const qty = project.programmeWeeks
    return {
      ...base,
      eligible: true,
      proposedQty: qty,
      proposedAmount: lineAmount(qty, rate),
      basis: 'programmeWeeks',
    }
  }

  if (unit === 'm2') {
    if (!mentionsGfa(formula)) {
      return { ...base, skipReason: 'SITE_AREA_NOT_GFA' }
    }
    if (project.gfaM2 == null || !(project.gfaM2 > 0)) {
      return { ...base, skipReason: 'MISSING_GFA' }
    }
    const qty = project.gfaM2
    return {
      ...base,
      eligible: true,
      proposedQty: qty,
      proposedAmount: lineAmount(qty, rate),
      basis: 'gfaM2',
    }
  }

  if (unit === 'pct') {
    if (mentionsInclusivePrelims(formula)) {
      return { ...base, skipReason: 'FORMULA_AMBIGUOUS' }
    }
    if (!mentionsContract(formula)) {
      return { ...base, skipReason: 'FORMULA_AMBIGUOUS' }
    }
    if (rate == null || rate <= 0 || rate > 1) {
      return { ...base, skipReason: 'RATE_INVALID' }
    }
    const pct = explicitPercent(formula)
    if (pct != null && Math.abs(pct - rate * 100) > PCT_TOLERANCE) {
      return { ...base, skipReason: 'PERCENT_RATE_MISMATCH' }
    }
    if (project.contractValue == null || !(project.contractValue > 0)) {
      return { ...base, skipReason: 'MISSING_CONTRACT_VALUE' }
    }
    const qty = project.contractValue
    return {
      ...base,
      eligible: true,
      proposedQty: qty,
      proposedAmount: lineAmount(qty, rate),
      basis: 'contractValue',
    }
  }

  return { ...base, skipReason: 'UNIT_UNSUPPORTED' }
}

export function positiveOrNull(raw: unknown): number | null {
  if (raw === null || raw === '' || raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

import * as XLSX from 'xlsx'
import { normalizeLabel, resolveElementBinding } from './elementAliases'
import { formatLineKey, formatModuleKey, parseModuleSheetName } from './lineKey'
import { cellNumber, cellText, sheetRange } from './parseCells'
import { parseRateAnalysisSheet } from './parseRateAnalysis'
import { parsePackPricing } from './parsePackPricing'
import { addUnique, capIssues } from './parseIssues'
import {
  BOQ_PACK_MAX_UPLOAD_BYTES,
  BOQ_PACK_MAX_UPLOAD_LABEL,
  workbookLooksLikeExcel,
} from './workbookFile'
import {
  BOQ_PACK_PARSER_VERSION,
  BOQ_PACK_PROFILE,
  type ParsedBoqPackElement,
  type ParsedBoqPackItem,
  type ParsedBoqPackModule,
  type ParsedBoqPackRate,
  type ParsedBoqPackResource,
  type ParsedIssueTrackerPack,
  type QuantityBasis,
} from './types'

export { cellNumber, cellText } from './parseCells'

const REQUIRED_MODULE_NOS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17,
]


function inferQuantityBasis(formula: string): QuantityBasis {
  const f = formula.toLowerCase()
  if (/\bsame as\b/.test(f) && /\bonly where\b/.test(f)) return 'conditional'
  if (/\bsame as\b/.test(f)) return 'derived'
  return 'independent'
}

function elementRefFromLineRef(ref: string): string {
  const m = /^(\d+)/.exec(String(ref).trim())
  return m ? m[1] : '0'
}

function parseSummary(
  wb: XLSX.WorkBook,
): Map<number, { title: string; discipline: string }> {
  const map = new Map()
  const sheet = wb.Sheets.SUMMARY
  if (!sheet) return map
  const { r0, r1 } = sheetRange(sheet)
  for (let r = r0; r <= r1; r++) {
    const mod = cellText(sheet, r, 0)
    const m = /^Module\s+(\d+)$/i.exec(mod)
    if (!m) continue
    const no = Number(m[1])
    map.set(no, {
      title: cellText(sheet, r, 2) || `Module ${no}`,
      discipline: cellText(sheet, r, 2) || '',
    })
  }
  return map
}

function parseModuleSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  moduleNo: number,
  summary: Map<number, { title: string; discipline: string }>,
): {
  module: ParsedBoqPackModule
  elements: ParsedBoqPackElement[]
  items: ParsedBoqPackItem[]
  warnings: string[]
} {
  const warnings: string[] = []
  const sheet = wb.Sheets[sheetName]
  const items: ParsedBoqPackItem[] = []
  const elements: ParsedBoqPackElement[] = []
  if (!sheet) {
    return {
      module: {
        moduleNo,
        moduleKey: formatModuleKey(moduleNo),
        title: summary.get(moduleNo)?.title || `Module ${moduleNo}`,
        discipline: summary.get(moduleNo)?.discipline || '',
        sourceSheet: sheetName,
        sortOrder: moduleNo,
        elementCount: 0,
        itemCount: 0,
      },
      elements,
      items,
      warnings: [`Missing sheet ${sheetName}`],
    }
  }

  const { r0, r1 } = sheetRange(sheet)
  let header = r0
  for (let r = r0; r <= Math.min(r0 + 5, r1); r++) {
    if (/^ref\.?$/i.test(cellText(sheet, r, 0))) {
      header = r
      break
    }
  }

  let currentLabel = ''
  let currentLevel = ''
  let sort = 0
  const seenEl = new Map()

  for (let r = header + 1; r <= r1; r++) {
    const ref = cellText(sheet, r, 0)
    if (!ref) continue
    const elCell = cellText(sheet, r, 1)
    const lvlCell = cellText(sheet, r, 2)
    if (elCell) currentLabel = elCell
    if (lvlCell) currentLevel = lvlCell
    if (!currentLabel) {
      warnings.push(`${sheetName} row ${r + 1}: line ${ref} has no element heading`)
      continue
    }
    const description = cellText(sheet, r, 3)
    const unit = cellText(sheet, r, 5)
    const formulaText = cellText(sheet, r, 8)
    const elRef = elementRefFromLineRef(ref)
    const binding = resolveElementBinding({
      label: currentLabel,
      moduleNo,
      elementRef: elRef,
    })
    const scope = moduleNo === 0 ? 'PROJECT' : 'FLOOR'
    if (!seenEl.has(binding.elementKey + '|' + currentLabel)) {
      const el: ParsedBoqPackElement = {
        moduleNo,
        elementRef: elRef,
        label: currentLabel,
        normalizedLabel: normalizeLabel(currentLabel),
        elementKey: binding.elementKey,
        bindingKind: binding.bindingKind,
        engineKey: binding.bindingKind === 'ENGINE' ? binding.engineKey : undefined,
        scope,
        applicableLevelsRaw: currentLevel ? [currentLevel] : [],
        sortOrder: seenEl.size,
      }
      seenEl.set(binding.elementKey + '|' + currentLabel, el)
      elements.push(el)
    }
    items.push({
      moduleNo,
      ref,
      lineKey: formatLineKey(moduleNo, ref),
      elementKey: binding.elementKey,
      elementRef: elRef,
      description,
      unit,
      applicableLevelRaw: currentLevel,
      formulaText,
      quantityBasis: inferQuantityBasis(formulaText),
      sourceSheet: sheetName,
      sourceRow: r + 1,
      sortOrder: sort++,
    })
  }

  const meta = summary.get(moduleNo)
  return {
    module: {
      moduleNo,
      moduleKey: formatModuleKey(moduleNo),
      title: meta?.title || `Module ${moduleNo}`,
      discipline: meta?.discipline || '',
      sourceSheet: sheetName,
      sortOrder: moduleNo,
      elementCount: elements.length,
      itemCount: items.length,
    },
    elements,
    items,
    warnings,
  }
}

function parseRatesSchedule(
  wb: XLSX.WorkBook,
): { rates: ParsedBoqPackRate[]; warnings: string[] } {
  const warnings: string[] = []
  const sheet = wb.Sheets['Rates Schedule']
  const rates: ParsedBoqPackRate[] = []
  if (!sheet) {
    return { rates, warnings: ['Missing sheet Rates Schedule'] }
  }
  const { r0, r1 } = sheetRange(sheet)
  let header = r0
  for (let r = r0; r <= Math.min(r0 + 8, r1); r++) {
    const a = cellText(sheet, r, 0).toLowerCase()
    if (a === 'key' || /^module$/i.test(cellText(sheet, r, 1))) {
      header = r
      break
    }
  }
  // Key | Module | Ref | … | Composite Rate at col 14
  for (let r = header + 1; r <= r1; r++) {
    const moduleName = cellText(sheet, r, 1)
    const ref = cellText(sheet, r, 2)
    if (!moduleName || !ref) continue
    const moduleNo = parseModuleSheetName(moduleName)
    if (moduleNo == null) {
      warnings.push(`Rates Schedule row ${r + 1}: bad module ${moduleName}`)
      continue
    }
    rates.push({
      lineKey: formatLineKey(moduleNo, ref),
      labour: cellNumber(sheet, r, 5),
      material: cellNumber(sheet, r, 6),
      plant: cellNumber(sheet, r, 7),
      subcontract: cellNumber(sheet, r, 8),
      wastePct: cellNumber(sheet, r, 9),
      ohpPct: cellNumber(sheet, r, 10),
      directCost: cellNumber(sheet, r, 11),
      compositeRate: cellNumber(sheet, r, 14),
      sourceSheet: 'Rates Schedule',
      sourceRow: r + 1,
    })
  }
  return { rates, warnings }
}

function resourceCategory(code: string, categoryCell: string): ParsedBoqPackResource['category'] {
  const c = (code || '').toUpperCase()
  if (c.startsWith('MAT')) return 'MAT'
  if (c.startsWith('LAB')) return 'LAB'
  if (c.startsWith('PLT')) return 'PLT'
  if (c.startsWith('SUB')) return 'SUB'
  const cat = categoryCell.toLowerCase()
  if (cat.includes('material')) return 'MAT'
  if (cat.includes('labour') || cat.includes('labor')) return 'LAB'
  if (cat.includes('plant')) return 'PLT'
  if (cat.includes('subcontract')) return 'SUB'
  return 'OTHER'
}

function parsePricesDatabank(wb: XLSX.WorkBook): {
  resources: ParsedBoqPackResource[]
  warnings: string[]
} {
  const warnings: string[] = []
  const sheet = wb.Sheets['PRICES DATABANK']
  const resources: ParsedBoqPackResource[] = []
  if (!sheet) return { resources, warnings: ['Missing sheet PRICES DATABANK'] }
  const { r0, r1 } = sheetRange(sheet)
  let header = r0
  for (let r = r0; r <= Math.min(r0 + 8, r1); r++) {
    if (/^code$/i.test(cellText(sheet, r, 0))) {
      header = r
      break
    }
  }
  let sort = 0
  for (let r = header + 1; r <= r1; r++) {
    const code = cellText(sheet, r, 0)
    if (!code || code.toLowerCase() === 'code') continue
    resources.push({
      code,
      category: resourceCategory(code, cellText(sheet, r, 1)),
      description: cellText(sheet, r, 2),
      unit: cellText(sheet, r, 3),
      unitRate: cellNumber(sheet, r, 4),
      wastePct: cellNumber(sheet, r, 5),
      sortOrder: sort++,
    })
  }
  return { resources, warnings }
}

function emptyPack(
  sourceFileName: string,
  errors: string[],
  warnings: string[] = [],
): ParsedIssueTrackerPack {
  return {
    profile: BOQ_PACK_PROFILE,
    parserVersion: BOQ_PACK_PARSER_VERSION,
    sourceFileName,
    pricing: { currency: 'USD', location: '', taxInclusive: false },
    modules: [],
    elements: [],
    items: [],
    rates: [],
    resources: [],
    analyses: [],
    analysisCount: 0,
    warnings,
    errors,
  }
}

export function parseIssueTrackerWorkbook(
  buffer: Buffer,
  sourceFileName = 'workbook.xlsx',
): ParsedIssueTrackerPack {
  const warnings: string[] = []
  const errors: string[] = []
  if (!buffer || !buffer.length) {
    return emptyPack(sourceFileName, ['Workbook file is empty'])
  }
  if (buffer.length > BOQ_PACK_MAX_UPLOAD_BYTES) {
    return emptyPack(sourceFileName, [
      `File too large (max ${BOQ_PACK_MAX_UPLOAD_LABEL})`,
    ])
  }
  if (!workbookLooksLikeExcel(buffer)) {
    return emptyPack(sourceFileName, [
      'Not a valid Excel workbook (.xlsx)',
    ])
  }

  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  } catch {
    return emptyPack(sourceFileName, ['Could not read Excel workbook'])
  }
  const names = wb.SheetNames
  if (!names.length) {
    return emptyPack(sourceFileName, ['Workbook has no sheets'])
  }

  if (names.some((n) => parseModuleSheetName(n) === 14)) {
    const sh = wb.Sheets['MODULE 14'] || wb.Sheets['Module 14']
    if (sh) {
      const { r0, r1 } = sheetRange(sh)
      let items = 0
      for (let r = r0; r <= r1; r++) {
        if (/^\d/.test(cellText(sh, r, 0))) items++
      }
      if (items > 0) {
        errors.push('Module 14 is not in the approved template and must not be imported')
      }
    }
  }

  const summary = parseSummary(wb)
  const modules: ParsedBoqPackModule[] = []
  const elements: ParsedBoqPackElement[] = []
  const items: ParsedBoqPackItem[] = []

  for (const name of names) {
    const moduleNo = parseModuleSheetName(name)
    if (moduleNo == null) continue
    if (moduleNo === 14) continue
    const parsed = parseModuleSheet(wb, name, moduleNo, summary)
    warnings.push(...parsed.warnings)
    modules.push(parsed.module)
    elements.push(...parsed.elements)
    items.push(...parsed.items)
  }

  const have = new Set(modules.map((m) => m.moduleNo))
  for (const no of REQUIRED_MODULE_NOS) {
    if (!have.has(no)) errors.push(`Missing required sheet MODULE ${no}`)
  }

  const { rates, warnings: rateWarn } = parseRatesSchedule(wb)
  warnings.push(...rateWarn)
  const { resources, warnings: resWarn } = parsePricesDatabank(wb)
  warnings.push(...resWarn)
  const { analyses, warnings: anWarn } = parseRateAnalysisSheet(wb)
  warnings.push(...anWarn)

  const itemKeys = new Set(items.map((i) => i.lineKey))
  const rateKeys = new Set(rates.map((r) => r.lineKey))
  let missingRates = 0
  for (const k of itemKeys) {
    if (!rateKeys.has(k)) missingRates++
  }
  if (missingRates) {
    warnings.push(`${missingRates} BOQ lines have no Rates Schedule row`)
  }

  const resCodes = new Set(resources.map((r) => r.code))
  let missingRes = 0
  for (const an of analyses) {
    for (const ln of an.lines) {
      if (!resCodes.has(ln.sourceCode)) missingRes++
    }
  }
  if (missingRes) {
    warnings.push(`${missingRes} analysis resource codes are not in PRICES DATABANK`)
  }

  const seenRef = new Set()
  for (const it of items) {
    const k = `${it.moduleNo}|${it.ref}`
    if (seenRef.has(k)) addUnique(errors, `Duplicate ref ${k}`)
    seenRef.add(k)
  }

  const seenRate = new Set()
  for (const rt of rates) {
    if (seenRate.has(rt.lineKey)) {
      addUnique(errors, `Duplicate Rates Schedule row ${rt.lineKey}`)
    }
    seenRate.add(rt.lineKey)
  }

  const seenCode = new Set()
  for (const res of resources) {
    if (seenCode.has(res.code)) {
      addUnique(errors, `Duplicate PRICES DATABANK code ${res.code}`)
    }
    seenCode.add(res.code)
  }

  if (!items.length) {
    errors.push('Workbook has no BOQ lines')
  }
  if (items.length && !rates.length) {
    errors.push('Rates Schedule is missing or has no rows — cannot price the BOQ')
  }

  const pricing = parsePackPricing(wb)

  return {
    profile: BOQ_PACK_PROFILE,
    parserVersion: BOQ_PACK_PARSER_VERSION,
    sourceFileName,
    pricing,
    modules: modules.sort((a, b) => a.moduleNo - b.moduleNo),
    elements,
    items,
    rates,
    resources,
    analyses,
    analysisCount: analyses.length,
    warnings: capIssues(warnings, 'warnings'),
    errors: capIssues(errors, 'errors'),
  }
}

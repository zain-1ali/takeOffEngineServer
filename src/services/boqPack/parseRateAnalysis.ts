import * as XLSX from 'xlsx'
import { formatLineKey, parseModuleSheetName } from './lineKey'
import { cellNumber, cellText, sheetRange } from './parseCells'
import { parsePercentCell } from './parsePercent'
import type { ParsedBoqPackAnalysis } from './types'

function identityFromRow(
  sheet: XLSX.WorkSheet,
  r: number,
): { moduleNo: number; ref: string; lineKey: string } | null {
  const helper = cellText(sheet, r, 8)
  const hm = /^MODULE\s+(\d+)\s*\|\s*(.+)$/i.exec(helper)
  let moduleNo: number | null = null
  let ref = ''
  if (hm) {
    moduleNo = Number(hm[1])
    ref = hm[2].trim()
  } else {
    moduleNo = parseModuleSheetName(cellText(sheet, r, 1))
    ref = cellText(sheet, r, 2)
  }
  if (moduleNo == null || !ref) return null
  return { moduleNo, ref, lineKey: formatLineKey(moduleNo, ref) }
}

function isTotalLabel(desc: string): boolean {
  return /materials\s+total|labour\s+total|plant.*total|direct resource cost|^prime cost$|rate per boq unit/i.test(
    desc,
  )
}

/**
 * Parse RATE ANALYSIS blocks. Persist coefficients only — rates/amounts
 * are looked up from PRICES DATABANK at compute time.
 */
export function parseRateAnalysisSheet(wb: XLSX.WorkBook): {
  analyses: ParsedBoqPackAnalysis[]
  warnings: string[]
} {
  const warnings: string[] = []
  const sheet = wb.Sheets['RATE ANALYSIS']
  const analyses: ParsedBoqPackAnalysis[] = []
  if (!sheet) {
    return { analyses, warnings: ['Missing sheet RATE ANALYSIS'] }
  }
  const { r0, r1 } = sheetRange(sheet)
  const seen = new Map()

  for (let r = r0; r <= r1; r++) {
    if (!/^module\s*\/\s*ref$/i.test(cellText(sheet, r, 0))) continue
    const id = identityFromRow(sheet, r)
    if (!id) {
      warnings.push(`RATE ANALYSIS row ${r + 1}: could not read Module / Ref`)
      continue
    }
    if (id.moduleNo === 14) {
      warnings.push(`Skipped Module 14 analysis ${id.lineKey}`)
      continue
    }
    if (seen.has(id.lineKey)) {
      warnings.push(`Duplicate RATE ANALYSIS ${id.lineKey} at row ${r + 1}`)
      continue
    }
    seen.set(id.lineKey, true)

    let description = ''
    let unit = ''
    const lines: ParsedBoqPackAnalysis['lines'] = []
    const allowances = {
      transportPctMaterials: 0,
      sundriesPctLabourPlantSubcontract: 0,
      overheadPct: 0,
      profitPct: 0,
    }
    let sort = 0
    let inResources = false

    for (let k = r + 1; k <= Math.min(r + 30, r1); k++) {
      const a = cellText(sheet, k, 0)
      const desc = cellText(sheet, k, 2)
      if (/^module\s*\/\s*ref$/i.test(a)) break
      if (/^detailed rate analysis/i.test(a)) break

      if (/^boq item$/i.test(a)) {
        description = cellText(sheet, k, 1) || desc
        continue
      }
      if (/^unit$/i.test(a)) {
        unit = cellText(sheet, k, 1)
        continue
      }
      if (/^no\.?$/i.test(a) && /^code$/i.test(cellText(sheet, k, 1))) {
        inResources = true
        continue
      }
      if (/^user add$/i.test(a)) continue

      if (/^transport/i.test(desc)) {
        allowances.transportPctMaterials = parsePercentCell(cellText(sheet, k, 3))
        inResources = false
        continue
      }
      if (/sundries/i.test(desc)) {
        allowances.sundriesPctLabourPlantSubcontract = parsePercentCell(
          cellText(sheet, k, 3),
        )
        inResources = false
        continue
      }
      if (/overhead/i.test(desc)) {
        allowances.overheadPct = parsePercentCell(cellText(sheet, k, 3))
        inResources = false
        continue
      }
      if (/profit/i.test(desc)) {
        allowances.profitPct = parsePercentCell(cellText(sheet, k, 3))
        inResources = false
        continue
      }
      if (isTotalLabel(desc)) {
        inResources = false
        continue
      }

      if (!inResources) continue
      const code = cellText(sheet, k, 1)
      if (!code) continue
      lines.push({
        sourceCode: code,
        quantity: cellNumber(sheet, k, 4),
        remarks: cellText(sheet, k, 8),
        sortOrder: sort++,
      })
    }

    analyses.push({
      lineKey: id.lineKey,
      moduleNo: id.moduleNo,
      ref: id.ref,
      description,
      unit,
      lines,
      allowances,
      sourceSheet: 'RATE ANALYSIS',
      sourceRow: r + 1,
    })
  }

  return { analyses, warnings }
}

import type * as XLSX from 'xlsx'
import { cellText, sheetRange } from './parseCells'

const ISO = /\b(USD|EUR|GBP|KES|UGX|TZS|ZAR|AED|SAR|INR|CNY|JPY|AUD|CAD|CHF|NGN)\b/i

export function parsePackPricing(wb: XLSX.WorkBook): {
  currency: string
  location: string
  taxInclusive: boolean
} {
  let currency = ''
  let location = ''
  let taxInclusive = false
  const sheet = wb.Sheets['RATE ANALYSIS'] || wb.Sheets['Rates Schedule']
  if (sheet) {
    const { r0, r1, c1 } = sheetRange(sheet)
    const last = Math.min(r0 + 40, r1)
    for (let r = r0; r <= last; r++) {
      for (let c = 0; c <= Math.min(c1, 16); c++) {
        const t = cellText(sheet, r, c)
        if (/^currency$/i.test(t) && !currency) {
          currency = cellText(sheet, r, c + 1)
        }
        if (/^pricing basis$/i.test(t) && !location) {
          location = cellText(sheet, r, c + 1)
        }
        if (/^vat$/i.test(t)) {
          const v = cellText(sheet, r, c + 1).toLowerCase()
          taxInclusive = v.includes('inclu')
        }
      }
    }
  }
  if (!currency && sheet) {
    const hit = ISO.exec(cellText(sheet, 0, 0))
    if (hit) currency = hit[1].toUpperCase()
  }
  const iso = ISO.exec(currency)
  return {
    currency: iso ? iso[1].toUpperCase() : 'USD',
    location: location || 'Nairobi, Kenya',
    taxInclusive,
  }
}

export function currencyMismatchWarning(
  packCurrency: string,
  projectCurrency: string,
): string | null {
  const a = String(packCurrency || '').trim().toUpperCase()
  const b = String(projectCurrency || '').trim().toUpperCase()
  if (!a || !b || a === b) return null
  return (
    `Workbook currency is ${a}; project is ${b}. Rates are not converted. ` +
    `Convert the project currency separately, or keep the project on ${a}.`
  )
}
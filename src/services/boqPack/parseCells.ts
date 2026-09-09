import * as XLSX from 'xlsx'

function cell(sheet: XLSX.WorkSheet, r: number, c: number): XLSX.CellObject | undefined {
  return sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
}

/** Displayed Excel text. Never Number() a ref. */
export function cellText(sheet: XLSX.WorkSheet, r: number, c: number): string {
  const cl = cell(sheet, r, c)
  if (!cl) return ''
  if (cl.w != null && String(cl.w).trim() !== '') return String(cl.w).trim()
  if (cl.v == null || cl.v === '') return ''
  return String(cl.v).trim()
}

export function cellNumber(sheet: XLSX.WorkSheet, r: number, c: number): number {
  const cl = cell(sheet, r, c)
  if (!cl) return 0
  if (typeof cl.v === 'number' && Number.isFinite(cl.v)) return cl.v
  const raw = String(cl.w ?? cl.v ?? '')
    .replace(/[$,£€]/g, '')
    .replace(/,/g, '')
    .replace(/%/g, '')
    .trim()
  if (!raw || raw === '—' || raw === '-') return 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

export function sheetRange(sheet: XLSX.WorkSheet): {
  r0: number
  r1: number
  c1: number
} {
  const ref = sheet['!ref'] || 'A1'
  const dec = XLSX.utils.decode_range(ref)
  return { r0: dec.s.r, r1: dec.e.r, c1: dec.e.c }
}

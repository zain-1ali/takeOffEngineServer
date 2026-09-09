/** Canonical BOQ identity. Ref is displayed Excel text — never Number(). */
export function formatModuleKey(moduleNo: number): string {
  return `M${String(moduleNo).padStart(2, '0')}`
}

export function formatLineKey(moduleNo: number, ref: string): string {
  return `${formatModuleKey(moduleNo)}:${String(ref).trim()}`
}

export function parseModuleSheetName(name: string): number | null {
  const m = /^MODULE\s+(\d+)$/i.exec(String(name || '').trim())
  if (!m) return null
  return Number(m[1])
}

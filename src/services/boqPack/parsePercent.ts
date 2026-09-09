/** Normalize Excel percent cells to a fraction (0.10 === 10%). */
export function parsePercentCell(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw === 0) return 0
    return raw > 1 ? raw / 100 : raw
  }
  const s = String(raw ?? '').trim()
  if (!s) return 0
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pct) return Number(pct[1]) / 100
  const n = Number(
    s
      .replace(/[$,£€]/g, '')
      .replace(/,/g, '')
      .replace(/%/g, '')
      .trim(),
  )
  if (!Number.isFinite(n) || n === 0) return 0
  return n > 1 ? n / 100 : n
}

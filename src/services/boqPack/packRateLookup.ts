import { formatLineKey } from './lineKey'

/**
 * Unit rate for a selected BOQ line when an ACTIVE pack is present.
 * Join by lineKey, then (moduleNo, ref). Never falls back to rateLib.
 */
export function lookupPackCompositeRate(args: {
  hasActivePack?: boolean
  isManual?: boolean
  lineKey?: string
  moduleNo?: number
  catalogueRef?: string
  packRatesByLineKey?: Record<string, number>
}): number | undefined {
  if (!args.hasActivePack || args.isManual) return undefined
  const rates = args.packRatesByLineKey
  if (!rates) return undefined

  const keys: string[] = []
  const lineKey = String(args.lineKey || '').trim()
  if (lineKey) keys.push(lineKey)
  if (
    args.moduleNo != null &&
    Number.isFinite(args.moduleNo) &&
    String(args.catalogueRef || '').trim()
  ) {
    const derived = formatLineKey(args.moduleNo, args.catalogueRef as string)
    if (derived !== lineKey) keys.push(derived)
  }

  for (let i = 0; i < keys.length; i++) {
    const n = rates[keys[i]]
    if (n != null && Number.isFinite(n)) return n
  }
  return undefined
}

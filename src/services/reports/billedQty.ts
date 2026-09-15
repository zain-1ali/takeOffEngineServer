/** How a BOQ line's billed quantity was chosen. */
export type QtySource =
  | 'typed'
  | 'takeoff'
  | 'input'
  | 'derived'
  | 'engine'
  | 'stored'

export type QuantityMode = 'TYPED' | 'TAKEOFF' | ''

/**
 * TYPED / TAKEOFF keep the stored number. Otherwise a CORE binding uses the
 * live engine qty (including 0). Unbound lines use stored qty.
 */
export function billedQty(args: {
  quantityMode?: string | null
  storedQty: number
  inputQty?: number | null
  inputQtySource?: 'input' | 'derived' | null
  /** Engine qty when this catalogue ref is a CORE binding; null if unbound. */
  engineQty: number | null
}): { qty: number; source: QtySource } {
  const mode = args.quantityMode || ''
  const stored = Number(args.storedQty)
  const storedSafe = Number.isFinite(stored) && stored >= 0 ? stored : 0
  if (mode === 'TYPED') return { qty: storedSafe, source: 'typed' }
  if (mode === 'TAKEOFF') return { qty: storedSafe, source: 'takeoff' }
  if (args.inputQty != null && Number.isFinite(args.inputQty)) {
    return {
      qty: Math.max(0, args.inputQty),
      source: args.inputQtySource === 'derived' ? 'derived' : 'input',
    }
  }
  if (args.engineQty != null && Number.isFinite(args.engineQty)) {
    const engine = args.engineQty >= 0 ? args.engineQty : 0
    return { qty: engine, source: 'engine' }
  }
  return { qty: storedSafe, source: 'stored' }
}

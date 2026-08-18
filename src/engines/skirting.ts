/**
 * Skirting / baseboards — net linear metre.
 * Perimeter = 2×(L+W) or perimeter override;
 * door deduction = doorDeductionLm override or Σ(door width×count) from openings.
 */
import { round } from './math';

export type SkirtingInput = {
  count?: number;
  spec?: string;
  roomLabel?: string;
  roomLength?: number;
  roomWidth?: number;
  /** When set, used instead of 2×(L+W). */
  perimeter?: number | null;
  /** Explicit door-width deduction (lm). Wins over openings[]. */
  doorDeductionLm?: number | null;
  openings?: Array<{ type?: string; width?: number; count?: number }>;
  cornerCount?: number;
};

export type SkirtingCalcResult = {
  perUnit: {
    grossPerimeterM: number;
    doorDeductionLm: number;
    netLengthM: number;
    cornerCount: number;
  };
  count: number;
  totalLengthM: number;
  totalCorners: number;
  totalDoorDeductionLm: number;
};

export function doorWidthDeductionLm(
  openings: SkirtingInput['openings'],
  override?: number | null,
): number {
  if (override != null && Number.isFinite(Number(override)) && Number(override) >= 0) {
    return Number(override);
  }
  if (!Array.isArray(openings)) return 0;
  let sum = 0;
  for (const o of openings) {
    if (!o) continue;
    if (String(o.type || '').toLowerCase() !== 'door') continue;
    const w = Number(o.width) || 0;
    const c = Math.max(1, Math.floor(Number(o.count) || 1));
    sum += w * c;
  }
  return sum;
}

export function skirtingGrossPerimeter(f: SkirtingInput): number {
  if (f.perimeter != null && Number.isFinite(Number(f.perimeter)) && Number(f.perimeter) >= 0) {
    return Number(f.perimeter);
  }
  return 2 * ((f.roomLength || 0) + (f.roomWidth || 0));
}

export function calcSkirting(f: SkirtingInput): SkirtingCalcResult {
  const gross = skirtingGrossPerimeter(f);
  const doorLm = doorWidthDeductionLm(f.openings, f.doorDeductionLm);
  const net = Math.max(0, gross - doorLm);
  const corners = Math.max(0, Math.floor(f.cornerCount ?? 4));
  const n = f.count || 1;
  return {
    perUnit: {
      grossPerimeterM: round(gross),
      doorDeductionLm: round(doorLm),
      netLengthM: round(net),
      cornerCount: corners,
    },
    count: n,
    totalLengthM: round(net * n),
    totalCorners: corners * n,
    totalDoorDeductionLm: round(doorLm * n),
  };
}

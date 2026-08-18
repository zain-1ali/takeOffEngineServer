/**
 * Duct fittings & HVAC equipment — enumerated nos + equivalent length.
 */
import { round } from './math';

export type DuctFittingInput = {
  count?: number;
  spec?: string;
  fittingType?: string;
  equivalentLength?: number;
  width?: number;
  height?: number;
};

export type DuctFittingCalcResult = {
  perUnit: {
    equivalentLengthM: number;
  };
  count: number;
  totalNos: number;
  totalEquivalentLengthM: number;
};

/** Default equivalent lengths (m) by fitting type. */
export const DEFAULT_EQ_LENGTH: Record<string, number> = {
  Elbow: 1.5,
  Tee: 2.0,
  Reducer: 1.0,
  Damper: 0.5,
  VAV: 0,
  Diffuser: 0,
  AHU: 0,
  Other: 1.0,
};

export function resolveEquivalentLength(f: DuctFittingInput): number {
  if (
    f.equivalentLength != null &&
    Number.isFinite(Number(f.equivalentLength)) &&
    Number(f.equivalentLength) >= 0
  ) {
    return Number(f.equivalentLength);
  }
  const typ = String(f.fittingType || 'Other');
  return DEFAULT_EQ_LENGTH[typ] ?? DEFAULT_EQ_LENGTH.Other;
}

export function calcDuctFitting(f: DuctFittingInput): DuctFittingCalcResult {
  const eq = resolveEquivalentLength(f);
  const n = Math.max(1, f.count || 1);
  return {
    perUnit: { equivalentLengthM: round(eq) },
    count: n,
    totalNos: n,
    totalEquivalentLengthM: round(eq * n),
  };
}

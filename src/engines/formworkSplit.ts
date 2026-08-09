import { round } from './math';
import type { StructuralCalcResult } from './types';

/** Build structural totals with soffit vs vertical formwork split. */
export function withFormworkSplit(args: {
  perUnit: StructuralCalcResult['perUnit'];
  count: number;
  volumeM3: number;
  soffitFormworkM2: number;
  verticalFormworkM2: number;
  rebarKg: number;
}): StructuralCalcResult {
  const n = args.count || 1;
  const soffit = round(args.soffitFormworkM2 * n);
  const vertical = round(args.verticalFormworkM2 * n);
  return {
    perUnit: args.perUnit,
    count: n,
    totalVolumeM3: round(args.volumeM3 * n),
    totalFormworkM2: round(soffit + vertical),
    totalSoffitFormworkM2: soffit,
    totalVerticalFormworkM2: vertical,
    totalRebarKg: round(args.rebarKg * n),
  };
}

/** Vertical-only elements (foundations, walls, columns): all formwork → bracing. */
export function withVerticalFormworkOnly(args: {
  perUnit: StructuralCalcResult['perUnit'];
  count: number;
  volumeM3: number;
  formworkM2: number;
  rebarKg: number;
}): StructuralCalcResult {
  return withFormworkSplit({
    perUnit: args.perUnit,
    count: args.count,
    volumeM3: args.volumeM3,
    soffitFormworkM2: 0,
    verticalFormworkM2: args.formworkM2,
    rebarKg: args.rebarKg,
  });
}

/**
 * Doors & windows — enumerated units (nos).
 * Area = W×H×count; perimeter = 2(W+H)×count.
 */
import { round } from './math';

export type DoorsWindowsInput = {
  count?: number;
  spec?: string;
  openingType?: string;
  width?: number;
  height?: number;
};

export type DoorsWindowsCalcResult = {
  perUnit: {
    openingAreaM2: number;
    perimeterM: number;
  };
  count: number;
  totalNos: number;
  totalOpeningAreaM2: number;
  totalPerimeterM: number;
};

export function calcDoorsWindows(f: DoorsWindowsInput): DoorsWindowsCalcResult {
  const w = f.width || 0;
  const h = f.height || 0;
  const n = Math.max(1, f.count || 1);
  const area = w * h;
  const peri = 2 * (w + h);
  return {
    perUnit: {
      openingAreaM2: round(area),
      perimeterM: round(peri),
    },
    count: n,
    totalNos: n,
    totalOpeningAreaM2: round(area * n),
    totalPerimeterM: round(peri * n),
  };
}

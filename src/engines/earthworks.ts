import { round } from './math';
import type { MaterialsConfig } from './types';

export type EarthworkShape =
  | 'ISOLATED_PIT'
  | 'LINEAR_TRENCH'
  | 'BULK_BASIN';

export type EarthworkInput = {
  shape: EarthworkShape;
  count?: number;
  length: number;
  width?: number;
  trenchWidth?: number;
  depth: number;
};

export type EarthworkCalcResult = {
  perUnit: {
    excavationVolumeM3: number;
    disposalVolumeM3: number;
    bulkingFactor: number;
  };
  count: number;
  totalExcavationM3: number;
  totalDisposalM3: number;
};

export function earthworkPlanArea(f: EarthworkInput): number {
  const width =
    f.shape === 'LINEAR_TRENCH' ? f.trenchWidth || 0 : f.width || 0;
  return f.length * width;
}

export function calcEarthwork(
  f: EarthworkInput,
  materials: MaterialsConfig = {},
): EarthworkCalcResult {
  const bulkingFactor = materials.earthworkBulkingFactor ?? 0.25;
  const excavation = round(earthworkPlanArea(f) * f.depth);
  const disposal = round(excavation * (1 + bulkingFactor));
  const n = f.count || 1;
  return {
    perUnit: {
      excavationVolumeM3: excavation,
      disposalVolumeM3: disposal,
      bulkingFactor,
    },
    count: n,
    totalExcavationM3: round(excavation * n),
    totalDisposalM3: round(disposal * n),
  };
}

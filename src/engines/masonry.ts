/**
 * Masonry / infill walls — net face area + volume + mortar.
 * Face = Len×Ht − openings (or areaOverride); vol = face × thickness;
 * mortar = vol × stoneMortarFraction (project materials).
 */
import { round } from './math';
import { DEFAULT_MATERIALS, type MaterialsConfig } from './types';

export type MasonryInput = {
  count?: number;
  spec?: string;
  wallLength?: number;
  wallHeight?: number;
  thickness?: number;
  openingArea?: number;
  areaOverride?: number | null;
};

export type MasonryCalcResult = {
  perUnit: {
    faceAreaM2: number;
    masonryM3: number;
    mortarM3: number;
  };
  count: number;
  totalAreaM2: number;
  totalMasonryM3: number;
  totalMortarM3: number;
  areaFromOverride: boolean;
};

export function hasMasonryAreaOverride(f: MasonryInput): boolean {
  const v = f.areaOverride;
  return v != null && Number.isFinite(Number(v)) && Number(v) >= 0;
}

export function masonryNetFaceM2(f: MasonryInput): number {
  if (hasMasonryAreaOverride(f)) {
    return Math.max(0, Number(f.areaOverride));
  }
  const opening = f.openingArea || 0;
  return Math.max(0, (f.wallLength || 0) * (f.wallHeight || 0) - opening);
}

export function calcMasonry(
  f: MasonryInput,
  materials: MaterialsConfig = {},
): MasonryCalcResult {
  const m = { ...DEFAULT_MATERIALS, ...materials };
  const areaFromOverride = hasMasonryAreaOverride(f);
  const face = masonryNetFaceM2(f);
  const thickness = f.thickness != null && f.thickness > 0 ? f.thickness : 0.2;
  const masonryM3 = face * thickness;
  const frac = m.stoneMortarFraction ?? DEFAULT_MATERIALS.stoneMortarFraction ?? 0.3;
  const mortarM3 = masonryM3 * frac;
  const n = f.count || 1;
  return {
    perUnit: {
      faceAreaM2: round(face),
      masonryM3: round(masonryM3),
      mortarM3: round(mortarM3),
    },
    count: n,
    totalAreaM2: round(face * n),
    totalMasonryM3: round(masonryM3 * n),
    totalMortarM3: round(mortarM3 * n),
    areaFromOverride,
  };
}

/**
 * Air distribution ducts — centreline length + surface / weight / joints.
 */
import { round } from './math';

export type DuctSection = 'Rectangular' | 'Round';

export type DuctInput = {
  count?: number;
  spec?: string;
  system?: string;
  section?: DuctSection;
  width?: number;
  height?: number;
  diameter?: number;
  length?: number;
  jointSpacing?: number;
  sheetDensityKgPerM2?: number;
};

export type DuctCalcResult = {
  perUnit: {
    lengthM: number;
    surfaceM2: number;
    weightKg: number;
    joints: number;
  };
  count: number;
  totalLengthM: number;
  totalSurfaceM2: number;
  totalWeightKg: number;
  totalJoints: number;
};

export function ductSurfaceM2(f: DuctInput): number {
  const L = f.length || 0;
  if (L <= 0) return 0;
  if ((f.section || 'Rectangular') === 'Round') {
    const d = f.diameter || 0;
    return Math.PI * d * L;
  }
  return 2 * ((f.width || 0) + (f.height || 0)) * L;
}

export function ductJoints(f: DuctInput): number {
  const L = f.length || 0;
  if (L <= 0) return 0;
  const spacing = f.jointSpacing != null && f.jointSpacing > 0 ? f.jointSpacing : 1.2;
  return Math.max(0, Math.ceil(L / spacing) - 1);
}

export function calcDuct(f: DuctInput): DuctCalcResult {
  const L = Math.max(0, f.length || 0);
  const surface = ductSurfaceM2(f);
  const density =
    f.sheetDensityKgPerM2 != null && f.sheetDensityKgPerM2 > 0
      ? f.sheetDensityKgPerM2
      : 8;
  const weight = surface * density;
  const joints = ductJoints(f);
  const n = f.count || 1;
  return {
    perUnit: {
      lengthM: round(L),
      surfaceM2: round(surface),
      weightKg: round(weight),
      joints,
    },
    count: n,
    totalLengthM: round(L * n),
    totalSurfaceM2: round(surface * n),
    totalWeightKg: round(weight * n),
    totalJoints: joints * n,
  };
}

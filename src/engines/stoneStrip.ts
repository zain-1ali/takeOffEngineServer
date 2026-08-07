/**
 * Stone strip foundation (masonry) — ported from AgileQS-Takeoff.html
 * (stoneMasonryVolume, calcStone). Math unchanged.
 *
 * Materials knobs (mortar fraction, blinding thickness) are passed in
 * instead of reading a global `state`, matching backend purity.
 */
import { round } from './math';
import { DEFAULT_MATERIALS, type MaterialsConfig } from './types';

export type StoneShape = 'RECTANGULAR' | 'TRAPEZOIDAL' | 'STEPPED';

export type StoneStripInput = {
  shape: StoneShape;
  count?: number;
  length: number;
  width?: number;
  height?: number;
  baseWidth?: number;
  topWidth?: number;
  baseHeight?: number;
  upperWidth?: number;
  upperHeight?: number;
  hasBlinding?: boolean;
};

export type StoneCalcResult = {
  perUnit: { masonryM3: number; mortarM3: number; blindingM3: number };
  count: number;
  totalMasonryM3: number;
  totalMortarM3: number;
  totalBlindingM3: number;
};

export function stoneBaseWidth(f: StoneStripInput): number {
  return f.shape === 'RECTANGULAR' ? f.width || 0 : f.baseWidth || 0;
}

export function stoneTotalHeight(f: StoneStripInput): number {
  return f.shape === 'STEPPED' ? (f.baseHeight || 0) + (f.upperHeight || 0) : f.height || 0;
}

export function stoneMasonryVolume(f: StoneStripInput): number {
  if (f.shape === 'RECTANGULAR') return f.length * (f.width || 0) * (f.height || 0);
  if (f.shape === 'TRAPEZOIDAL') {
    return (((f.baseWidth || 0) + (f.topWidth || 0)) / 2) * (f.height || 0) * f.length;
  }
  return (
    f.length *
    ((f.baseWidth || 0) * (f.baseHeight || 0) + (f.upperWidth || 0) * (f.upperHeight || 0))
  );
}

export function calcStone(
  f: StoneStripInput,
  materials: MaterialsConfig = {},
): StoneCalcResult {
  const mas = stoneMasonryVolume(f);
  const mortarFrac = materials.stoneMortarFraction ?? DEFAULT_MATERIALS.stoneMortarFraction;
  const mortar = mas * mortarFrac;
  const blindingT = materials.blindingThickness ?? DEFAULT_MATERIALS.blindingThickness;
  const blinding = f.hasBlinding ? f.length * (stoneBaseWidth(f) + 0.1) * blindingT : 0;
  const n = f.count || 1;
  return {
    perUnit: { masonryM3: round(mas), mortarM3: round(mortar), blindingM3: round(blinding) },
    count: n,
    totalMasonryM3: round(mas * n),
    totalMortarM3: round(mortar * n),
    totalBlindingM3: round(blinding * n),
  };
}

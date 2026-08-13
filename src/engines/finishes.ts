/**
 * Floor / wall / ceiling finish calculators — ported from the `calc`
 * closure inside makeFinishEngine in AgileQS-Takeoff.html. Math unchanged.
 */
import { round } from './math';
import { DEFAULT_MATERIALS, type MaterialsConfig } from './types';

export type FinishKind = 'FLOOR' | 'WALL' | 'CEILING';

export type FinishInput = {
  count?: number;
  spec: string;
  roomLength?: number;
  roomWidth?: number;
  wallLength?: number;
  wallHeight?: number;
  /** Opening / void area deducted from L×W (or Len×Ht) when no override. */
  openingArea?: number;
  /**
   * When set (finite ≥ 0), used as net area for all downstream calc —
   * bypasses L×W / Len×Ht and opening deduction.
   */
  areaOverride?: number | null;
  /** Per-instance tile wastage fraction; falls back to project materials. */
  tileWastage?: number | null;
};

export type FinishCalcResult = {
  perUnit: {
    areaM2: number;
    screedM3: number;
    plasterM3: number;
    paintL: number;
    tilesM2: number;
  };
  count: number;
  totalAreaM2: number;
  totalScreedM3: number;
  totalPlasterM3: number;
  totalPaintL: number;
  totalTilesM2: number;
  /** True when areaOverride drove net area (vs L×W / Len×Ht − openings). */
  areaFromOverride: boolean;
};

/** True when the caller supplied a usable area override. */
export function hasAreaOverride(f: FinishInput): boolean {
  const v = f.areaOverride;
  return v != null && Number.isFinite(Number(v)) && Number(v) >= 0;
}

export function finishNetArea(kind: FinishKind, f: FinishInput): number {
  if (hasAreaOverride(f)) {
    return Math.max(0, Number(f.areaOverride));
  }
  const opening = f.openingArea || 0;
  if (kind === 'WALL') {
    return Math.max(0, (f.wallLength || 0) * (f.wallHeight || 0) - opening);
  }
  // FLOOR / CEILING — L×W minus openings/voids
  return Math.max(0, (f.roomLength || 0) * (f.roomWidth || 0) - opening);
}

function resolveTileWastage(f: FinishInput, materials: MaterialsConfig): number {
  const inst = f.tileWastage;
  if (inst != null && Number.isFinite(Number(inst)) && Number(inst) >= 0) {
    return Number(inst);
  }
  return materials.tileWastage ?? DEFAULT_MATERIALS.tileWastage ?? 0.1;
}

export function calcFinish(
  kind: FinishKind,
  f: FinishInput,
  materials: MaterialsConfig = {},
): FinishCalcResult {
  const m = { ...DEFAULT_MATERIALS, ...materials };
  const areaFromOverride = hasAreaOverride(f);
  const area = finishNetArea(kind, f);
  const n = f.count || 1;
  const tileWastage = resolveTileWastage(f, m);
  let screed = 0;
  let plaster = 0;
  let paintL = 0;
  let tilesM2 = 0;

  if (kind === 'FLOOR') {
    screed = area * (m.screedThickness || 0.05);
    if (/tile/i.test(f.spec)) tilesM2 = area * (1 + tileWastage);
  } else if (kind === 'WALL') {
    if (/tile/i.test(f.spec)) tilesM2 = area * (1 + tileWastage);
    else {
      plaster = area * (m.plasterThickness || 0.015);
      paintL = (area * (m.paintCoats || 2)) / 10; // ~10 m²/L/coat
    }
  } else {
    // CEILING
    if (/paint|skim|plaster/i.test(f.spec)) {
      plaster = area * (m.plasterThickness || 0.015) * 0.7;
      paintL = (area * (m.paintCoats || 2)) / 10;
    }
  }

  return {
    perUnit: {
      areaM2: round(area),
      screedM3: round(screed),
      plasterM3: round(plaster),
      paintL: round(paintL, 1),
      tilesM2: round(tilesM2),
    },
    count: n,
    totalAreaM2: round(area * n),
    totalScreedM3: round(screed * n),
    totalPlasterM3: round(plaster * n),
    totalPaintL: round(paintL * n, 1),
    totalTilesM2: round(tilesM2 * n),
    areaFromOverride,
  };
}

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
  openingArea?: number;
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
};

export function finishNetArea(kind: FinishKind, f: FinishInput): number {
  if (kind === 'WALL') {
    return Math.max(0, (f.wallLength || 0) * (f.wallHeight || 0) - (f.openingArea || 0));
  }
  return (f.roomLength || 0) * (f.roomWidth || 0);
}

export function calcFinish(
  kind: FinishKind,
  f: FinishInput,
  materials: MaterialsConfig = {},
): FinishCalcResult {
  const m = { ...DEFAULT_MATERIALS, ...materials };
  const area = finishNetArea(kind, f);
  const n = f.count || 1;
  let screed = 0;
  let plaster = 0;
  let paintL = 0;
  let tilesM2 = 0;

  if (kind === 'FLOOR') {
    screed = area * (m.screedThickness || 0.05);
    if (/tile/i.test(f.spec)) tilesM2 = area * (1 + (m.tileWastage || 0.1));
  } else if (kind === 'WALL') {
    if (/tile/i.test(f.spec)) tilesM2 = area * (1 + (m.tileWastage || 0.1));
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
  };
}

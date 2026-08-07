import {
  calcFinish,
  calcFooting,
  calcEarthwork,
  calcPile,
  calcPileCap,
  calcRaft,
  calcStone,
  calcStrip,
  calcWall,
  type FinishKind,
  type MaterialsConfig,
  type StructuralCalcResult,
} from './engines';
import {
  buildFinishReports,
  buildEarthworkReports,
  buildStoneReports,
  buildStructuralReports,
  type ReportEntry,
  type StructuralCalculator,
} from './services/reports/builders';
import { ELEMENT_META, type ElementKind, type ElementMeta } from './services/reports/elementMeta';
import type { RateAccessors } from './services/reports/pricing';
import type { ElementReportBundle } from './services/reports/types';

export type ElementEngine = {
  key: string;
  label: string;
  reportKind: ElementKind;
  calc: (flat: Record<string, unknown>, materials: MaterialsConfig) => unknown;
  buildReports: (
    entries: ReportEntry[],
    materials: MaterialsConfig & { stoneMortarRatio?: string },
    rates: RateAccessors,
  ) => ElementReportBundle;
};

function structuralEngine(
  key: 'PAD_FOOTING' | 'STRIP_FOOTING' | 'RAFT' | 'PILE_CAP' | 'PILES' | 'WALLS',
  calc: (flat: any) => StructuralCalcResult,
): ElementEngine {
  const meta = ELEMENT_META[key];
  const calculate: StructuralCalculator = (_elementKey, flat) => calc(flat);
  return {
    key,
    label: meta.label,
    reportKind: 'structural',
    calc: (flat) => calc(flat),
    buildReports: (entries, _materials, rates) =>
      buildStructuralReports(meta, entries, rates, calculate),
  };
}

function finishEngine(
  key: 'FLOOR_FINISH' | 'WALL_FINISH' | 'CEILING_FINISH',
  kind: FinishKind,
): ElementEngine {
  const meta = ELEMENT_META[key];
  return {
    key,
    label: meta.label,
    reportKind: 'finish',
    calc: (flat, materials) => calcFinish(kind, flat as any, materials),
    buildReports: (entries, materials, rates) =>
      buildFinishReports(key, kind, entries, materials, rates),
  };
}

/**
 * Backend element registry: calculation and reporting dispatch share one
 * extensibility point. Entries preserve the Phase 1 engine contracts.
 */
export const ELEMENT_ENGINES: Record<string, ElementEngine> = {
  PAD_FOOTING: structuralEngine('PAD_FOOTING', calcFooting),
  STRIP_FOOTING: structuralEngine('STRIP_FOOTING', calcStrip),
  RAFT: structuralEngine('RAFT', calcRaft),
  PILE_CAP: structuralEngine('PILE_CAP', calcPileCap),
  PILES: structuralEngine('PILES', calcPile),
  EARTHWORKS: {
    key: 'EARTHWORKS',
    label: ELEMENT_META.EARTHWORKS.label,
    reportKind: 'earthworks',
    calc: (flat, materials) => calcEarthwork(flat as any, materials),
    buildReports: (entries, materials, rates) =>
      buildEarthworkReports(entries, materials, rates),
  },
  STONE_STRIP: {
    key: 'STONE_STRIP',
    label: ELEMENT_META.STONE_STRIP.label,
    reportKind: 'masonry',
    calc: (flat, materials) => calcStone(flat as any, materials),
    buildReports: (entries, materials, rates) =>
      buildStoneReports(entries, materials, rates),
  },
  WALLS: structuralEngine('WALLS', calcWall),
  FLOOR_FINISH: finishEngine('FLOOR_FINISH', 'FLOOR'),
  WALL_FINISH: finishEngine('WALL_FINISH', 'WALL'),
  CEILING_FINISH: finishEngine('CEILING_FINISH', 'CEILING'),
};

export const SUPPORTED_ELEMENT_KEYS = Object.keys(ELEMENT_ENGINES);

export function requireElementEngine(elementKey: string): ElementEngine {
  const engine = ELEMENT_ENGINES[elementKey];
  if (!engine) throw new Error(`Unsupported elementKey: ${elementKey}`);
  return engine;
}

export function structuralCalculator(
  elementKey: string,
  flat: Record<string, unknown>,
): StructuralCalcResult {
  const engine = requireElementEngine(elementKey);
  if (engine.reportKind !== 'structural') {
    throw new Error(`Not structural: ${elementKey}`);
  }
  return engine.calc(flat, {}) as StructuralCalcResult;
}

export function engineMeta(elementKey: string): ElementMeta | undefined {
  return ELEMENT_META[elementKey];
}

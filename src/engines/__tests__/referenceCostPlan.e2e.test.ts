/**
 * End-to-end Cost Plan verification against client reference PDF:
 * "Takeoff Studio · Zero QS.pdf"
 *
 * Recreates elemental lines (pad footing excavation/concrete/formwork,
 * block wall, three manual Item entries) and asserts every cascade
 * figure matches the PDF exactly.
 */
import { Types } from 'mongoose';
import { buildCostPlan } from '../../services/costPlan/buildCostPlan';
import { lineAmount } from '../../services/reports/pricing';
import { round } from '../math';
import type { IInstance } from '../../models/Instance';
import type { IProject } from '../../models/Project';
import { DEFAULT_MATERIALS, DEFAULT_RATE_LIB } from '../../defaults/projectDefaults';

/** Exact line items transcribed from Takeoff Studio · Zero QS.pdf */
const REF = {
  currency: 'RWF',
  designAllowancePercent: 6,
  overheadPercent: 9,
  profitPercent: 5,
  inflationPercent: 3.5,
  /** Combined OH+P as shown on Z60 row in the PDF */
  ohpCombinedPercent: 14,
  lines: [
    {
      section: 'A1010',
      description: 'Excavation to reinforced concrete pad footing',
      qty: 90.1125,
      unit: 'm³',
      rate: 33.34,
      amount: 3004.35,
    },
    {
      section: 'A1010',
      description: 'Reinforced concrete (25 MPa) to pad footing',
      qty: 10.0125,
      unit: 'm³',
      rate: 310.81,
      amount: 3111.99,
    },
    {
      section: 'A1010',
      description: 'Reinforced concrete (25 MPa) to pad footing',
      qty: 60.075,
      unit: 'm³',
      rate: 310.81,
      amount: 18671.91,
    },
    {
      section: 'A1010',
      description: 'Formwork to reinforced concrete pad footing',
      qty: 160.2,
      unit: 'm²',
      rate: 37.71,
      amount: 6041.14,
    },
    {
      section: 'B2010',
      description: 'Setting Out to concrete blocks block wall',
      qty: 57.12,
      unit: 'nr',
      rate: 3446.5,
      amount: 196864.08,
    },
    {
      section: 'Z9990',
      description: 'Survey control for setting out – pad footing',
      qty: 1,
      unit: 'Item',
      rate: 231932.5,
      amount: 231932.5,
    },
    {
      section: 'Z9990',
      description: 'Marking positions for setting out - pad footing',
      qty: 1,
      unit: 'Item',
      rate: 31.87,
      amount: 31.87,
    },
    {
      section: 'Z9990',
      description: 'Level verification for setting out - pad footing',
      qty: 1,
      unit: 'Item',
      rate: 3107.5,
      amount: 3107.5,
    },
  ],
  subtotals: {
    A1010: 30829.39,
    B2010: 196864.08,
    Z9990: 235071.87,
    elemental: 462765.34,
  },
  cascade: {
    designAllowanceAmount: 27765.92,
    elementalWithDesignAllowance: 490531.26,
    overheadAmount: 44147.81,
    profitAmount: 24526.56,
    ohpCombined: 68674.37,
    constructionCostWithoutInflation: 559205.63,
    inflationAmount: 19572.2,
    constructionCostSCC: 578777.83,
    percentOfElemental: {
      elemental: 100,
      withDesignAllowance: 106,
      withoutInflation: 120.84,
      scc: 125.07,
    },
  },
} as const;

function manualFromRef(line: (typeof REF.lines)[number]) {
  return {
    description: line.description,
    unit: line.unit,
    quantity: line.qty,
    labourMode: 'none' as const,
    outputPerDay: null,
    gangDescription: null,
    appliedUnitRate: line.rate,
    appliedBomUnitLines: [],
    appliedLabUnitLines: [],
    uniformatCode: line.section,
  };
}

describe('Reference PDF: Takeoff Studio · Zero QS', () => {
  const project = {
    currency: REF.currency,
    useRateAnalysis: false,
    materials: DEFAULT_MATERIALS,
    rateLib: DEFAULT_RATE_LIB,
    designAllowancePercent: REF.designAllowancePercent,
    overheadPercent: REF.overheadPercent,
    profitPercent: REF.profitPercent,
    inflationPercent: REF.inflationPercent,
    gfaM2: null,
    reportTheme: 'zero-qs',
  } as IProject;

  it('qty × rate rounds to PDF line amounts (QS 2dp)', () => {
    const mismatches: string[] = [];
    for (const line of REF.lines) {
      const raw = line.qty * line.rate;
      const rounded = round(raw);
      if (rounded !== line.amount) {
        mismatches.push(
          `${line.description}: round(${line.qty}×${line.rate})=${rounded}, PDF=${line.amount}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('lineAmount rounds qty×rate to 2dp (QS / PDF)', () => {
    expect(lineAmount(90.1125, 33.34)).toBe(3004.35);
    expect(lineAmount(10.0125, 310.81)).toBe(3111.99);
    expect(lineAmount(60.075, 310.81)).toBe(18671.91);
    expect(lineAmount(160.2, 37.71)).toBe(6041.14);
    expect(lineAmount(57.12, 3446.5)).toBe(196864.08);
  });

  it('Cost Plan from reference Manual Item lines matches PDF cascade & SCC exactly', () => {
    const plan = buildCostPlan(
      project,
      [],
      { scope: 'project' },
      REF.lines.map(manualFromRef),
    );

    const discrepancies: string[] = [];

    const a1010 = plan.groups.flatMap((g) => g.codes).find((c) => c.code === 'A1010');
    const b2010 = plan.groups.flatMap((g) => g.codes).find((c) => c.code === 'B2010');
    const z9990 = plan.groups.flatMap((g) => g.codes).find((c) => c.code === 'Z9990');

    const checkExact = (label: string, actual: number | undefined | null, expected: number) => {
      if (actual !== expected) {
        discrepancies.push(`${label}: got ${actual}, expected ${expected}`);
      }
    };

    // Exact (no rounding) — surfaces float/lineAmount drift vs PDF printed figures
    checkExact('A1010 subtotal (exact)', a1010?.subtotal, REF.subtotals.A1010);
    checkExact('B2010 subtotal (exact)', b2010?.subtotal, REF.subtotals.B2010);
    checkExact('Z9990 subtotal (exact)', z9990?.subtotal, REF.subtotals.Z9990);
    checkExact('grandTotal (exact)', plan.grandTotal, REF.subtotals.elemental);
    checkExact('cascade.elementalCost', plan.cascade.elementalCost, REF.subtotals.elemental);
    checkExact(
      'designAllowanceAmount',
      plan.cascade.designAllowanceAmount,
      REF.cascade.designAllowanceAmount,
    );
    checkExact(
      'elementalWithDesignAllowance',
      plan.cascade.elementalWithDesignAllowance,
      REF.cascade.elementalWithDesignAllowance,
    );
    checkExact('overheadAmount', plan.cascade.overheadAmount, REF.cascade.overheadAmount);
    checkExact('profitAmount', plan.cascade.profitAmount, REF.cascade.profitAmount);
    checkExact(
      'OH+P combined',
      round(plan.cascade.overheadAmount + plan.cascade.profitAmount),
      REF.cascade.ohpCombined,
    );
    checkExact(
      'constructionCostWithoutInflation',
      plan.cascade.constructionCostWithoutInflation,
      REF.cascade.constructionCostWithoutInflation,
    );
    checkExact('inflationAmount', plan.cascade.inflationAmount, REF.cascade.inflationAmount);
    checkExact(
      'constructionCostSCC',
      plan.cascade.constructionCostSCC,
      REF.cascade.constructionCostSCC,
    );
    checkExact(
      '% elemental',
      plan.cascade.percentOfElemental.elemental,
      REF.cascade.percentOfElemental.elemental,
    );
    checkExact(
      '% with DA',
      plan.cascade.percentOfElemental.withDesignAllowance,
      REF.cascade.percentOfElemental.withDesignAllowance,
    );
    checkExact(
      '% without inflation',
      plan.cascade.percentOfElemental.withoutInflation,
      REF.cascade.percentOfElemental.withoutInflation,
    );
    checkExact(
      '% SCC',
      plan.cascade.percentOfElemental.scc,
      REF.cascade.percentOfElemental.scc,
    );

    for (const refLine of REF.lines) {
      const found = plan.lines.find(
        (l) => l.kind === 'item' && l.description === refLine.description && l.qty === refLine.qty,
      );
      if (!found) {
        discrepancies.push(`missing line: ${refLine.description} qty=${refLine.qty}`);
        continue;
      }
      if (found.amount !== refLine.amount) {
        discrepancies.push(
          `line amount "${refLine.description}": got ${found.amount}, expected ${refLine.amount}`,
        );
      }
      if (found.rate !== refLine.rate) {
        discrepancies.push(
          `line rate "${refLine.description}": got ${found.rate}, expected ${refLine.rate}`,
        );
      }
    }

    if (discrepancies.length) {
      throw new Error(
        `Reference PDF mismatches (${discrepancies.length}):\n- ${discrepancies.join('\n- ')}`,
      );
    }
  });

  it('documents modelled pad footing structural gaps vs PDF Cost Plan', () => {
    /**
     * PDF A1010 includes excavation + two unaggregated concrete lines + formwork,
     * and omits rebar. Our PAD_FOOTING engine emits aggregated concrete + formwork + rebar
     * and never emits excavation under A1010 (earthworks is G20).
     */
    const gaps = [
      'PDF lists Excavation under A1010; modelled PAD_FOOTING has no excavation BOQ line (EARTHWORKS → G20).',
      'PDF lists two separate concrete qty lines (10.0125 + 60.075); engine aggregates by grade into one line.',
      'PDF Cost Plan omits reinforcement; engine always emits rebar lines when steel > 0.',
      'PDF B2010 block wall is unit nr @ 57.12; MASONRY/WALLS engines measure m²/m³, not Setting-Out nr.',
      'PDF section title is "Z - GENERAL …"; we bucket unclassified manuals as Z9990 Unclassified.',
      'PDF shows combined Z60 Overhead & Profit 14% row; we only emit separate Overhead 9% and Profit 5% rows (amounts still match).',
    ];
    expect(gaps.length).toBeGreaterThan(0);
    // Soft assertion marker so the suite records these known product gaps
    expect(gaps.join('\n')).toContain('Excavation under A1010');
  });
});

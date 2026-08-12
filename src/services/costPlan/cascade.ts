/**
 * Cost Plan Design Allowance / OH&P / Inflation cascade.
 * Percents are stored as percentage points (6 = 6%).
 * Amounts are rounded to 2dp at each step so cumulative totals match QS practice.
 */
import { round } from '../../engines/math';

export type CascadePercents = {
  designAllowancePercent: number;
  overheadPercent: number;
  profitPercent: number;
  inflationPercent: number;
};

export type CostPlanSummaryLine = {
  kind: 'stage' | 'addon' | 'total';
  description: string;
  amount: number;
  /** Only on cumulative stage / total rows. */
  percentOfElemental?: number;
  /** Applied % for addon rows (e.g. 6 for Design Allowance). */
  percentApplied?: number;
  ratePerM2?: number;
};

export type CostPlanCascade = CascadePercents & {
  elementalCost: number;
  designAllowanceAmount: number;
  elementalWithDesignAllowance: number;
  overheadAmount: number;
  profitAmount: number;
  constructionCostWithoutInflation: number;
  inflationAmount: number;
  constructionCostSCC: number;
  /** Cumulative totals ÷ elementalCost × 100 (2dp). */
  percentOfElemental: {
    elemental: number;
    withDesignAllowance: number;
    withoutInflation: number;
    scc: number;
  };
  summaryLines: CostPlanSummaryLine[];
};

export const DEFAULT_CASCADE_PERCENTS: CascadePercents = {
  designAllowancePercent: 6,
  overheadPercent: 9,
  profitPercent: 5,
  inflationPercent: 3.5,
};

export function normalizeCascadePercent(raw: unknown, fallback: number): number {
  if (raw === null || raw === '' || raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function resolveCascadePercents(project: {
  designAllowancePercent?: number | null;
  overheadPercent?: number | null;
  profitPercent?: number | null;
  inflationPercent?: number | null;
}): CascadePercents {
  return {
    designAllowancePercent: normalizeCascadePercent(
      project.designAllowancePercent,
      DEFAULT_CASCADE_PERCENTS.designAllowancePercent,
    ),
    overheadPercent: normalizeCascadePercent(
      project.overheadPercent,
      DEFAULT_CASCADE_PERCENTS.overheadPercent,
    ),
    profitPercent: normalizeCascadePercent(
      project.profitPercent,
      DEFAULT_CASCADE_PERCENTS.profitPercent,
    ),
    inflationPercent: normalizeCascadePercent(
      project.inflationPercent,
      DEFAULT_CASCADE_PERCENTS.inflationPercent,
    ),
  };
}

function pctOfElemental(amount: number, elementalCost: number): number {
  if (!(elementalCost > 0)) return 0;
  return round((amount / elementalCost) * 100);
}

function fmtPct(p: number): string {
  return Number.isInteger(p) ? String(p) : String(p);
}

/**
 * Exact cascade verified against client reference:
 * OH and Profit both use elementalWithDesignAllowance (do not compound on each other).
 */
export function computeCostPlanCascade(
  elementalCostRaw: number,
  percents: CascadePercents,
  opts?: { gfaM2?: number | null },
): CostPlanCascade {
  const elementalCost = round(Number(elementalCostRaw) || 0);

  const designAllowanceAmount = round(
    elementalCost * (percents.designAllowancePercent / 100),
  );
  const elementalWithDesignAllowance = round(
    elementalCost + designAllowanceAmount,
  );

  const overheadAmount = round(
    elementalWithDesignAllowance * (percents.overheadPercent / 100),
  );
  const profitAmount = round(
    elementalWithDesignAllowance * (percents.profitPercent / 100),
  );
  const constructionCostWithoutInflation = round(
    elementalWithDesignAllowance + overheadAmount + profitAmount,
  );

  const inflationAmount = round(
    constructionCostWithoutInflation * (percents.inflationPercent / 100),
  );
  const constructionCostSCC = round(
    constructionCostWithoutInflation + inflationAmount,
  );

  const percentOfElemental = {
    elemental: elementalCost > 0 ? 100 : 0,
    withDesignAllowance: pctOfElemental(
      elementalWithDesignAllowance,
      elementalCost,
    ),
    withoutInflation: pctOfElemental(
      constructionCostWithoutInflation,
      elementalCost,
    ),
    scc: pctOfElemental(constructionCostSCC, elementalCost),
  };

  const gfa =
    opts?.gfaM2 != null && Number(opts.gfaM2) > 0 ? Number(opts.gfaM2) : null;

  const withRate = (amount: number): { ratePerM2?: number } =>
    gfa != null ? { ratePerM2: round(amount / gfa) } : {};

  const summaryLines: CostPlanSummaryLine[] = [
    {
      kind: 'stage',
      description: 'Elemental Cost',
      amount: elementalCost,
      percentOfElemental: percentOfElemental.elemental,
      ...withRate(elementalCost),
    },
    {
      kind: 'addon',
      description: `Design Allowance @ ${fmtPct(percents.designAllowancePercent)}%`,
      amount: designAllowanceAmount,
      percentApplied: percents.designAllowancePercent,
      ...withRate(designAllowanceAmount),
    },
    {
      kind: 'stage',
      description: 'Elemental Cost including Design Allowance',
      amount: elementalWithDesignAllowance,
      percentOfElemental: percentOfElemental.withDesignAllowance,
      ...withRate(elementalWithDesignAllowance),
    },
    {
      kind: 'addon',
      description: `Overheads @ ${fmtPct(percents.overheadPercent)}%`,
      amount: overheadAmount,
      percentApplied: percents.overheadPercent,
      ...withRate(overheadAmount),
    },
    {
      kind: 'addon',
      description: `Profit @ ${fmtPct(percents.profitPercent)}%`,
      amount: profitAmount,
      percentApplied: percents.profitPercent,
      ...withRate(profitAmount),
    },
    {
      kind: 'stage',
      description: 'Construction Cost excluding Inflation',
      amount: constructionCostWithoutInflation,
      percentOfElemental: percentOfElemental.withoutInflation,
      ...withRate(constructionCostWithoutInflation),
    },
    {
      kind: 'addon',
      description: `Inflation @ ${fmtPct(percents.inflationPercent)}%`,
      amount: inflationAmount,
      percentApplied: percents.inflationPercent,
      ...withRate(inflationAmount),
    },
    {
      kind: 'total',
      description: 'CONSTRUCTION COST (SCC)',
      amount: constructionCostSCC,
      percentOfElemental: percentOfElemental.scc,
      ...withRate(constructionCostSCC),
    },
  ];

  return {
    ...percents,
    elementalCost,
    designAllowanceAmount,
    elementalWithDesignAllowance,
    overheadAmount,
    profitAmount,
    constructionCostWithoutInflation,
    inflationAmount,
    constructionCostSCC,
    percentOfElemental,
    summaryLines,
  };
}

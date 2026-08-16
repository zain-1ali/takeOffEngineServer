/**
 * Pure Manual BOQ pricing / report helpers (no Mongoose).
 * Applied snapshots follow the same revision gate as mix ratios.
 */
import { analyseRate, round } from '../engines';
import type { RateLib } from '../engines/rateAnalysis';
import type {
  AppliedBomUnitLine,
  AppliedLabUnitLine,
  ManualBoqLabourMode,
  ManualBoqLinkKind,
  ManualBoqResourceGroup,
} from '../models/ManualBoqItem';
import type { LabourActivity, ReportLine, TradeSummary } from './reports/types';
import { lineAmount } from './reports/pricing';

export type ManualBoqInput = {
  floorId?: string | null;
  description: string;
  unit: string;
  quantity: number;
  linkKind?: ManualBoqLinkKind;
  analysisCode?: string | null;
  resourceGroup?: ManualBoqResourceGroup | null;
  resourceCode?: string | null;
  labourMode?: ManualBoqLabourMode;
  outputPerDay?: number | null;
  gangDescription?: string | null;
  uniformatCode?: string | null;
  /** Direct rate when linkKind is none (lump-sum Item lines). */
  unitRate?: number | null;
};

export type ManualRateSnapshot = {
  appliedUnitRate: number | null;
  appliedBomUnitLines: AppliedBomUnitLine[];
  appliedLabUnitLines: AppliedLabUnitLine[];
  appliedAtRevision: string | null;
};

/** Plain shape used for report building (avoids Mongoose DocumentArray typing). */
export type ManualBoqReportItem = {
  floorId?: string | null;
  description: string;
  unit: string;
  quantity: number;
  labourMode: ManualBoqLabourMode;
  outputPerDay: number | null;
  gangDescription: string | null;
  appliedUnitRate: number | null;
  appliedBomUnitLines: AppliedBomUnitLine[];
  appliedLabUnitLines: AppliedLabUnitLine[];
  uniformatCode?: string | null;
};

export function resolveManualRateSnapshot(
  input: Pick<
    ManualBoqInput,
    | 'linkKind'
    | 'analysisCode'
    | 'resourceGroup'
    | 'resourceCode'
    | 'labourMode'
    | 'unitRate'
  >,
  rateLib: RateLib,
  revision: string | null | undefined,
): ManualRateSnapshot {
  const linkKind = input.linkKind || 'none';
  const labourMode = input.labourMode || 'none';
  let appliedUnitRate: number | null = null;
  let appliedBomUnitLines: AppliedBomUnitLine[] = [];
  let appliedLabUnitLines: AppliedLabUnitLine[] = [];

  if (linkKind === 'none') {
    if (input.unitRate != null && Number.isFinite(Number(input.unitRate))) {
      appliedUnitRate = round(Number(input.unitRate), 2);
    }
  } else if (linkKind === 'analysis' && input.analysisCode) {
    const a = analyseRate(input.analysisCode, rateLib);
    if (a) {
      appliedUnitRate = round(a.rate, 2);
      appliedBomUnitLines = a.matLines
        .filter((l) => l.coeff > 0)
        .map((l) => ({
          ref: l.ref,
          desc: l.desc,
          unit: l.unit || 'nr',
          qtyPerUnit: l.coeff * (1 + (l.wastage || 0)),
          rate: round(l.rate, 4),
        }));
      if (labourMode === 'fromLinkedRate') {
        appliedLabUnitLines = a.labLines
          .filter((l) => l.coeff > 0)
          .map((l) => ({
            trade: l.desc || l.ref,
            desc: l.desc || l.ref,
            manDaysPerUnit: l.coeff,
            dayRate: round(l.rate, 4),
          }));
      }
    }
  } else if (
    linkKind === 'resource' &&
    input.resourceGroup &&
    input.resourceCode
  ) {
    const list = rateLib[input.resourceGroup] || [];
    const r = list.find((x) => x.code === input.resourceCode);
    if (r) {
      appliedUnitRate = round(r.rate, 2);
      if (input.resourceGroup === 'materials') {
        appliedBomUnitLines = [
          {
            ref: r.code,
            desc: r.desc,
            unit: r.unit,
            qtyPerUnit: 1,
            rate: round(r.rate, 4),
          },
        ];
      }
      if (labourMode === 'fromLinkedRate' && input.resourceGroup === 'labour') {
        appliedLabUnitLines = [
          {
            trade: r.desc || r.code,
            desc: r.desc || r.code,
            manDaysPerUnit: 1,
            dayRate: round(r.rate, 4),
          },
        ];
      }
    }
  }

  return {
    appliedUnitRate,
    appliedBomUnitLines,
    appliedLabUnitLines,
    appliedAtRevision: revision != null ? String(revision) : null,
  };
}

export type ManualReportContribution = {
  boq: ReportLine[];
  bom: ReportLine[];
  labour: {
    activities: LabourActivity[];
    trades: TradeSummary[];
    totalManDays: number;
    totalCost: number;
  };
  pricedTotal: number;
};

function manualItem(
  ref: string,
  description: string,
  qty: number,
  unit: string,
  rate: number | null,
): ReportLine {
  return {
    kind: 'item',
    ref,
    description,
    qty,
    unit,
    rate,
    amount: lineAmount(qty, rate),
    source: 'MANUAL',
  };
}

export function buildManualReportContribution(
  items: ManualBoqReportItem[],
): ManualReportContribution {
  if (!items.length) {
    return {
      boq: [],
      bom: [],
      labour: { activities: [], trades: [], totalManDays: 0, totalCost: 0 },
      pricedTotal: 0,
    };
  }

  const boq: ReportLine[] = [
    { kind: 'group', description: 'Manual BOQ items', source: 'MANUAL' },
  ];
  const bom: ReportLine[] = [
    { kind: 'group', description: 'Manual BOQ — materials', source: 'MANUAL' },
  ];
  const activities: LabourActivity[] = [];
  const manDays: Record<string, { md: number; dayRate: number }> = {};
  let pricedTotal = 0;
  let bomCount = 0;
  let hasBom = false;

  items.forEach((it, idx) => {
    const n = idx + 1;
    const qty = Number(it.quantity) || 0;
    const rate = it.appliedUnitRate;
    const amount = lineAmount(qty, rate);
    if (amount != null) pricedTotal += amount;

    boq.push(manualItem(`M.${n}`, it.description, qty, it.unit || 'nr', rate));

    (it.appliedBomUnitLines || []).forEach((line) => {
      const lineQty = (line.qtyPerUnit || 0) * qty;
      if (!(lineQty > 0)) return;
      hasBom = true;
      bomCount++;
      bom.push(
        manualItem(
          `MB.${bomCount}`,
          `${line.desc} (from ${it.description})`,
          lineQty,
          line.unit,
          line.rate,
        ),
      );
    });

    if (
      it.labourMode === 'outputRate' &&
      it.outputPerDay != null &&
      it.outputPerDay > 0 &&
      qty > 0
    ) {
      const days = Math.ceil(qty / it.outputPerDay);
      const gang = (it.gangDescription || 'Gang').trim() || 'Gang';
      activities.push({
        ref: `ML${n}`,
        activity: `${it.description} (manual)`,
        qty,
        unit: it.unit || 'nr',
        outputRate: `${it.outputPerDay} ${it.unit || 'nr'}/day`,
        gang,
        days,
        floorId: it.floorId ?? null,
        source: 'MANUAL',
      });
      if (!manDays[gang]) manDays[gang] = { md: 0, dayRate: 0 };
      manDays[gang].md += days;
    }

    if (it.labourMode === 'fromLinkedRate') {
      (it.appliedLabUnitLines || []).forEach((line) => {
        const md = (line.manDaysPerUnit || 0) * qty;
        if (!(md > 0)) return;
        const days = Math.ceil(md);
        activities.push({
          ref: `ML${n}-${line.trade}`,
          activity: `${it.description} — ${line.desc} (from linked rate)`,
          qty,
          unit: it.unit || 'nr',
          outputRate: `${round(1 / (line.manDaysPerUnit || 1), 3)} ${it.unit}/man-day`,
          gang: line.trade,
          days,
          floorId: it.floorId ?? null,
          source: 'MANUAL',
        });
        if (!manDays[line.trade]) {
          manDays[line.trade] = { md: 0, dayRate: line.dayRate || 0 };
        }
        manDays[line.trade].md += md;
        if (line.dayRate) manDays[line.trade].dayRate = line.dayRate;
      });
    }
  });

  boq.push({
    kind: 'total',
    description: 'Manual BOQ subtotal',
    amount: round(pricedTotal, 2),
    source: 'MANUAL',
  });

  if (!hasBom) bom.length = 0;

  const trades: TradeSummary[] = Object.keys(manDays)
    .sort()
    .map((trade) => {
      const { md, dayRate } = manDays[trade];
      return {
        trade,
        manDays: round(md, 2),
        dayRate,
        cost: round(md * dayRate, 2),
        source: 'MANUAL' as const,
      };
    });

  return {
    boq,
    bom,
    labour: {
      activities,
      trades,
      totalManDays: trades.reduce((s, t) => s + t.manDays, 0),
      totalCost: trades.reduce((s, t) => s + t.cost, 0),
    },
    pricedTotal: round(pricedTotal, 2),
  };
}

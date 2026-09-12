import { round } from '../../engines';
import {
  computePackAnalysis,
  type PackAnalysisLineInput,
  type PackAnalysisResource,
} from '../boqPack/computePackAnalysis';
import { lineAmount } from './pricing';
import type {
  ElementReportBundle,
  LabourActivity,
  ReportLine,
  TradeSummary,
} from './types';

export type PackAnalysisBreakdown = {
  lines: PackAnalysisLineInput[];
  allowances?: {
    transportPctMaterials?: number;
    sundriesPctLabourPlantSubcontract?: number;
    overheadPct?: number;
    profitPct?: number;
  };
};

type BomAcc = {
  code: string;
  category: string;
  description: string;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
};

type LabAcc = {
  trade: string;
  desc: string;
  unit: string;
  manDays: number;
  dayRate: number;
  cost: number;
  qty: number;
  boqUnit: string;
};

function emptyAllowances() {
  return {
    transportPctMaterials: 0,
    sundriesPctLabourPlantSubcontract: 0,
    overheadPct: 0,
    profitPct: 0,
  };
}

function hasBomItems(bundle: ElementReportBundle): boolean {
  return bundle.bom.some((line) => line.kind === 'item');
}

function hasLabourItems(bundle: ElementReportBundle): boolean {
  return (bundle.labour.activities || []).length > 0;
}

function group(description: string): ReportLine {
  return { kind: 'group', description, source: 'CATALOGUE' };
}

function item(
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
    source: 'CATALOGUE',
  };
}

function total(description: string, amount: number): ReportLine {
  return { kind: 'total', description, amount, source: 'CATALOGUE' };
}

function addBom(map: Map<string, BomAcc>, row: BomAcc) {
  const prev = map.get(row.code);
  if (!prev) {
    map.set(row.code, { ...row });
    return;
  }
  prev.qty += row.qty;
  prev.amount += row.amount;
  if (prev.qty > 0) prev.rate = prev.amount / prev.qty;
}

function addLab(map: Map<string, LabAcc>, row: LabAcc) {
  const prev = map.get(row.trade);
  if (!prev) {
    map.set(row.trade, { ...row });
    return;
  }
  prev.manDays += row.manDays;
  prev.cost += row.cost;
  prev.qty += row.qty;
  if (prev.manDays > 0) prev.dayRate = prev.cost / prev.manDays;
}

function buildBom(rows: BomAcc[]): ReportLine[] {
  const sections = [
    { cat: 'MAT', title: 'A — Materials (databank)' },
    { cat: 'PLT', title: 'B — Plant & tools' },
    { cat: 'SUB', title: 'C — Subcontract' },
    { cat: 'OTHER', title: 'D — Other resources' },
  ];
  const lines: ReportLine[] = [];
  let tot = 0;
  let idx = 0;
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    const groupRows = rows.filter((r) => r.category === section.cat);
    if (!groupRows.length) continue;
    lines.push(group(section.title));
    for (let i = 0; i < groupRows.length; i++) {
      const r = groupRows[i];
      idx += 1;
      tot += r.amount;
      lines.push(
        item(
          `${section.cat}${idx}`,
          r.description || r.code,
          round(r.qty, 4),
          r.unit || 'nr',
          round(r.rate, 4),
        ),
      );
    }
  }
  if (!lines.length) return [];
  lines.push(total('Materials total', round(tot, 2)));
  return lines;
}

function buildLabour(rows: LabAcc[]): ElementReportBundle['labour'] {
  const activities: LabourActivity[] = [];
  const trades: TradeSummary[] = [];
  let totalManDays = 0;
  let totalCost = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const manDays = round(r.manDays, 3);
    const cost = round(r.cost, 2);
    totalManDays += manDays;
    totalCost += cost;
    activities.push({
      ref: `L${i + 1}`,
      activity: r.desc,
      qty: round(r.qty, 3),
      unit: r.boqUnit || 'nr',
      outputRate: /^(hr|hrs|hour|hours)$/i.test(r.unit)
        ? `${round((r.manDays * 8) / (r.qty || 1), 3)} hr/BOQ unit`
        : `${round(r.manDays / (r.qty || 1), 3)} ${r.unit || 'md'}/BOQ unit`,
      gang: r.trade,
      days: manDays,
      source: 'CATALOGUE',
    });
    trades.push({
      trade: r.trade,
      manDays,
      dayRate: round(r.dayRate, 4),
      cost,
      source: 'CATALOGUE',
    });
  }
  return {
    activities,
    trades,
    totalManDays: round(totalManDays, 2),
    totalCost: round(totalCost, 2),
  };
}

/**
 * Fill empty catalogue BOM / labour from pack RATE ANALYSIS resources.
 * Engine-built tables are left unchanged.
 */
export function applyPackAnalysisToBomLabour(
  byElement: ElementReportBundle[],
  opts: {
    analysesByLineKey?: Record<string, PackAnalysisBreakdown>;
    resourcesByCode?: Record<string, PackAnalysisResource>;
  } = {},
): ElementReportBundle[] {
  const analyses = opts.analysesByLineKey || {};
  const resources = opts.resourcesByCode || {};
  if (!Object.keys(analyses).length) return byElement;

  return byElement.map((bundle) => {
    const fillBom = !hasBomItems(bundle);
    const fillLabour = !hasLabourItems(bundle);
    if (!fillBom && !fillLabour) return bundle;

    const bomMap = new Map();
    const labMap = new Map();

    for (let i = 0; i < bundle.boq.length; i++) {
      const line = bundle.boq[i];
      if (line.kind !== 'item' || !line.lineKey) continue;
      const boqQty = Number(line.qty) || 0;
      if (!(boqQty > 0)) continue;
      const analysis = analyses[line.lineKey];
      if (!analysis || !analysis.lines || !analysis.lines.length) continue;

      const computed = computePackAnalysis({
        lines: analysis.lines,
        resourcesByCode: resources,
        allowances: {
          ...emptyAllowances(),
          ...(analysis.allowances || {}),
        },
      });

      for (let j = 0; j < computed.lines.length; j++) {
        const ln = computed.lines[j];
        if (ln.missing || !(ln.quantity > 0)) continue;
        const cat = String(ln.category || '').toUpperCase();
        if (cat === 'LAB') {
          if (!fillLabour) continue;
          const coeff = Number(ln.quantity) || 0;
          const raw = coeff * boqQty;
          const unit = String(ln.unit || '').toLowerCase();
          const hourly = /^(hr|hrs|hour|hours)$/.test(unit);
          const manDays = hourly ? raw / 8 : raw;
          const hourOrDayRate = Number(ln.unitRate) || 0;
          const cost = raw * hourOrDayRate;
          addLab(labMap, {
            trade: ln.description || ln.sourceCode,
            desc: `${line.description} — ${ln.description || ln.sourceCode}`,
            unit: ln.unit || (hourly ? 'hr' : 'md'),
            manDays,
            dayRate: hourly ? hourOrDayRate * 8 : hourOrDayRate,
            cost,
            qty: boqQty,
            boqUnit: line.unit || 'nr',
          });
          continue;
        }
        if (!fillBom) continue;
        if (cat !== 'MAT' && cat !== 'PLT' && cat !== 'SUB' && cat !== 'OTHER') {
          continue;
        }
        const wastePct = Number(ln.wastePct) || 0;
        const qty = ln.quantity * (1 + wastePct) * boqQty;
        const rate = Number(ln.unitRate) || 0;
        addBom(bomMap, {
          code: `${cat}:${ln.sourceCode}`,
          category: cat,
          description: ln.description || ln.sourceCode,
          unit: ln.unit || 'nr',
          qty,
          rate,
          amount: qty * rate,
        });
      }
    }

    const next = { ...bundle };
    if (fillBom) {
      const bom = buildBom([...bomMap.values()]);
      if (bom.length) {
        next.bom = bom;
        next.cost = {
          ...next.cost,
          bom: bom.find((l) => l.kind === 'total')?.amount || 0,
        };
      }
    }
    if (fillLabour) {
      const labour = buildLabour([...labMap.values()]);
      if (labour.activities.length) {
        next.labour = labour;
        next.cost = { ...next.cost, labour: labour.totalCost };
      }
    }
    return next;
  });
}

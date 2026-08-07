import type { IProject } from '../../models/Project';
import type { IInstance } from '../../models/Instance';
import { DEFAULT_PRICING } from '../../defaults/projectDefaults';
import { round } from '../../engines';
import {
  ELEMENT_ENGINES,
  structuralCalculator,
} from '../../elementEngines';
import { ELEMENT_META } from './elementMeta';
import {
  aggregateStructural,
  makeEntries,
  type ReportEntry,
} from './builders';
import {
  CEMENT_BAG_KG,
  FORMWORK_WASTE,
  LABOUR_RATES,
  PLY_SHEET_M2,
  TIE_WIRE,
  lineAmount,
  makeRateAccessors,
  mixFor,
} from './pricing';
import type {
  ElementReportBundle,
  LabourActivity,
  ProjectReportsPayload,
  ReportLine,
  TradeSummary,
} from './types';

function group(description: string): ReportLine {
  return { kind: 'group', description };
}

function item(
  ref: string,
  description: string,
  qty: number,
  unit: string,
  rate: number | null = null,
  opts?: { isRebar?: boolean; dec?: number },
): ReportLine {
  return {
    kind: 'item',
    ref,
    description,
    qty,
    unit,
    rate,
    amount: lineAmount(qty, rate),
    isRebar: opts?.isRebar,
    dec: opts?.dec,
  };
}

function total(description: string, amount: number): ReportLine {
  return { kind: 'total', description, amount };
}

function bomMaterialItems(bundle: ElementReportBundle): ReportLine[] {
  return bundle.bom.filter((l) => l.kind === 'item');
}

function rateCodeForSummaryKey(elementKey: string, key: string): string {
  if (key === 'masonry') return 'stoneMasonry';
  if (key === 'blinding') return 'blinding';
  if (key === 'area') {
    if (elementKey === 'FLOOR_FINISH') return 'floorFinish';
    if (elementKey === 'WALL_FINISH') return 'wallFinish';
    return 'ceilingFinish';
  }
  return key;
}

function consolidateBoq(
  byElement: ElementReportBundle[],
  structuralAgg: ReturnType<typeof aggregateStructural>,
  rates: ReturnType<typeof makeRateAccessors>,
): ReportLine[] {
  const lines: ReportLine[] = [];
  let projectTotal = 0;

  byElement
    .slice()
    .sort((a, b) => a.num - b.num)
    .forEach((be) => {
      lines.push(group(`${be.num}${be.suffix || ''}. ${be.label} (${be.units} units)`));
      let n = 0;
      let elTot = 0;

      if (be.kind === 'structural') {
        be.boq.forEach((line) => {
          if (line.kind !== 'item') return;
          n++;
          lines.push({ ...line, ref: `${be.num}.${n}` });
          if (line.amount != null) elTot += line.amount;
        });
      } else {
        Object.keys(be.summary).forEach((k) => {
          if (k === 'mortar') return;
          n++;
          const unit = k === 'area' ? 'm²' : 'm³';
          const lbl = `${be.label} — ${k.charAt(0).toUpperCase()}${k.slice(1)}`;
          const rate = rates.boqRate(rateCodeForSummaryKey(be.elementKey, k));
          const qty = be.summary[k];
          lines.push(item(`${be.num}.${n}`, lbl, qty, unit, rate));
        });
        elTot = be.cost.boq;
      }

      lines.push(total(`${be.label} subtotal`, elTot));
      projectTotal += elTot;
    });

  lines.push(group('Project Summary'));
  lines.push(item('Σ', 'Structural concrete (all grades)', structuralAgg.totalConcrete, 'm³'));
  lines.push(item('Σ', 'Structural formwork', structuralAgg.totalFormwork, 'm²'));
  lines.push(
    item('Σ', 'Structural reinforcement', structuralAgg.totalSteel / 1000, 't', null, {
      isRebar: true,
      dec: 3,
    }),
  );
  lines.push(total('PROJECT TOTAL (all elements, excl. prelims & OH&P)', projectTotal));
  return lines;
}

function consolidateBom(
  byElement: ElementReportBundle[],
  structuralEntries: ReportEntry[],
  rates: ReturnType<typeof makeRateAccessors>,
): ReportLine[] {
  const lines: ReportLine[] = [];
  const hasStructural = byElement.some((be) => be.kind === 'structural');

  if (hasStructural) {
    const agg = aggregateStructural(structuralEntries, structuralCalculator);
    let cement = 0;
    let sand = 0;
    let aggr = 0;
    let water = 0;
    Object.entries(agg.concreteByGrade).forEach(([grade, vol]) => {
      const m = mixFor(grade);
      cement += vol * m.cement;
      sand += vol * m.sand;
      aggr += vol * m.agg;
      water += vol * m.water;
    });
    lines.push(group('A — Concrete materials (structural)'));
    lines.push(
      item('A1', `Cement (${CEMENT_BAG_KG}kg bags)`, cement / CEMENT_BAG_KG, 'bags', rates.matRate('cementBag'), {
        dec: 1,
      }),
    );
    lines.push(item('A2', 'Sand (fine aggregate)', sand, 'm³', rates.matRate('sand'), { dec: 2 }));
    lines.push(item('A3', 'Coarse aggregate', aggr, 'm³', rates.matRate('aggregate'), { dec: 2 }));
    lines.push(item('A4', 'Water', water, 'L', rates.matRate('water'), { dec: 0 }));

    const sheets = Math.ceil((agg.totalFormwork * (1 + FORMWORK_WASTE)) / PLY_SHEET_M2);
    lines.push(group('B — Formwork materials'));
    lines.push(
      item(
        'B1',
        'Plywood formwork sheets (2440×1220mm), incl. 15% wastage',
        sheets,
        'nos',
        rates.matRate('plywoodSheet'),
        { dec: 0 },
      ),
    );

    lines.push(group('C — Reinforcement materials'));
    let ci = 0;
    let tot = 0;
    Object.keys(agg.steelByDia)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((d) => {
        ci++;
        const kg = agg.steelByDia[String(d)];
        tot += kg;
        lines.push(
          item(`C${ci}`, `Reinforcement bars, H${d}`, kg, 'kg', rates.matRate('rebarKg'), {
            dec: 2,
            isRebar: true,
          }),
        );
      });
    lines.push(
      item(`C${ci + 1}`, 'Binding/tying wire', tot * TIE_WIRE, 'kg', rates.matRate('tieWire'), {
        dec: 2,
        isRebar: true,
      }),
    );
  }

  byElement
    .slice()
    .sort((a, b) => a.num - b.num)
    .forEach((be) => {
      if (be.kind === 'structural') return;
      const materialLines = bomMaterialItems(be);
      if (!materialLines.length) return;
      lines.push(group(`${be.num}${be.suffix || ''}. ${be.label} — materials`));
      materialLines.forEach((l) => lines.push(l));
    });

  return lines;
}

function consolidateLabour(
  byElement: ElementReportBundle[],
  structuralAgg: ReturnType<typeof aggregateStructural>,
  rates: ReturnType<typeof makeRateAccessors>,
): ProjectReportsPayload['labour'] {
  const manDays: Record<string, number> = {};
  const activities: LabourActivity[] = [];

  const addGang = (gang: [string, number][], days: number) => {
    gang.forEach(([role, cnt]) => {
      manDays[role] = (manDays[role] || 0) + days * cnt;
    });
  };

  let ref = 0;
  const pushStructural = (key: keyof typeof LABOUR_RATES, qty: number) => {
    if (!(qty > 0)) return;
    const r = LABOUR_RATES[key];
    const days = Math.ceil(qty / r.perDay);
    addGang(r.gang, days);
    ref++;
    activities.push({
      ref: `L${ref}`,
      activity: r.label,
      qty,
      unit: r.unit,
      outputRate: `${r.perDay} ${r.unit}/day`,
      gang: r.gang.map(([role, cnt]) => `${cnt} ${role}`).join(' + '),
      days,
    });
  };
  pushStructural('concrete', structuralAgg.totalConcrete);
  pushStructural('formwork', structuralAgg.totalFormwork);
  pushStructural('reinforcement', structuralAgg.totalSteel);

  byElement
    .slice()
    .sort((a, b) => a.num - b.num)
    .forEach((be) => {
      if (be.kind === 'structural') return;
      be.labour.activities.forEach((a) => {
        ref++;
        activities.push({ ...a, ref: `L${ref}` });
      });
      be.labour.trades.forEach((t) => {
        manDays[t.trade] = (manDays[t.trade] || 0) + t.manDays;
      });
    });

  const trades: TradeSummary[] = Object.keys(manDays)
    .sort()
    .map((trade) => {
      const md = manDays[trade];
      const dayRate = rates.labRate(trade);
      return { trade, manDays: md, dayRate, cost: md * dayRate };
    });

  return {
    activities,
    trades,
    totalManDays: trades.reduce((s, t) => s + t.manDays, 0),
    totalCost: trades.reduce((s, t) => s + t.cost, 0),
  };
}

export type BuildReportsOptions = {
  scope: 'floor' | 'project';
  floorId?: string | null;
  /** When set, only that element's tables are returned in byElement (and consolidated mirrors it). */
  elementKey?: string | null;
};

export function buildProjectReports(
  project: IProject,
  instances: IInstance[],
  opts: BuildReportsOptions,
): ProjectReportsPayload {
  const rates = makeRateAccessors(
    project.rateLib as any,
    DEFAULT_PRICING,
    project.useRateAnalysis !== false,
  );
  const materials = project.materials;

  let filtered = instances.filter((i) => Boolean(ELEMENT_ENGINES[i.elementKey]));
  if (opts.scope === 'floor') {
    if (!opts.floorId) throw new Error('floorId is required when scope=floor');
    filtered = filtered.filter((i) => i.floorId === opts.floorId);
  }
  if (opts.elementKey) {
    filtered = filtered.filter((i) => i.elementKey === opts.elementKey);
  }

  const entries = makeEntries(filtered);
  const byKey: Record<string, ReportEntry[]> = {};
  entries.forEach((e) => {
    if (!byKey[e.elementKey]) byKey[e.elementKey] = [];
    byKey[e.elementKey].push(e);
  });

  const byElement: ElementReportBundle[] = [];
  Object.keys(byKey)
    .sort((a, b) => (ELEMENT_META[a]?.num || 0) - (ELEMENT_META[b]?.num || 0))
    .forEach((key) => {
      const bundle = ELEMENT_ENGINES[key]?.buildReports(byKey[key], materials, rates);
      if (bundle) byElement.push(bundle);
    });

  const structuralEntries = entries.filter(
    (e) => ELEMENT_ENGINES[e.elementKey]?.reportKind === 'structural',
  );
  const structuralAgg = aggregateStructural(structuralEntries, structuralCalculator);
  const pricedTotal = byElement.reduce((s, be) => s + (be.cost.boq || 0), 0);

  return {
    scope: opts.scope,
    floorId: opts.scope === 'floor' ? opts.floorId || null : null,
    currency: project.currency || 'USD',
    summary: {
      totalConcrete: structuralAgg.totalConcrete,
      totalFormwork: structuralAgg.totalFormwork,
      totalSteel: structuralAgg.totalSteel,
      totalUnits: byElement.reduce((s, be) => s + be.units, 0),
      pricedTotal: round(pricedTotal, 2),
      elementCount: byElement.length,
    },
    boq: consolidateBoq(byElement, structuralAgg, rates),
    bom: consolidateBom(byElement, structuralEntries, rates),
    labour: consolidateLabour(byElement, structuralAgg, rates),
    byElement,
  };
}

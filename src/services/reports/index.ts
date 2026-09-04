import type { IProject } from '../../models/Project';
import type { IInstance } from '../../models/Instance';
import { DEFAULT_PRICING } from '../../defaults/projectDefaults';
import { round } from '../../engines';
import {
  ELEMENT_ENGINES,
  structuralCalculator,
} from '../../elementEngines';
import type { SelectedBoqReportItem } from '../selectedBoq';
import { mergeSelectedBoqIntoByElement } from './mergeSelectedBoq';
import { normalizeRef } from './boqCatalogue';
import {
  buildManualReportContribution,
  type ManualBoqReportItem,
} from '../manualBoqPricing';
import { ELEMENT_META } from './elementMeta';
import {
  aggregateStructural,
  buildFloorLevelTypesById,
  makeEntries,
  type ReportEntry,
} from './builders';
import { materialsForBom } from '../materialsMix';
import { applyDisplayUnitsToReports } from './applyDisplayUnits';
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
  LabourFloorLoad,
  ProjectReportsPayload,
  ReportLine,
  TradeSummary,
} from './types';

function group(description: string): ReportLine {
  return { kind: 'group', description, source: 'MODELLED' };
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
    source: 'MODELLED',
  };
}

function total(description: string, amount: number): ReportLine {
  return { kind: 'total', description, amount, source: 'MODELLED' };
}

function bomMaterialItems(bundle: ElementReportBundle): ReportLine[] {
  return bundle.bom.filter((l) => l.kind === 'item');
}

function rateCodeForSummaryKey(elementKey: string, key: string): string {
  if (key === 'masonry') {
    return elementKey === 'MASONRY' ? 'masonryWall' : 'stoneMasonry';
  }
  if (key === 'blinding') return 'blinding';
  if (key === 'screed') return 'floorScreed';
  if (key === 'tiles') return 'floorTiling';
  if (key === 'area') {
    if (elementKey === 'FLOOR_FINISH') return 'floorFinish';
    if (elementKey === 'WALL_FINISH') return 'wallFinish';
    if (elementKey === 'MASONRY') return 'masonryWall';
    if (elementKey === 'SKIRTING') return 'skirting';
    if (elementKey === 'DOORS_WINDOWS') return 'doorsWindows';
    return 'ceilingFinish';
  }
  if (key === 'length' || key === 'nos' || key === 'perimeter') {
    if (elementKey === 'SKIRTING') return 'skirting';
    if (elementKey === 'DOORS_WINDOWS') return 'doorsWindows';
    if (elementKey === 'LINTELS') return 'lintels';
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

      const boqItems = be.boq.filter((line) => line.kind === 'item');
      if (boqItems.length > 0) {
        boqItems.forEach((line) => {
          n++;
          lines.push({
            ...line,
            ref: line.ref || `${be.num}.${n}`,
            source: line.source || 'MODELLED',
          });
          if (line.amount != null) elTot += line.amount;
        });
        elTot = be.cost.boq;
      } else {
        Object.keys(be.summary).forEach((k) => {
          if (k === 'mortar') return;
          n++;
          const unit = k === 'area' || k === 'tiles' ? 'm²' : 'm³';
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
  materials: IProject['materials'],
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
      const m = mixFor(grade, materials);
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
    const bracingKg = round(
      agg.totalVerticalFormwork * (materials.verticalBracingRate || 0),
      2,
    );
    const propKg = round(
      agg.totalSoffitFormwork * (materials.soffitPropRate || 0),
      2,
    );
    if (bracingKg > 0) {
      lines.push(
        item(
          'B2',
          'Vertical formwork bracing (timber/props/stakes) — indicative',
          bracingKg,
          'kg',
          rates.matRate('formworkBracingKg'),
          { dec: 2 },
        ),
      );
    }
    if (propKg > 0) {
      lines.push(
        item(
          'B3',
          'Soffit falsework / props — indicative',
          propKg,
          'kg',
          rates.matRate('formworkSoffitPropKg'),
          { dec: 2 },
        ),
      );
    }

    lines.push(group('C — Reinforcement materials'));
    let ci = 0;
    let tot = 0;
    Object.keys(agg.steelByDia)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((d) => {
        const kg = agg.steelByDia[String(d)];
        if (!(kg > 0)) return;
        ci++;
        tot += kg;
        const label =
          d === 0
            ? 'Structural steel H-section piles'
            : `Reinforcement bars, H${d}`;
        lines.push(
          item(`C${ci}`, label, kg, 'kg', rates.matRate('rebarKg'), {
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

  const masonryBundles = byElement
    .filter((be) => be.kind === 'masonry')
    .sort((a, b) => a.num - b.num);
  if (masonryBundles.some((be) => bomMaterialItems(be).length)) {
    lines.push(group('D — Blockwork / Brickwork materials'));
    let di = 0;
    masonryBundles.forEach((be) => {
      bomMaterialItems(be).forEach((l) => {
        if (l.kind !== 'item') return;
        di++;
        lines.push({
          ...l,
          ref: `D${di}`,
          description: `${be.label}: ${l.description}`,
          source: l.source || 'MODELLED',
        });
      });
    });
  }

  const finishBundles = byElement
    .filter((be) => be.kind === 'finish')
    .sort((a, b) => a.num - b.num);
  if (finishBundles.some((be) => bomMaterialItems(be).length)) {
    lines.push(group('E — Finishes materials'));
    let ei = 0;
    finishBundles.forEach((be) => {
      bomMaterialItems(be).forEach((l) => {
        if (l.kind !== 'item') return;
        ei++;
        lines.push({
          ...l,
          ref: `E${ei}`,
          description: `${be.label}: ${l.description}`,
          source: l.source || 'MODELLED',
        });
      });
    });
  }

  // Remaining non-structural (e.g. earthworks) — keep labeled if they ever emit BOM
  byElement
    .slice()
    .sort((a, b) => a.num - b.num)
    .forEach((be) => {
      if (be.kind === 'structural' || be.kind === 'masonry' || be.kind === 'finish' || be.kind === 'mep') return;
      const materialLines = bomMaterialItems(be);
      if (!materialLines.length) return;
      lines.push(group(`${be.num}${be.suffix || ''}. ${be.label} — materials`));
      materialLines.forEach((l) => lines.push(l));
    });

  return lines;
}

function tradesFromManDays(
  manDays: Record<string, number>,
  rates: ReturnType<typeof makeRateAccessors>,
  source: TradeSummary['source'] = 'MODELLED',
): TradeSummary[] {
  return Object.keys(manDays)
    .sort()
    .map((trade) => {
      const md = manDays[trade];
      const dayRate = rates.labRate(trade);
      return {
        trade,
        manDays: md,
        dayRate,
        cost: md * dayRate,
        source,
      };
    });
}

/**
 * Build labour with resource loading per floor and per activity (crew/gang on each line).
 */
function consolidateLabour(
  entries: ReportEntry[],
  materials: IProject['materials'],
  rates: ReturnType<typeof makeRateAccessors>,
): ProjectReportsPayload['labour'] {
  const floorIds = [
    ...new Set(entries.map((e) => e.floorId).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const allActivities: LabourActivity[] = [];
  const allManDays: Record<string, number> = {};
  const byFloor: LabourFloorLoad[] = [];
  let ref = 0;

  const addGang = (
    target: Record<string, number>,
    gang: [string, number][],
    days: number,
  ) => {
    gang.forEach(([role, cnt]) => {
      target[role] = (target[role] || 0) + days * cnt;
    });
  };

  for (const floorId of floorIds) {
    const floorEntries = entries.filter((e) => e.floorId === floorId);
    const floorManDays: Record<string, number> = {};
    const floorActivities: LabourActivity[] = [];

    const structuralEntries = floorEntries.filter(
      (e) => ELEMENT_ENGINES[e.elementKey]?.reportKind === 'structural',
    );
    if (structuralEntries.length) {
      const agg = aggregateStructural(structuralEntries, structuralCalculator);
      (
        [
          ['concrete', agg.totalConcrete],
          ['formwork', agg.totalFormwork],
          ['reinforcement', agg.totalSteel],
        ] as const
      ).forEach(([key, qty]) => {
        if (!(qty > 0)) return;
        const r = LABOUR_RATES[key];
        const days = Math.ceil(qty / r.perDay);
        addGang(floorManDays, r.gang, days);
        addGang(allManDays, r.gang, days);
        ref++;
        const act: LabourActivity = {
          ref: `L${ref}`,
          activity: r.label,
          qty,
          unit: r.unit,
          outputRate: `${r.perDay} ${r.unit}/day`,
          gang: r.gang.map(([role, cnt]) => `${cnt} ${role}`).join(' + '),
          days,
          floorId,
          source: 'MODELLED',
        };
        floorActivities.push(act);
        allActivities.push(act);
      });
    }

    const byKey: Record<string, ReportEntry[]> = {};
    floorEntries.forEach((e) => {
      if (ELEMENT_ENGINES[e.elementKey]?.reportKind === 'structural') return;
      if (!byKey[e.elementKey]) byKey[e.elementKey] = [];
      byKey[e.elementKey].push(e);
    });

    Object.keys(byKey)
      .sort((a, b) => (ELEMENT_META[a]?.num || 0) - (ELEMENT_META[b]?.num || 0))
      .forEach((key) => {
        const bundle = ELEMENT_ENGINES[key]?.buildReports(byKey[key], materials, rates);
        if (!bundle) return;
        bundle.labour.activities.forEach((a) => {
          ref++;
          const act: LabourActivity = {
            ...a,
            ref: `L${ref}`,
            floorId,
            source: a.source || 'MODELLED',
          };
          floorActivities.push(act);
          allActivities.push(act);
        });
        bundle.labour.trades.forEach((t) => {
          floorManDays[t.trade] = (floorManDays[t.trade] || 0) + t.manDays;
          allManDays[t.trade] = (allManDays[t.trade] || 0) + t.manDays;
        });
      });

    const trades = tradesFromManDays(floorManDays, rates);
    byFloor.push({
      floorId,
      activities: floorActivities,
      trades,
      totalManDays: trades.reduce((s, t) => s + t.manDays, 0),
      totalCost: trades.reduce((s, t) => s + t.cost, 0),
    });
  }

  const trades = tradesFromManDays(allManDays, rates);
  return {
    activities: allActivities,
    trades,
    totalManDays: trades.reduce((s, t) => s + t.manDays, 0),
    totalCost: trades.reduce((s, t) => s + t.cost, 0),
    byFloor,
  };
}

export type BuildReportsOptions = {
  scope: 'floor' | 'project';
  floorId?: string | null;
  /** When set, only that element's tables are returned in byElement (and consolidated mirrors it). */
  elementKey?: string | null;
  /**
   * Floor docs (or lightweight stubs) used to resolve levelTypes for catalogue
   * Applicable Level filtering. When omitted, catalogue uses project-wide ('all').
   */
  floors?: Array<{ floorId: string; label?: string; levelTypes?: unknown }>;
};

export { buildFloorLevelTypesById } from './builders';

/** Project scope: same catalogue ref on multiple floors → one line, qty summed. */
function dedupeSelectedAcrossFloors(
  items: SelectedBoqReportItem[],
): SelectedBoqReportItem[] {
  const map = new Map<string, SelectedBoqReportItem>();
  for (const s of items) {
    const key = `${s.elementKey}::${normalizeRef(s.catalogueRef)}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...s });
    } else {
      map.set(key, {
        ...prev,
        quantity: (Number(prev.quantity) || 0) + (Number(s.quantity) || 0),
      });
    }
  }
  return [...map.values()];
}

export function buildProjectReports(
  project: IProject,
  instances: IInstance[],
  opts: BuildReportsOptions,
  manualItems: ManualBoqReportItem[] = [],
  selectedBoqItems: SelectedBoqReportItem[] = [],
): ProjectReportsPayload {
  const rates = makeRateAccessors(
    project.rateLib as any,
    DEFAULT_PRICING,
    project.useRateAnalysis !== false,
  );
  // BOM / report mixes are revision-gated (applied_*), not live draft edits.
  const materials = materialsForBom(project.materials);

  let filtered = instances.filter((i) => Boolean(ELEMENT_ENGINES[i.elementKey]));
  if (opts.scope === 'floor') {
    if (!opts.floorId) throw new Error('floorId is required when scope=floor');
    filtered = filtered.filter((i) => i.floorId === opts.floorId);
  }
  if (opts.elementKey) {
    filtered = filtered.filter((i) => i.elementKey === opts.elementKey);
  }

  const floorLevelTypesById = buildFloorLevelTypesById(opts.floors);
  const entries = makeEntries(filtered, floorLevelTypesById);
  const byKey: Record<string, ReportEntry[]> = {};
  entries.forEach((e) => {
    if (!byKey[e.elementKey]) byKey[e.elementKey] = [];
    byKey[e.elementKey].push(e);
  });

  let byElement: ElementReportBundle[] = [];
  Object.keys(byKey)
    .sort((a, b) => (ELEMENT_META[a]?.num || 0) - (ELEMENT_META[b]?.num || 0))
    .forEach((key) => {
      const bundle = ELEMENT_ENGINES[key]?.buildReports(byKey[key], materials, rates);
      if (bundle) byElement.push(bundle);
    });

  const floorLevelTypesByElement: Record<string, import('../../lib/levelCompatibility').FloorLevelType[] | 'all'> = {};
  for (const e of entries) {
    if (!e.floorLevelTypes?.length) continue;
    const prev = floorLevelTypesByElement[e.elementKey];
    if (!prev || prev === 'all') {
      floorLevelTypesByElement[e.elementKey] = [...e.floorLevelTypes];
    } else {
      floorLevelTypesByElement[e.elementKey] = [
        ...new Set([...prev, ...e.floorLevelTypes]),
      ];
    }
  }

  byElement = mergeSelectedBoqIntoByElement(
    byElement,
    opts.scope === 'project'
      ? dedupeSelectedAcrossFloors(selectedBoqItems)
      : selectedBoqItems,
    {
      floorId: opts.scope === 'floor' ? opts.floorId : null,
      elementKey: opts.elementKey,
      rates,
      floorLevelTypesByElement,
    },
  );

  const structuralEntries = entries.filter(
    (e) => ELEMENT_ENGINES[e.elementKey]?.reportKind === 'structural',
  );
  const structuralAgg = aggregateStructural(structuralEntries, structuralCalculator);
  const modelledPriced = byElement.reduce((s, be) => s + (be.cost.boq || 0), 0);

  // Manual BOQ uses applied* rate snapshots (revision-gated), never live rateLib.
  const manual = buildManualReportContribution(manualItems);

  const modelledBoq = consolidateBoq(byElement, structuralAgg, rates);
  const totIdx = modelledBoq.findIndex(
    (l) => l.kind === 'total' && /PROJECT TOTAL/i.test(l.description),
  );
  const boq: ReportLine[] =
    totIdx >= 0
      ? [
          ...modelledBoq.slice(0, totIdx),
          ...manual.boq,
          {
            ...modelledBoq[totIdx],
            amount: round(
              (modelledBoq[totIdx].amount || 0) + manual.pricedTotal,
              2,
            ),
          },
        ]
      : [...modelledBoq, ...manual.boq];

  const bom = [
    ...consolidateBom(byElement, structuralEntries, rates, materials),
    ...manual.bom,
  ];

  const modelledLabour = consolidateLabour(entries, materials, rates);
  const byFloor = modelledLabour.byFloor.map((f) => ({
    ...f,
    activities: [...f.activities],
    trades: f.trades.map((t) => ({ ...t })),
  }));
  for (const act of manual.labour.activities) {
    const key = (act.floorId && String(act.floorId).trim()) || '';
    let bucket = key ? byFloor.find((f) => f.floorId === key) : undefined;
    if (!bucket) {
      bucket = {
        floorId: key || 'Ungrouped',
        activities: [],
        trades: [],
        totalManDays: 0,
        totalCost: 0,
      };
      byFloor.push(bucket);
    }
    bucket.activities.push({ ...act, floorId: key || null });
  }
  const labour = {
    activities: [...modelledLabour.activities, ...manual.labour.activities],
    trades: mergeTrades(modelledLabour.trades, manual.labour.trades),
    totalManDays:
      modelledLabour.totalManDays + manual.labour.totalManDays,
    totalCost: round(
      modelledLabour.totalCost + manual.labour.totalCost,
      2,
    ),
    byFloor,
  };

  const payload: ProjectReportsPayload = {
    scope: opts.scope,
    floorId: opts.scope === 'floor' ? opts.floorId || null : null,
    currency: project.currency || 'USD',
    unitSystem: 'metric',
    summary: {
      totalConcrete: structuralAgg.totalConcrete,
      totalFormwork: structuralAgg.totalFormwork,
      totalSteel: structuralAgg.totalSteel,
      totalUnits:
        byElement.reduce((s, be) => s + be.units, 0) + manualItems.length,
      pricedTotal: round(modelledPriced + manual.pricedTotal, 2),
      elementCount: byElement.length,
    },
    boq,
    bom,
    labour,
    byElement,
  };
  return applyDisplayUnitsToReports(payload, project.units);
}

function mergeTrades(
  a: TradeSummary[],
  b: TradeSummary[],
): TradeSummary[] {
  const map = new Map<string, TradeSummary>();
  for (const t of [...a, ...b]) {
    const prev = map.get(t.trade);
    if (!prev) {
      map.set(t.trade, { ...t });
      continue;
    }
    const manDays = prev.manDays + t.manDays;
    const cost = prev.cost + t.cost;
    map.set(t.trade, {
      trade: t.trade,
      manDays,
      dayRate: manDays > 0 ? round(cost / manDays, 2) : prev.dayRate,
      cost: round(cost, 2),
      source: prev.source === 'MANUAL' || t.source === 'MANUAL' ? 'MANUAL' : 'MODELLED',
    });
  }
  return [...map.values()].sort((x, y) => x.trade.localeCompare(y.trade));
}

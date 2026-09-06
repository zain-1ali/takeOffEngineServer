import type { ProjectMaterials } from '../../models/Project';
import type { FloorLevelType } from '../../lib/levelCompatibility';
import { CORE_QTY_BINDINGS } from './boqCatalogue/types';

type CatalogueQtyContext = {
  concrete?: number;
  formwork?: number;
  steel?: number;
  excavation?: number;
  disposal?: number;
  masonry?: number;
  blinding?: number;
};

function normRef(ref: string): string {
  return String(ref || '').trim();
}

function roleForRef(
  elementKey: string,
  catalogueRef: string,
): keyof CatalogueQtyContext | null {
  const b = CORE_QTY_BINDINGS[elementKey];
  if (!b) return null;
  const want = normRef(catalogueRef);
  const hit = (a?: string, roof?: string) =>
    (a && normRef(a) === want) || (roof && normRef(roof) === want);
  if (hit(b.rebar, b.rebarRoof)) return 'steel';
  if (hit(b.concrete, b.concreteRoof)) return 'concrete';
  if (hit(b.formwork, b.formworkRoof)) return 'formwork';
  if (b.excavation && normRef(b.excavation) === want) return 'excavation';
  if (b.disposal && normRef(b.disposal) === want) return 'disposal';
  if (b.masonry && normRef(b.masonry) === want) return 'masonry';
  if (b.blinding && normRef(b.blinding) === want) return 'blinding';
  return null;
}

function qtyContextFromSummary(
  summary: Record<string, number> | undefined,
): CatalogueQtyContext {
  const s = summary || {};
  return {
    concrete: s.concrete,
    formwork: s.formwork,
    steel: s.steel,
    excavation: s.excavation,
    disposal: s.disposal,
    masonry: s.masonry,
    blinding: s.blinding,
  };
}
import {
  CEMENT_BAG_KG,
  FORMWORK_WASTE,
  LABOUR_RATES,
  PLY_SHEET_M2,
  TIE_WIRE,
  lineAmount,
  mixFor,
  type RateAccessors,
} from './pricing';
import type {
  ElementReportBundle,
  LabourActivity,
  ReportLine,
  TradeSummary,
} from './types';

function normUnit(u: unknown): string {
  return String(u ?? '')
    .trim()
    .toLowerCase()
    .replace('³', '3')
    .replace('²', '2');
}

function item(
  ref: string,
  description: string,
  qty: number,
  unit: string,
  rate: number | null,
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
    source: 'CATALOGUE',
  };
}

function group(description: string): ReportLine {
  return { kind: 'group', description, source: 'CATALOGUE' };
}

function total(description: string, amount: number): ReportLine {
  return { kind: 'total', description, amount, source: 'CATALOGUE' };
}

function labourBundle(
  activities: LabourActivity[],
  manDays: Record<string, number>,
  labRate: (trade: string) => number,
): ElementReportBundle['labour'] {
  const trades: TradeSummary[] = Object.keys(manDays)
    .sort()
    .map((trade) => {
      const md = manDays[trade];
      const dayRate = labRate(trade);
      return { trade, manDays: md, dayRate, cost: md * dayRate, source: 'CATALOGUE' };
    });
  return {
    activities,
    trades,
    totalManDays: trades.reduce((s, t) => s + t.manDays, 0),
    totalCost: trades.reduce((s, t) => s + t.cost, 0),
  };
}

function structuralLabour(
  totalConcrete: number,
  totalFormwork: number,
  totalSteel: number,
  rates: RateAccessors,
): ElementReportBundle['labour'] {
  const manDays: Record<string, number> = {};
  const activities: LabourActivity[] = [];
  let ref = 0;
  const push = (key: keyof typeof LABOUR_RATES, qty: number) => {
    if (!(qty > 0)) return;
    const r = LABOUR_RATES[key];
    const days = Math.ceil(qty / r.perDay);
    r.gang.forEach(([role, cnt]) => {
      manDays[role] = (manDays[role] || 0) + days * cnt;
    });
    ref++;
    activities.push({
      ref: `L${ref}`,
      activity: r.label,
      qty,
      unit: r.unit,
      outputRate: `${r.perDay} ${r.unit}/day`,
      gang: r.gang.map(([role, cnt]) => `${cnt} ${role}`).join(' + '),
      days,
      source: 'CATALOGUE',
    });
  };
  push('concrete', totalConcrete);
  push('formwork', totalFormwork);
  push('reinforcement', totalSteel);
  return labourBundle(activities, manDays, rates.labRate);
}

/** Qty taken off on bound catalogue lines (overrides schedule). */
export function qtyOverridesFromBoq(
  elementKey: string,
  boq: ReportLine[],
): Partial<CatalogueQtyContext> {
  const out: Partial<CatalogueQtyContext> = {};
  const add = (key: keyof CatalogueQtyContext, n: number) => {
    out[key] = (Number(out[key]) || 0) + n;
  };
  for (const line of boq) {
    if (line.kind !== 'item' || !line.selectedBoqId) continue;
    const qty = Number(line.qty) || 0;
    if (!(qty > 0) || !line.ref) continue;
    const role = roleForRef(elementKey, line.ref);
    if (!role) continue;
    if (role === 'steel') {
      add('steel', normUnit(line.unit) === 't' ? qty * 1000 : qty);
    } else {
      add(role, qty);
    }
  }
  return out;
}

function mergeMeasured(
  engine: CatalogueQtyContext,
  override: Partial<CatalogueQtyContext>,
): CatalogueQtyContext {
  const pick = (key: keyof CatalogueQtyContext) => {
    const o = override[key];
    if (o != null && o > 0) return o;
    return Number(engine[key]) || 0;
  };
  return {
    concrete: pick('concrete'),
    formwork: pick('formwork'),
    steel: pick('steel'),
    excavation: pick('excavation'),
    disposal: pick('disposal'),
    masonry: pick('masonry'),
    blinding: pick('blinding'),
  };
}

function hasOverride(override: Partial<CatalogueQtyContext>): boolean {
  return Object.values(override).some((v) => (Number(v) || 0) > 0);
}

function buildStructuralBomLabour(
  ctx: CatalogueQtyContext,
  materials: ProjectMaterials,
  rates: RateAccessors,
): { bom: ReportLine[]; labour: ElementReportBundle['labour']; bomTot: number } {
  const bom: ReportLine[] = [];
  let bomTot = 0;
  const grade = materials.defaultConcreteGrade || 'C25/30';
  const vol = ctx.concrete || 0;
  const m = mixFor(grade, materials);
  const push = (
    ref: string,
    desc: string,
    qty: number,
    unit: string,
    code: string,
    dec: number,
    isRebar = false,
  ) => {
    if (!(qty > 0)) return;
    const rate = rates.matRate(code);
    bom.push(item(ref, desc, qty, unit, rate, { dec, isRebar }));
    const a = lineAmount(qty, rate);
    if (a != null) bomTot += a;
  };

  bom.push(group('A — Concrete materials'));
  push('A1', `Cement (${CEMENT_BAG_KG}kg bags)`, (vol * m.cement) / CEMENT_BAG_KG, 'bags', 'cementBag', 1);
  push('A2', 'Sand (fine aggregate)', vol * m.sand, 'm³', 'sand', 2);
  push('A3', 'Coarse aggregate', vol * m.agg, 'm³', 'aggregate', 2);
  push('A4', 'Water', vol * m.water, 'L', 'water', 0);

  const sheets = Math.ceil(((ctx.formwork || 0) * (1 + FORMWORK_WASTE)) / PLY_SHEET_M2);
  bom.push(group('B — Formwork materials'));
  push(
    'B1',
    'Plywood formwork sheets (2440×1220mm), incl. 15% wastage',
    sheets,
    'nos',
    'plywoodSheet',
    0,
  );

  const steelKg = ctx.steel || 0;
  bom.push(group('C — Reinforcement materials'));
  if (steelKg > 0) {
    push('C1', 'Reinforcement bars', steelKg, 'kg', 'rebarKg', 2, true);
    push('C2', 'Binding/tying wire', steelKg * TIE_WIRE, 'kg', 'tieWire', 2, true);
  }

  bom.push(total('Materials total', bomTot));
  const labour = structuralLabour(vol, ctx.formwork || 0, steelKg, rates);
  return { bom, labour, bomTot };
}

function buildMasonryBomLabour(
  ctx: CatalogueQtyContext,
  materials: ProjectMaterials,
  rates: RateAccessors,
): { bom: ReportLine[]; labour: ElementReportBundle['labour']; bomTot: number } {
  const mas = ctx.masonry || 0;
  const blinding = ctx.blinding || 0;
  const frac = materials.stoneMortarFraction ?? 0.3;
  const mortar = mas * frac;
  const mortarMix = { cementBagsPerM3: 7.2, sandM3PerM3: 1.0 };
  const blindMix = mixFor('C15/20', materials);
  const bom: ReportLine[] = [];
  let bomTot = 0;
  const push = (
    ref: string,
    desc: string,
    qty: number,
    unit: string,
    code: string,
    dec: number,
  ) => {
    const rate = rates.matRate(code);
    bom.push(item(ref, desc, qty, unit, rate, { dec }));
    const a = lineAmount(qty, rate);
    if (a != null) bomTot += a;
  };
  bom.push(group('A — Stone & mortar'));
  push('A1', 'Building stone (rubble)', mas, 'm³', 'stone', 2);
  push('A2', `Cement for mortar (${CEMENT_BAG_KG}kg bags)`, mortar * mortarMix.cementBagsPerM3, 'bags', 'cementBag', 1);
  push('A3', 'Sand for mortar', mortar * mortarMix.sandM3PerM3, 'm³', 'sand', 2);
  if (blinding > 0) {
    bom.push(group('B — Blinding concrete'));
    push('B1', `Cement (${CEMENT_BAG_KG}kg bags)`, (blinding * blindMix.cement) / CEMENT_BAG_KG, 'bags', 'cementBag', 1);
    push('B2', 'Sand', blinding * blindMix.sand, 'm³', 'sand', 2);
    push('B3', 'Coarse aggregate', blinding * blindMix.agg, 'm³', 'aggregate', 2);
  }
  bom.push(total('Materials total', bomTot));

  const masDays = mas > 0 ? Math.ceil(mas / 1.5) : 0;
  const manDays: Record<string, number> = masDays
    ? { Mason: masDays, Labourer: masDays * 2 }
    : {};
  const activities: LabourActivity[] = masDays
    ? [
        {
          ref: 'L1',
          activity: 'Lay stone masonry in mortar',
          qty: mas,
          unit: 'm³',
          outputRate: '1.5 m³/day',
          gang: '1 Mason + 2 Labourer',
          days: masDays,
          source: 'CATALOGUE',
        },
      ]
    : [];
  return {
    bom,
    labour: labourBundle(activities, manDays, rates.labRate),
    bomTot,
  };
}

function buildEarthworksLabour(
  ctx: CatalogueQtyContext,
  rates: RateAccessors,
): ElementReportBundle['labour'] {
  const excavation = ctx.excavation || 0;
  const days = excavation > 0 ? Math.ceil(excavation / 25) : 0;
  if (!days) return labourBundle([], {}, rates.labRate);
  return labourBundle(
    [
      {
        ref: 'L1',
        activity: 'Excavate, load and trim formation',
        qty: excavation,
        unit: 'm³',
        outputRate: '25 m³/day',
        gang: '1 Plant Operator + 2 Labourer',
        days,
        source: 'CATALOGUE',
      },
    ],
    { 'Plant Operator': days, Labourer: days * 2 },
    rates.labRate,
  );
}

/**
 * Rebuild each element's BOM / labour from takeoff qtys on bound BOQ lines.
 * Bound lines with qty > 0 override schedule; other measured values stay.
 */
export function applyBoqQuantitiesToBomLabour(
  byElement: ElementReportBundle[],
  opts: {
    materials: ProjectMaterials;
    rates: RateAccessors;
    floorLevelTypesByElement?: Record<string, FloorLevelType[] | 'all'>;
  },
): ElementReportBundle[] {
  return byElement.map((be) => {
    const override = qtyOverridesFromBoq(be.elementKey, be.boq);
    if (!hasOverride(override)) return be;

    const ctx = mergeMeasured(qtyContextFromSummary(be.summary), override);
    const summary = {
      ...be.summary,
      ...(ctx.concrete ? { concrete: ctx.concrete } : {}),
      ...(ctx.formwork ? { formwork: ctx.formwork } : {}),
      ...(ctx.steel ? { steel: ctx.steel } : {}),
      ...(ctx.excavation ? { excavation: ctx.excavation } : {}),
      ...(ctx.disposal ? { disposal: ctx.disposal } : {}),
      ...(ctx.masonry ? { masonry: ctx.masonry } : {}),
      ...(ctx.blinding ? { blinding: ctx.blinding } : {}),
    };

    if (be.kind === 'structural') {
      const built = buildStructuralBomLabour(ctx, opts.materials, opts.rates);
      return {
        ...be,
        units: be.units || 1,
        bom: built.bom,
        labour: built.labour,
        summary,
        cost: { ...be.cost, bom: built.bomTot, labour: built.labour.totalCost },
      };
    }
    if (be.kind === 'masonry') {
      const built = buildMasonryBomLabour(ctx, opts.materials, opts.rates);
      return {
        ...be,
        units: be.units || 1,
        bom: built.bom,
        labour: built.labour,
        summary,
        cost: { ...be.cost, bom: built.bomTot, labour: built.labour.totalCost },
      };
    }
    if (be.kind === 'earthworks') {
      const labour = buildEarthworksLabour(ctx, opts.rates);
      return {
        ...be,
        units: be.units || 1,
        labour,
        summary,
        cost: { ...be.cost, labour: labour.totalCost },
      };
    }
    return { ...be, summary, units: be.units || 1 };
  });
}

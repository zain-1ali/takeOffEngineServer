import { round } from '../../engines/math';
import {
  calcEarthwork,
  calcFinish,
  calcDoorsWindows,
  calcMasonry,
  calcSkirting,
  calcStair,
  calcStone,
  calcDuct,
  calcPipe,
  calcElectrical,
  calcDuctFitting,
  type FinishKind,
  type MaterialsConfig,
  type StructuralCalcResult,
} from '../../engines';
import type { StairBreakdown, StairInput } from '../../engines/stairs';
import type { LintelInput } from '../../engines/lintels';
import { calcLintel } from '../../engines/lintels';
import {
  DEFAULT_PLASTER_MIX,
  DEFAULT_SCREED_MIX,
} from '../../defaults/mixDefaults';
import type { IInstance } from '../../models/Instance';
import { flattenInstance } from '../flattenInstance';
import { ELEMENT_META, type ElementMeta } from './elementMeta';
import { finishBoqDesc } from './finishBoqDesc';
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
import { buildCatalogueCoreBoq } from './boqCatalogue/buildCatalogueCoreBoq';
import { isBoqCatalogueEnabled } from './boqCatalogue/types';
import {
  resolveFloorLevelTypes,
  type FloorLevelType,
} from '../../lib/levelCompatibility';

export type ReportEntry = {
  elementKey: string;
  floorId: string;
  inst: IInstance;
  flat: Record<string, unknown>;
  /** Resolved floor level types for BOQ catalogue Applicable Level filtering. */
  floorLevelTypes?: FloorLevelType[];
};

function group(description: string): ReportLine {
  return { kind: 'group', description };
}

function item(
  ref: string,
  description: string,
  qty: number,
  unit: string,
  rate: number | null,
  opts?: { isRebar?: boolean; dec?: number },
): ReportLine {
  const amount = lineAmount(qty, rate);
  return {
    kind: 'item',
    ref,
    description,
    qty,
    unit,
    rate,
    amount,
    isRebar: opts?.isRebar,
    dec: opts?.dec,
  };
}

function total(description: string, amount: number): ReportLine {
  return { kind: 'total', description, amount };
}

export type StructuralCalculator = (
  elementKey: string,
  flat: Record<string, unknown>,
) => StructuralCalcResult;

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
      return { trade, manDays: md, dayRate, cost: md * dayRate };
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
    });
  };
  push('concrete', totalConcrete);
  push('formwork', totalFormwork);
  push('reinforcement', totalSteel);
  return labourBundle(activities, manDays, rates.labRate);
}

export type StructuralAgg = {
  concreteByGrade: Record<string, number>;
  steelByDia: Record<string, number>;
  totalConcrete: number;
  totalFormwork: number;
  totalSoffitFormwork: number;
  totalVerticalFormwork: number;
  totalSteel: number;
  units: number;
  count: number;
};

export function aggregateStructural(
  entries: ReportEntry[],
  calculate: StructuralCalculator,
): StructuralAgg {
  const concreteByGrade: Record<string, number> = {};
  const steelByDia: Record<string, number> = {};
  let totalConcrete = 0;
  let totalFormwork = 0;
  let totalSoffitFormwork = 0;
  let totalVerticalFormwork = 0;
  let totalSteel = 0;
  let units = 0;

  entries.forEach(({ elementKey, flat, inst }) => {
    const n = inst.count || 1;
    units += n;
    const calc = calculate(elementKey, flat);
    const grade = String(inst.concreteGrade || flat.concreteGrade || '');
    concreteByGrade[grade] = (concreteByGrade[grade] || 0) + calc.totalVolumeM3;
    totalConcrete += calc.totalVolumeM3;
    totalFormwork += calc.totalFormworkM2;
    totalSoffitFormwork += calc.totalSoffitFormworkM2 || 0;
    totalVerticalFormwork +=
      calc.totalVerticalFormworkM2 ?? calc.totalFormworkM2;
    totalSteel += calc.totalRebarKg;
    (calc.perUnit.rebar.groups || []).forEach((g) => {
      const k = String(g.diameterMm);
      steelByDia[k] = (steelByDia[k] || 0) + g.weightKg * n;
    });
  });

  Object.keys(concreteByGrade).forEach((k) => {
    concreteByGrade[k] = round(concreteByGrade[k]);
  });
  Object.keys(steelByDia).forEach((k) => {
    steelByDia[k] = round(steelByDia[k]);
  });

  return {
    concreteByGrade,
    steelByDia,
    totalConcrete: round(totalConcrete),
    totalFormwork: round(totalFormwork),
    totalSoffitFormwork: round(totalSoffitFormwork),
    totalVerticalFormwork: round(totalVerticalFormwork),
    totalSteel: round(totalSteel),
    units,
    count: entries.length,
  };
}

function floorLevelTypesFromEntries(
  entries: ReportEntry[],
): FloorLevelType[] | 'all' {
  const all: FloorLevelType[] = []
  for (const e of entries) {
    if (e.floorLevelTypes?.length) all.push(...e.floorLevelTypes)
  }
  if (!all.length) return 'all'
  return [...new Set(all)]
}

export function buildStructuralReports(
  meta: ElementMeta,
  entries: ReportEntry[],
  rates: RateAccessors,
  calculate: StructuralCalculator,
  materials?: MaterialsConfig | null,
): ElementReportBundle {
  const agg = aggregateStructural(entries, calculate);
  const floorLevelTypes = floorLevelTypesFromEntries(entries);
  let boq: ReportLine[] = [];
  let boqTot = 0;

  const catalogueBoq =
    isBoqCatalogueEnabled()
      ? buildCatalogueCoreBoq({
          elementKey: meta.key,
          agg: {
            concreteByGrade: agg.concreteByGrade,
            totalFormwork: agg.totalFormwork,
            steelByDia: agg.steelByDia,
            totalConcrete: agg.totalConcrete,
            totalSteel: agg.totalSteel,
          },
          rates,
          floorLevelTypes,
        })
      : null;

  if (catalogueBoq) {
    boq = catalogueBoq.lines;
    boqTot = catalogueBoq.boqTot;
  } else {
    boq.push(group('A — In-situ concrete'));
    let ai = 0;
    Object.keys(agg.concreteByGrade)
      .sort()
      .forEach((grade) => {
        const q = agg.concreteByGrade[grade];
        if (!(q > 0)) return;
        ai++;
        const rate = rates.boqRate('concrete');
        const desc = meta.concreteDesc?.(grade) || `Concrete grade ${grade}`;
        boq.push(item(`A${ai}`, desc, q, 'm³', rate));
        const a = lineAmount(q, rate);
        if (a != null) boqTot += a;
      });

    boq.push(group('B — Formwork'));
    {
      const rate = rates.boqRate('formwork');
      boq.push(item('B1', meta.formworkDesc || 'Formwork', agg.totalFormwork, 'm²', rate));
      const a = lineAmount(agg.totalFormwork, rate);
      if (a != null) boqTot += a;
    }

    boq.push(group('C — Reinforcement / steel'));
    let ci = 0;
    Object.keys(agg.steelByDia)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((dia) => {
        const kg = agg.steelByDia[String(dia)];
        if (!(kg > 0)) return;
        ci++;
        const t = kg / 1000;
        const rate = rates.boqRate('rebar');
        const desc = meta.rebarDesc?.(dia) || `Reinforcement H${dia}`;
        boq.push(item(`C${ci}`, desc, t, 't', rate, { isRebar: true, dec: 3 }));
        const a = lineAmount(t, rate);
        if (a != null) boqTot += a;
      });

    boq.push(total('Element total (excl. prelims & OH&P)', boqTot));
  }
  /* BOM */
  const bom: ReportLine[] = [];
  let bomTot = 0;
  let cement = 0;
  let sand = 0;
  let aggr = 0;
  let water = 0;
  Object.entries(agg.concreteByGrade).forEach(([grade, vol]) => {
    const m = mixFor(grade, materials as any);
    cement += vol * m.cement;
    sand += vol * m.sand;
    aggr += vol * m.agg;
    water += vol * m.water;
  });
  const cementBags = cement / CEMENT_BAG_KG;
  bom.push(group('A — Concrete materials'));
  const pushBom = (ref: string, desc: string, qty: number, unit: string, code: string, dec: number, isRebar = false) => {
    const rate = rates.matRate(code);
    bom.push(item(ref, desc, qty, unit, rate, { dec, isRebar }));
    const a = lineAmount(qty, rate);
    if (a != null) bomTot += a;
  };
  pushBom('A1', `Cement (${CEMENT_BAG_KG}kg bags)`, cementBags, 'bags', 'cementBag', 1);
  pushBom('A2', 'Sand (fine aggregate)', sand, 'm³', 'sand', 2);
  pushBom('A3', 'Coarse aggregate', aggr, 'm³', 'aggregate', 2);
  pushBom('A4', 'Water', water, 'L', 'water', 0);

  const sheets = Math.ceil((agg.totalFormwork * (1 + FORMWORK_WASTE)) / PLY_SHEET_M2);
  bom.push(group('B — Formwork materials'));
  pushBom('B1', 'Plywood formwork sheets (2440×1220mm), incl. 15% wastage', sheets, 'nos', 'plywoodSheet', 0);
  // Indicative support allowances (revision-gated kg/m² on project materials).
  const bracingRate =
    (materials as { verticalBracingRate?: number } | null | undefined)
      ?.verticalBracingRate ?? 0;
  const propRate =
    (materials as { soffitPropRate?: number } | null | undefined)?.soffitPropRate ??
    0;
  const bracingKg = round(agg.totalVerticalFormwork * bracingRate, 2);
  const propKg = round(agg.totalSoffitFormwork * propRate, 2);
  if (bracingKg > 0) {
    pushBom(
      'B2',
      'Vertical formwork bracing (timber/props/stakes) — indicative',
      bracingKg,
      'kg',
      'formworkBracingKg',
      2,
    );
  }
  if (propKg > 0) {
    pushBom(
      'B3',
      'Soffit falsework / props — indicative',
      propKg,
      'kg',
      'formworkSoffitPropKg',
      2,
    );
  }

  bom.push(group('C — Reinforcement materials'));
  let cbi = 0;
  let totalSteelKg = 0;
  Object.keys(agg.steelByDia)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((dia) => {
      cbi++;
      const kg = agg.steelByDia[String(dia)];
      totalSteelKg += kg;
      pushBom(`C${cbi}`, `Reinforcement bars, H${dia}`, kg, 'kg', 'rebarKg', 2, true);
    });
  pushBom(`C${cbi + 1}`, 'Binding/tying wire', totalSteelKg * TIE_WIRE, 'kg', 'tieWire', 2, true);
  bom.push(total('Materials total', bomTot));

  const labour = structuralLabour(agg.totalConcrete, agg.totalFormwork, agg.totalSteel, rates);

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'structural',
    units: agg.units,
    boq,
    bom,
    labour,
    summary: {
      concrete: agg.totalConcrete,
      formwork: agg.totalFormwork,
      steel: agg.totalSteel,
    },
    cost: { boq: boqTot, bom: bomTot, labour: labour.totalCost },
  };
}

/**
 * Stairs BOQ: Flight / Landing / Stair beam concrete;
 * formwork = Soffit (m²) + Riser (lm) + Side (lm).
 * Riser/side lm use Assumption 2 — labeled indicative pending client confirmation.
 */
export function buildStairReports(
  entries: ReportEntry[],
  rates: RateAccessors,
  materials?: MaterialsConfig | null,
): ElementReportBundle {
  const meta = ELEMENT_META.STAIRS;
  let units = 0;
  let totalConcrete = 0;
  let totalSoffit = 0;
  let totalVertical = 0;
  let totalFormwork = 0;
  let totalSteel = 0;
  const concreteByGrade: Record<string, number> = {};
  const steelByDia: Record<string, number> = {};
  const flightLines: { label: string; qty: number }[] = [];
  const landingLines: { label: string; qty: number }[] = [];
  const stairBeamLines: { label: string; qty: number }[] = [];
  let riserLm = 0;
  let sideLm = 0;
  let landingEdgeLm = 0;
  let soffitM2 = 0;

  entries.forEach(({ flat, inst }) => {
    const result = calcStair(flat as unknown as StairInput);
    const n = inst.count || 1;
    units += n;
    const grade = String(inst.concreteGrade || flat.concreteGrade || 'C25/30');
    totalConcrete += result.totalVolumeM3;
    totalFormwork += result.totalFormworkM2;
    totalSoffit += result.totalSoffitFormworkM2;
    totalVertical += result.totalVerticalFormworkM2;
    totalSteel += result.totalRebarKg;
    concreteByGrade[grade] =
      (concreteByGrade[grade] || 0) + result.totalVolumeM3;
    const bd = result.stairBreakdown as StairBreakdown;
    for (const fl of bd.flights) {
      flightLines.push({ label: fl.label, qty: round(fl.volumeM3 * n) });
      riserLm += fl.riserLm * n;
      sideLm += fl.sideLm * n;
      soffitM2 += fl.soffitM2 * n;
    }
    for (const ld of bd.landings) {
      landingLines.push({ label: ld.label, qty: round(ld.volumeM3 * n) });
      landingEdgeLm += ld.edgeLm * n;
      soffitM2 += (ld.soffitM2 + ld.stairBeamSoffitM2) * n;
      if (ld.stairBeamVolumeM3 > 0) {
        stairBeamLines.push({
          label: ld.label,
          qty: round(ld.stairBeamVolumeM3 * n),
        });
      }
    }
    for (const g of result.perUnit.rebar.groups) {
      const key = String(g.diameterMm);
      steelByDia[key] = (steelByDia[key] || 0) + g.weightKg * n;
    }
  });

  riserLm = round(riserLm);
  sideLm = round(sideLm);
  landingEdgeLm = round(landingEdgeLm);
  soffitM2 = round(soffitM2);

  const boq: ReportLine[] = [];
  let boqTot = 0;
  let ai = 0;
  const push = (
    description: string,
    qty: number,
    unit: string,
    rate: number | null,
    dec = 2,
  ) => {
    if (!(qty > 0)) return;
    ai++;
    boq.push(item(`A${ai}`, description, qty, unit, rate, { dec }));
    const a = lineAmount(qty, rate);
    if (a != null) boqTot += a;
  };

  boq.push(group('A — In-situ concrete'));
  const concRate = rates.boqRate('concrete');
  for (const fl of flightLines) {
    push(
      `Reinforced in-situ concrete in stair flights — ${fl.label}; waist slab and steps`,
      fl.qty,
      'm³',
      concRate,
    );
  }
  for (const ld of landingLines) {
    push(
      `Reinforced in-situ concrete in stair landing — ${ld.label}`,
      ld.qty,
      'm³',
      concRate,
    );
  }
  for (const sb of stairBeamLines) {
    push(
      `Reinforced in-situ concrete in stair beam at ${sb.label}`,
      sb.qty,
      'm³',
      concRate,
    );
  }

  boq.push(group('B — Formwork'));
  const fwRate = rates.boqRate('formwork');
  const fwLmRate = rates.boqRate('formworkLm') ?? fwRate;
  push(
    'Formwork to soffits of stair flights and landings; including striking',
    soffitM2,
    'm²',
    fwRate,
  );
  push(
    'Formwork to risers of stairs (lm) — indicative, verify before procurement',
    riserLm,
    'lm',
    fwLmRate,
  );
  push(
    'Formwork to exposed sides of stair flights (lm) — indicative, verify before procurement',
    sideLm,
    'lm',
    fwLmRate,
  );
  if (landingEdgeLm > 0) {
    push(
      'Formwork to edges of stair landings (lm) — indicative, verify before procurement',
      landingEdgeLm,
      'lm',
      fwLmRate,
    );
  }

  boq.push(group('C — Reinforcement / steel'));
  let ci = 0;
  Object.keys(steelByDia)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((dia) => {
      const kg = steelByDia[String(dia)];
      if (!(kg > 0)) return;
      ci++;
      const t = kg / 1000;
      const rate = rates.boqRate('rebar');
      boq.push(
        item(
          `C${ci}`,
          `High-yield reinforcement bars, dia. ${dia} mm, cut and fixed in stairs`,
          t,
          't',
          rate,
          { isRebar: true, dec: 3 },
        ),
      );
      const a = lineAmount(t, rate);
      if (a != null) boqTot += a;
    });

  boq.push(total('Element total (excl. prelims & OH&P)', round(boqTot)));
  boqTot = round(boqTot);

  const labour = structuralLabour(
    totalConcrete,
    totalFormwork,
    totalSteel,
    rates,
  );

  // BOM via materials from grade totals (same as structural)
  const bom: ReportLine[] = [];
  let bomTot = 0;
  let cement = 0;
  let sand = 0;
  let aggr = 0;
  let water = 0;
  Object.entries(concreteByGrade).forEach(([grade, vol]) => {
    const m = mixFor(grade, materials as any);
    cement += vol * m.cement;
    sand += vol * m.sand;
    aggr += vol * m.agg;
    water += vol * m.water;
  });
  const pushBom = (
    ref: string,
    desc: string,
    qty: number,
    unit: string,
    code: string,
    dec: number,
    isRebar = false,
  ) => {
    const rate = rates.matRate(code);
    bom.push(item(ref, desc, qty, unit, rate, { dec, isRebar }));
    const a = lineAmount(qty, rate);
    if (a != null) bomTot += a;
  };
  bom.push(group('A — Concrete materials'));
  pushBom(
    'A1',
    `Cement (${CEMENT_BAG_KG}kg bags)`,
    cement / CEMENT_BAG_KG,
    'bags',
    'cementBag',
    1,
  );
  pushBom('A2', 'Sand (fine aggregate)', sand, 'm³', 'sand', 2);
  pushBom('A3', 'Coarse aggregate', aggr, 'm³', 'aggregate', 2);
  pushBom('A4', 'Water', water, 'L', 'water', 0);
  const sheets = Math.ceil(
    (totalFormwork * (1 + FORMWORK_WASTE)) / PLY_SHEET_M2,
  );
  bom.push(group('B — Formwork materials'));
  pushBom(
    'B1',
    'Plywood formwork sheets (2440×1220mm), incl. 15% wastage',
    sheets,
    'nos',
    'plywoodSheet',
    0,
  );
  const bracingRate =
    (materials as { verticalBracingRate?: number } | null | undefined)
      ?.verticalBracingRate ?? 0;
  const propRate =
    (materials as { soffitPropRate?: number } | null | undefined)
      ?.soffitPropRate ?? 0;
  const bracingKg = round(totalVertical * bracingRate, 2);
  const propKg = round(totalSoffit * propRate, 2);
  if (bracingKg > 0) {
    pushBom(
      'B2',
      'Vertical formwork bracing (timber/props/stakes) — indicative',
      bracingKg,
      'kg',
      'formworkBracingKg',
      2,
    );
  }
  if (propKg > 0) {
    pushBom(
      'B3',
      'Soffit falsework / props — indicative',
      propKg,
      'kg',
      'formworkSoffitPropKg',
      2,
    );
  }
  bom.push(group('C — Reinforcement materials'));
  let cbi = 0;
  let totalSteelKg = 0;
  Object.keys(steelByDia)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((dia) => {
      cbi++;
      const kg = steelByDia[String(dia)];
      totalSteelKg += kg;
      pushBom(`C${cbi}`, `Reinforcement bars, H${dia}`, kg, 'kg', 'rebarKg', 2, true);
    });
  pushBom(
    `C${cbi + 1}`,
    'Binding/tying wire',
    totalSteelKg * TIE_WIRE,
    'kg',
    'tieWire',
    2,
    true,
  );
  bom.push(total('Materials total', bomTot));

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'structural',
    units,
    boq,
    bom,
    labour,
    summary: {
      concrete: round(totalConcrete),
      formwork: soffitM2,
      steel: round(totalSteel),
      riserLm,
      sideLm,
    },
    cost: { boq: boqTot, bom: bomTot, labour: labour.totalCost },
  };
}

export function buildStoneReports(
  entries: ReportEntry[],
  materials: MaterialsConfig & { stoneMortarRatio?: string },
  rates: RateAccessors,
): ElementReportBundle {
  const meta = ELEMENT_META.STONE_STRIP;
  let mas = 0;
  let mortar = 0;
  let blinding = 0;
  let units = 0;
  entries.forEach(({ flat, inst }) => {
    const c = calcStone(flat as any, materials);
    mas += c.totalMasonryM3;
    mortar += c.totalMortarM3;
    blinding += c.totalBlindingM3;
    units += inst.count || 1;
  });
  mas = round(mas);
  mortar = round(mortar);
  blinding = round(blinding);

  const mortarMix = (materials as { mortarMix?: { cementBagsPerM3: number; sandM3PerM3: number } })
    .mortarMix || { cementBagsPerM3: 7.2, sandM3PerM3: 1.0 };
  const cementBags = mortar * mortarMix.cementBagsPerM3;
  const sand = mortar * mortarMix.sandM3PerM3;
  const blindMix = mixFor('C15/20', materials as any);
  const ratio = materials.stoneMortarRatio || '1:4';

  let boq: ReportLine[] = [];
  let boqTot = 0;
  const catalogueBoq =
    isBoqCatalogueEnabled()
      ? buildCatalogueCoreBoq({
          elementKey: meta.key,
          agg: {
            concreteByGrade: {},
            totalFormwork: 0,
            steelByDia: {},
            totalConcrete: 0,
            totalSteel: 0,
          },
          rates,
          floorLevelTypes: floorLevelTypesFromEntries(entries),
          extras: { masonryM3: mas, blindingM3: blinding },
        })
      : null;
  if (catalogueBoq) {
    boq = catalogueBoq.lines;
    boqTot = catalogueBoq.boqTot;
  } else {
    boq.push(group('A — Stone masonry'));
    {
      const rate = rates.boqRate('stoneMasonry');
      boq.push(
        item(
          'A1',
          `Random rubble stone masonry in cement mortar (${ratio}), in strip foundations`,
          mas,
          'm³',
          rate,
        ),
      );
      const a = lineAmount(mas, rate);
      if (a != null) boqTot += a;
    }
    if (blinding > 0) {
      boq.push(group('B — Blinding'));
      const rate = rates.boqRate('blinding');
      boq.push(
        item('B1', 'Lean concrete blinding, grade C15/20, under stone footing', blinding, 'm³', rate),
      );
      const a = lineAmount(blinding, rate);
      if (a != null) boqTot += a;
    }
    boq.push(total('Stone foundation total', boqTot));
  }

  const bom: ReportLine[] = [];
  let bomTot = 0;
  const pushBom = (ref: string, desc: string, qty: number, unit: string, code: string, dec: number) => {
    const rate = rates.matRate(code);
    bom.push(item(ref, desc, qty, unit, rate, { dec }));
    const a = lineAmount(qty, rate);
    if (a != null) bomTot += a;
  };
  bom.push(group('A — Stone & mortar'));
  pushBom('A1', 'Building stone (rubble)', mas * 1.0, 'm³', 'stone', 2);
  pushBom('A2', `Cement for mortar (${CEMENT_BAG_KG}kg bags)`, cementBags, 'bags', 'cementBag', 1);
  pushBom('A3', 'Sand for mortar', sand, 'm³', 'sand', 2);
  if (blinding > 0) {
    bom.push(group('B — Blinding concrete'));
    pushBom('B1', `Cement (${CEMENT_BAG_KG}kg bags)`, (blinding * blindMix.cement) / CEMENT_BAG_KG, 'bags', 'cementBag', 1);
    pushBom('B2', 'Sand', blinding * blindMix.sand, 'm³', 'sand', 2);
    pushBom('B3', 'Coarse aggregate', blinding * blindMix.agg, 'm³', 'aggregate', 2);
  }
  bom.push(total('Materials total', bomTot));

  const masDays = Math.ceil(mas / 1.5);
  const manDays: Record<string, number> = {
    Mason: masDays,
    Labourer: masDays * 2,
  };
  const activities: LabourActivity[] = [
    {
      ref: 'L1',
      activity: 'Lay stone masonry in mortar',
      qty: mas,
      unit: 'm³',
      outputRate: '1.5 m³/day',
      gang: '1 Mason + 2 Labourer',
      days: masDays,
    },
  ];
  const labour = labourBundle(activities, manDays, rates.labRate);

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'masonry',
    units,
    boq,
    bom,
    labour,
    summary: { masonry: mas, mortar, blinding },
    cost: { boq: boqTot, bom: bomTot, labour: labour.totalCost },
  };
}

export function buildFinishReports(
  elementKey: string,
  finishKind: FinishKind,
  entries: ReportEntry[],
  materials: MaterialsConfig,
  rates: RateAccessors,
): ElementReportBundle {
  const meta = ELEMENT_META[elementKey];
  let area = 0;
  let screed = 0;
  let plaster = 0;
  let paintL = 0;
  let tiles = 0;
  let units = 0;
  /** roomLabel → spec → measured quantities. */
  const byRoomSpec: Record<
    string,
    Record<string, { area: number; screed: number; tiles: number }>
  > = {};

  entries.forEach(({ flat, inst }) => {
    const c = calcFinish(finishKind, flat as any, materials);
    area += c.totalAreaM2;
    screed += c.totalScreedM3;
    plaster += c.totalPlasterM3;
    paintL += c.totalPaintL;
    tiles += c.totalTilesM2;
    units += inst.count || 1;
    const spec = String(inst.spec || flat.spec || 'Finish');
    const roomRaw = flat.roomLabel ?? (inst as { geometry?: { roomLabel?: unknown } }).geometry?.roomLabel;
    const room =
      typeof roomRaw === 'string' && roomRaw.trim() ? roomRaw.trim() : '';
    if (!byRoomSpec[room]) byRoomSpec[room] = {};
    const prev = byRoomSpec[room][spec] || { area: 0, screed: 0, tiles: 0 };
    byRoomSpec[room][spec] = {
      area: prev.area + c.totalAreaM2,
      screed: prev.screed + c.totalScreedM3,
      tiles: prev.tiles + c.totalTilesM2,
    };
  });
  area = round(area);
  screed = round(screed);
  plaster = round(plaster);
  paintL = round(paintL, 1);
  tiles = round(tiles);

  const areaRateCode =
    finishKind === 'FLOOR' ? 'floorFinish' : finishKind === 'WALL' ? 'wallFinish' : 'ceilingFinish';
  const areaRate = rates.boqRate(areaRateCode);
  const screedRate = rates.boqRate('floorScreed');
  const tilingRate = rates.boqRate('floorTiling');

  const boq: ReportLine[] = [];
  let boqTot = 0;
  boq.push(group(`A — ${meta.label}`));
  let i = 0;
  const roomKeys = Object.keys(byRoomSpec).sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });

  const pushBoqItem = (
    description: string,
    qty: number,
    unit: string,
    rate: number | null,
  ) => {
    i++;
    boq.push(item(`A${i}`, description, qty, unit, rate));
    const a = lineAmount(qty, rate);
    if (a != null) boqTot += a;
    return a || 0;
  };

  roomKeys.forEach((room) => {
    const specs = byRoomSpec[room];
    let roomAmt = 0;
    let roomArea = 0;
    if (room) {
      boq.push(group(`Room — ${room}`));
    }
    Object.keys(specs).forEach((spec) => {
      const q = specs[spec];
      roomArea += q.area;
      const screedThk =
        (materials as { screedThickness?: number }).screedThickness ?? 0.05;
      // Multi-material floor (screed + tiles): two independent BOQ lines
      if (finishKind === 'FLOOR' && q.screed > 0 && q.tiles > 0) {
        roomAmt += pushBoqItem(
          finishBoqDesc('FLOOR', spec, {
            part: 'screed',
            screedThicknessM: screedThk,
          }),
          round(q.screed),
          'm³',
          screedRate,
        );
        roomAmt += pushBoqItem(
          finishBoqDesc('FLOOR', spec, { part: 'tiles' }),
          round(q.tiles),
          'm²',
          tilingRate,
        );
      } else {
        roomAmt += pushBoqItem(
          finishBoqDesc(finishKind, spec, {
            part: 'area',
            screedThicknessM: screedThk,
          }),
          round(q.area),
          'm²',
          areaRate,
        );
      }
    });
    if (room) {
      boq.push(
        total(
          `${room} — room total (${round(roomArea)} m²)`,
          round(roomAmt),
        ),
      );
    }
  });
  boq.push(total(`${meta.label} total`, round(boqTot)));
  boqTot = round(boqTot);

  // Summary keys drive Cost Plan / project BOQ for non-finish paths; for
  // screed+tiles floors expose both measured quantities (not blended area).
  const summary: Record<string, number> =
    finishKind === 'FLOOR' && screed > 0 && tiles > 0
      ? { screed, tiles }
      : { area };

  const bom: ReportLine[] = [];
  let bomTot = 0;
  let bi = 0;
  const pushBom = (desc: string, qty: number, unit: string, code: string, dec: number) => {
    bi++;
    const rate = rates.matRate(code);
    bom.push(item(`A${bi}`, desc, qty, unit, rate, { dec }));
    const a = lineAmount(qty, rate);
    if (a != null) bomTot += a;
  };
  bom.push(group('A — Materials'));
  const screedMix =
    (materials as { screedMix?: { cementKgPerM3: number; sandM3PerM3: number } })
      .screedMix || DEFAULT_SCREED_MIX;
  const plasterMix =
    (materials as { plasterMix?: { cementKgPerM3: number; sandM3PerM3: number } })
      .plasterMix || DEFAULT_PLASTER_MIX;
  if (screed > 0) {
    pushBom(
      `Cement for screed (${CEMENT_BAG_KG}kg bags)`,
      (screed * screedMix.cementKgPerM3) / CEMENT_BAG_KG,
      'bags',
      'cementBag',
      1,
    );
    pushBom('Sand for screed', screed * screedMix.sandM3PerM3, 'm³', 'sand', 2);
  }
  if (plaster > 0) {
    pushBom(
      `Cement for plaster (${CEMENT_BAG_KG}kg bags)`,
      (plaster * plasterMix.cementKgPerM3) / CEMENT_BAG_KG,
      'bags',
      'cementBag',
      1,
    );
    pushBom('Sand for plaster', plaster * plasterMix.sandM3PerM3, 'm³', 'sand', 2);
  }
  if (paintL > 0) pushBom('Emulsion paint', paintL, 'L', 'paint', 1);
  if (tiles > 0) {
    pushBom('Tiles (incl. wastage)', tiles, 'm²', 'tiles', 2);
    pushBom('Tile adhesive', tiles * 4, 'kg', 'tileAdhesive', 0);
  }
  bom.push(total('Materials total', bomTot));

  const outRate = finishKind === 'FLOOR' ? 20 : finishKind === 'WALL' ? 15 : 12;
  const trade = finishKind === 'FLOOR' ? 'Tiler/Screeder' : 'Plasterer';
  const days = Math.ceil(area / outRate) || 0;
  const manDays: Record<string, number> = {};
  if (days > 0) {
    manDays[trade] = days;
    manDays.Labourer = days;
  }
  const activities: LabourActivity[] =
    area > 0
      ? [
          {
            ref: 'L1',
            activity: `Apply ${meta.label.toLowerCase()}`,
            qty: area,
            unit: 'm²',
            outputRate: `${outRate} m²/day`,
            gang: `1 ${trade} + 1 Labourer`,
            days,
          },
        ]
      : [];
  const labour = labourBundle(activities, manDays, rates.labRate);

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'finish',
    units,
    boq,
    bom,
    labour,
    summary,
    cost: { boq: boqTot, bom: bomTot, labour: labour.totalCost },
  };
}

export function buildEarthworkReports(
  entries: ReportEntry[],
  materials: MaterialsConfig,
  rates: RateAccessors,
): ElementReportBundle {
  const meta = ELEMENT_META.EARTHWORKS;
  let excavation = 0;
  let disposal = 0;
  let units = 0;
  entries.forEach(({ flat, inst }) => {
    const calc = calcEarthwork(flat as any, materials);
    excavation += calc.totalExcavationM3;
    disposal += calc.totalDisposalM3;
    units += inst.count || 1;
  });
  excavation = round(excavation);
  disposal = round(disposal);

  const excavationRate = rates.boqRate('excavation');
  const disposalRate = rates.boqRate('disposal');
  const excavationAmount = lineAmount(excavation, excavationRate) || 0;
  const disposalAmount = lineAmount(disposal, disposalRate) || 0;

  let boq: ReportLine[];
  let boqTot = excavationAmount + disposalAmount;
  const catalogueBoq =
    isBoqCatalogueEnabled()
      ? buildCatalogueCoreBoq({
          elementKey: meta.key,
          agg: {
            concreteByGrade: {},
            totalFormwork: 0,
            steelByDia: {},
            totalConcrete: 0,
            totalSteel: 0,
          },
          rates,
          floorLevelTypes: floorLevelTypesFromEntries(entries),
          extras: { excavationM3: excavation, disposalM3: disposal },
        })
      : null;
  if (catalogueBoq) {
    boq = catalogueBoq.lines;
    boqTot = catalogueBoq.boqTot;
  } else {
    boq = [
      group('A — Excavation'),
      item(
        'A1',
        'Excavate material to required formation; measured in situ',
        excavation,
        'm³',
        excavationRate,
      ),
      group('B — Disposal'),
      item(
        'B1',
        'Load, haul and dispose excavated material; bulked volume',
        disposal,
        'm³',
        disposalRate,
      ),
      total('Earthworks total', boqTot),
    ];
  }

  const days = Math.ceil(excavation / 25) || 0;
  const labour =
    days > 0
      ? labourBundle(
          [
            {
              ref: 'L1',
              activity: 'Excavate, load and trim formation',
              qty: excavation,
              unit: 'm³',
              outputRate: '25 m³/day',
              gang: '1 Plant Operator + 2 Labourer',
              days,
            },
          ],
          { 'Plant Operator': days, Labourer: days * 2 },
          rates.labRate,
        )
      : labourBundle([], {}, rates.labRate);

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'earthworks',
    units,
    boq,
    bom: [],
    labour,
    summary: { excavation, disposal },
    cost: {
      boq: boqTot,
      bom: 0,
      labour: labour.totalCost,
    },
  };
}

export function buildSkirtingReports(
  entries: ReportEntry[],
  rates: RateAccessors,
): ElementReportBundle {
  const meta = ELEMENT_META.SKIRTING;
  let length = 0;
  let units = 0;
  const byRoomSpec: Record<string, Record<string, number>> = {};

  entries.forEach(({ flat, inst }) => {
    const c = calcSkirting(flat as any);
    length += c.totalLengthM;
    units += inst.count || 1;
    const spec = String(inst.spec || flat.spec || 'Skirting');
    const roomRaw =
      flat.roomLabel ??
      (inst as { geometry?: { roomLabel?: unknown } }).geometry?.roomLabel;
    const room =
      typeof roomRaw === 'string' && roomRaw.trim() ? roomRaw.trim() : '';
    if (!byRoomSpec[room]) byRoomSpec[room] = {};
    byRoomSpec[room][spec] = (byRoomSpec[room][spec] || 0) + c.totalLengthM;
  });
  length = round(length);
  const rate = rates.boqRate('skirting');
  const boq: ReportLine[] = [];
  let boqTot = 0;
  boq.push(group(`A — ${meta.label}`));
  let i = 0;
  const roomKeys = Object.keys(byRoomSpec).sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
  roomKeys.forEach((room) => {
    if (room) boq.push(group(`Room — ${room}`));
    Object.entries(byRoomSpec[room]).forEach(([spec, qty]) => {
      if (!(qty > 0)) return;
      i++;
      boq.push(
        item(
          `A${i}`,
          `${spec} skirting / baseboard; fixed`,
          round(qty),
          'm',
          rate,
        ),
      );
      const a = lineAmount(qty, rate);
      if (a != null) boqTot += a;
    });
  });
  boq.push(total('Element total (excl. prelims & OH&P)', round(boqTot)));

  const days = Math.ceil(length / 40) || (length > 0 ? 1 : 0);
  const labour =
    length > 0
      ? labourBundle(
          [
            {
              ref: 'L1',
              activity: 'Fix skirting',
              qty: length,
              unit: 'm',
              outputRate: '40 m/day',
              gang: '1 Carpenter + 1 Labourer',
              days,
            },
          ],
          { Carpenter: days, Labourer: days },
          rates.labRate,
        )
      : labourBundle([], {}, rates.labRate);

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'finish',
    units,
    boq,
    bom: [],
    labour,
    summary: { length },
    cost: { boq: boqTot, bom: 0, labour: labour.totalCost },
  };
}

export function buildMasonryWallReports(
  entries: ReportEntry[],
  materials: MaterialsConfig & { stoneMortarRatio?: string },
  rates: RateAccessors,
): ElementReportBundle {
  const meta = ELEMENT_META.MASONRY;
  let area = 0;
  let mas = 0;
  let mortar = 0;
  let units = 0;
  entries.forEach(({ flat, inst }) => {
    const c = calcMasonry(flat as any, materials);
    area += c.totalAreaM2;
    mas += c.totalMasonryM3;
    mortar += c.totalMortarM3;
    units += inst.count || 1;
  });
  area = round(area);
  mas = round(mas);
  mortar = round(mortar);

  const mortarMix =
    (materials as { mortarMix?: { cementBagsPerM3: number; sandM3PerM3: number } })
      .mortarMix || { cementBagsPerM3: 7.2, sandM3PerM3: 1.0 };
  const cementBags = mortar * mortarMix.cementBagsPerM3;
  const sand = mortar * mortarMix.sandM3PerM3;
  const ratio = materials.stoneMortarRatio || '1:4';

  const boq: ReportLine[] = [];
  let boqTot = 0;
  boq.push(group('A — Masonry / infill'));
  {
    const rate = rates.boqRate('masonryWall');
    boq.push(
      item(
        'A1',
        `Block / brick masonry in cement mortar (${ratio}); measured as net face area`,
        area,
        'm²',
        rate,
      ),
    );
    const a = lineAmount(area, rate);
    if (a != null) boqTot += a;
  }
  boq.push(total('Masonry total', boqTot));

  const bom: ReportLine[] = [];
  let bomTot = 0;
  const pushBom = (
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
  bom.push(group('A — Units & mortar'));
  pushBom('A1', 'Masonry units (block/brick equivalent volume)', mas, 'm³', 'stone', 2);
  pushBom(
    'A2',
    `Cement for mortar (${CEMENT_BAG_KG}kg bags)`,
    cementBags,
    'bags',
    'cementBag',
    1,
  );
  pushBom('A3', 'Sand for mortar', sand, 'm³', 'sand', 2);
  bom.push(total('Materials total', bomTot));

  const masDays = Math.ceil(mas / 1.5) || (mas > 0 ? 1 : 0);
  const labour =
    mas > 0
      ? labourBundle(
          [
            {
              ref: 'L1',
              activity: 'Lay block / brick masonry',
              qty: mas,
              unit: 'm³',
              outputRate: '1.5 m³/day',
              gang: '1 Mason + 2 Labourer',
              days: masDays,
            },
          ],
          { Mason: masDays, Labourer: masDays * 2 },
          rates.labRate,
        )
      : labourBundle([], {}, rates.labRate);

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'masonry',
    units,
    boq,
    bom,
    labour,
    summary: { area },
    cost: { boq: boqTot, bom: bomTot, labour: labour.totalCost },
  };
}

export function buildDoorsWindowsReports(
  entries: ReportEntry[],
  rates: RateAccessors,
): ElementReportBundle {
  const meta = ELEMENT_META.DOORS_WINDOWS;
  let nos = 0;
  let area = 0;
  let peri = 0;
  let units = 0;
  const byType: Record<string, { nos: number; area: number }> = {};

  entries.forEach(({ flat, inst }) => {
    const c = calcDoorsWindows(flat as any);
    nos += c.totalNos;
    area += c.totalOpeningAreaM2;
    peri += c.totalPerimeterM;
    units += inst.count || 1;
    const typ = String(
      flat.openingType || inst.spec || flat.spec || 'Opening',
    );
    const prev = byType[typ] || { nos: 0, area: 0 };
    byType[typ] = {
      nos: prev.nos + c.totalNos,
      area: prev.area + c.totalOpeningAreaM2,
    };
  });
  nos = round(nos, 0);
  area = round(area);
  peri = round(peri);

  const rate = rates.boqRate('doorsWindows');
  const boq: ReportLine[] = [];
  let boqTot = 0;
  boq.push(group(`A — ${meta.label}`));
  let i = 0;
  Object.keys(byType)
    .sort()
    .forEach((typ) => {
      const q = byType[typ];
      if (!(q.nos > 0)) return;
      i++;
      const w = entries.find(
        (e) => String(e.flat.openingType || e.inst.spec) === typ,
      );
      const width = Number(w?.flat.width) || 0;
      const height = Number(w?.flat.height) || 0;
      const size =
        width > 0 && height > 0
          ? ` ${width.toFixed(2)}×${height.toFixed(2)}m`
          : '';
      boq.push(
        item(
          `A${i}`,
          `${typ}${size}; supply and fix`,
          q.nos,
          'nos',
          rate,
          { dec: 0 },
        ),
      );
      const a = lineAmount(q.nos, rate);
      if (a != null) boqTot += a;
    });
  if (area > 0) {
    i++;
    boq.push(
      item(
        `A${i}`,
        'Opening area (informational)',
        area,
        'm²',
        null,
      ),
    );
  }
  boq.push(total('Element total (excl. prelims & OH&P)', round(boqTot)));

  const days = Math.ceil(nos / 8) || (nos > 0 ? 1 : 0);
  const labour =
    nos > 0
      ? labourBundle(
          [
            {
              ref: 'L1',
              activity: 'Install doors / windows',
              qty: nos,
              unit: 'nos',
              outputRate: '8 nos/day',
              gang: '1 Carpenter + 1 Labourer',
              days,
            },
          ],
          { Carpenter: days, Labourer: days },
          rates.labRate,
        )
      : labourBundle([], {}, rates.labRate);

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'finish',
    units,
    boq,
    bom: [],
    labour,
    summary: { nos, area, perimeter: peri },
    cost: { boq: boqTot, bom: 0, labour: labour.totalCost },
  };
}

/** Lintels use structural BOQ via buildStructuralReports + calcLintel. */
export function lintelCalculator(
  _elementKey: string,
  flat: Record<string, unknown>,
): StructuralCalcResult {
  return calcLintel(flat as unknown as LintelInput);
}

export function buildDuctReports(
  entries: ReportEntry[],
  rates: RateAccessors,
): ElementReportBundle {
  const meta = ELEMENT_META.DUCTS;
  let length = 0;
  let surface = 0;
  let weight = 0;
  let joints = 0;
  let units = 0;
  const bySystem: Record<string, number> = {};

  entries.forEach(({ flat, inst }) => {
    const c = calcDuct(flat as any);
    length += c.totalLengthM;
    surface += c.totalSurfaceM2;
    weight += c.totalWeightKg;
    joints += c.totalJoints;
    units += inst.count || 1;
    const sys = String(flat.system || inst.spec || 'Duct');
    bySystem[sys] = (bySystem[sys] || 0) + c.totalLengthM;
  });
  length = round(length);
  surface = round(surface);
  weight = round(weight);

  const rate = rates.boqRate('ducts');
  const boq: ReportLine[] = [];
  let boqTot = 0;
  boq.push(group(`A — ${meta.label}`));
  let i = 0;
  Object.keys(bySystem)
    .sort()
    .forEach((sys) => {
      const qty = bySystem[sys];
      if (!(qty > 0)) return;
      i++;
      boq.push(
        item(
          `A${i}`,
          `Galvanised sheet ductwork, ${sys}; measured on centreline`,
          round(qty),
          'm',
          rate,
        ),
      );
      const a = lineAmount(qty, rate);
      if (a != null) boqTot += a;
    });
  if (surface > 0) {
    i++;
    boq.push(item(`A${i}`, 'Duct surface area (informational)', surface, 'm²', null));
  }
  boq.push(total('Element total (excl. prelims & OH&P)', round(boqTot)));

  const days = Math.ceil(length / 15) || (length > 0 ? 1 : 0);
  const labour =
    length > 0
      ? labourBundle(
          [
            {
              ref: 'L1',
              activity: 'Install ductwork',
              qty: length,
              unit: 'm',
              outputRate: '15 m/day',
              gang: '2 Sheet-metal + 1 Labourer',
              days,
            },
          ],
          { Carpenter: days * 2, Labourer: days },
          rates.labRate,
        )
      : labourBundle([], {}, rates.labRate);

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'mep',
    units,
    boq,
    bom: [],
    labour,
    summary: { length, surface, weight, joints },
    cost: { boq: boqTot, bom: 0, labour: labour.totalCost },
  };
}

export function buildPipeReports(
  entries: ReportEntry[],
  rates: RateAccessors,
): ElementReportBundle {
  const meta = ELEMENT_META.PIPES;
  let length = 0;
  let insulation = 0;
  let fittings = 0;
  let units = 0;
  const byMat: Record<string, number> = {};

  entries.forEach(({ flat, inst }) => {
    const c = calcPipe(flat as any);
    length += c.totalLengthM;
    insulation += c.totalInsulationM;
    fittings += c.totalFittingsNos;
    units += inst.count || 1;
    const mat = String(flat.material || flat.system || inst.spec || 'Pipe');
    byMat[mat] = (byMat[mat] || 0) + c.totalLengthM;
  });
  length = round(length);
  insulation = round(insulation);

  const rate = rates.boqRate('pipes');
  const insRate = rates.boqRate('pipeInsulation');
  const boq: ReportLine[] = [];
  let boqTot = 0;
  boq.push(group(`A — ${meta.label}`));
  let i = 0;
  Object.keys(byMat)
    .sort()
    .forEach((mat) => {
      const qty = byMat[mat];
      if (!(qty > 0)) return;
      i++;
      boq.push(
        item(
          `A${i}`,
          `${mat} pipework; measured on centreline`,
          round(qty),
          'm',
          rate,
        ),
      );
      const a = lineAmount(qty, rate);
      if (a != null) boqTot += a;
    });
  if (insulation > 0) {
    i++;
    boq.push(
      item(
        `A${i}`,
        'Pipe insulation; measured along pipe centreline',
        insulation,
        'm',
        insRate,
      ),
    );
    const a = lineAmount(insulation, insRate);
    if (a != null) boqTot += a;
  }
  if (fittings > 0) {
    i++;
    boq.push(
      item(
        `A${i}`,
        'Pipe fittings (enumerated)',
        fittings,
        'nos',
        rates.boqRate('ductFittings'),
        { dec: 0 },
      ),
    );
    const a = lineAmount(fittings, rates.boqRate('ductFittings'));
    if (a != null) boqTot += a;
  }
  boq.push(total('Element total (excl. prelims & OH&P)', round(boqTot)));

  const days = Math.ceil(length / 20) || (length > 0 ? 1 : 0);
  const labour =
    length > 0
      ? labourBundle(
          [
            {
              ref: 'L1',
              activity: 'Install pipework',
              qty: length,
              unit: 'm',
              outputRate: '20 m/day',
              gang: '1 Plumber + 1 Labourer',
              days,
            },
          ],
          { Carpenter: days, Labourer: days },
          rates.labRate,
        )
      : labourBundle([], {}, rates.labRate);

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'mep',
    units,
    boq,
    bom: [],
    labour,
    summary: { length, insulation, fittings },
    cost: { boq: boqTot, bom: 0, labour: labour.totalCost },
  };
}

export function buildElectricalReports(
  entries: ReportEntry[],
  rates: RateAccessors,
): ElementReportBundle {
  const meta = ELEMENT_META.ELECTRICAL;
  let length = 0;
  let cable = 0;
  let units = 0;
  const byShape: Record<string, number> = {};

  entries.forEach(({ flat, inst }) => {
    const c = calcElectrical(flat as any);
    length += c.totalLengthM;
    cable += c.totalCableM;
    units += inst.count || 1;
    const shape = String(flat.shape || 'CONDUIT');
    byShape[shape] = (byShape[shape] || 0) + c.totalLengthM;
  });
  length = round(length);
  cable = round(cable);

  const rate = rates.boqRate('electrical');
  const boq: ReportLine[] = [];
  let boqTot = 0;
  boq.push(group(`A — ${meta.label}`));
  let i = 0;
  Object.keys(byShape)
    .sort()
    .forEach((shape) => {
      const qty = byShape[shape];
      if (!(qty > 0)) return;
      i++;
      const label =
        shape === 'TRAY'
          ? 'Cable tray'
          : shape === 'CABLE'
            ? 'Cable'
            : 'Conduit';
      boq.push(
        item(
          `A${i}`,
          `${label}; measured on centreline`,
          round(qty),
          'm',
          rate,
        ),
      );
      const a = lineAmount(qty, rate);
      if (a != null) boqTot += a;
    });
  if (cable > 0 && !byShape.CABLE) {
    i++;
    boq.push(
      item(`A${i}`, 'Cable in tray (secondary)', cable, 'm', rate),
    );
    const a = lineAmount(cable, rate);
    if (a != null) boqTot += a;
  }
  boq.push(total('Element total (excl. prelims & OH&P)', round(boqTot)));

  const days = Math.ceil(length / 30) || (length > 0 ? 1 : 0);
  const labour =
    length > 0
      ? labourBundle(
          [
            {
              ref: 'L1',
              activity: 'Install conduits / trays / cables',
              qty: length,
              unit: 'm',
              outputRate: '30 m/day',
              gang: '1 Electrician + 1 Labourer',
              days,
            },
          ],
          { Carpenter: days, Labourer: days },
          rates.labRate,
        )
      : labourBundle([], {}, rates.labRate);

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'mep',
    units,
    boq,
    bom: [],
    labour,
    summary: { length, cable },
    cost: { boq: boqTot, bom: 0, labour: labour.totalCost },
  };
}

export function buildDuctFittingReports(
  entries: ReportEntry[],
  rates: RateAccessors,
): ElementReportBundle {
  const meta = ELEMENT_META.DUCT_FITTINGS;
  let nos = 0;
  let eqLen = 0;
  let units = 0;
  const byType: Record<string, number> = {};

  entries.forEach(({ flat, inst }) => {
    const c = calcDuctFitting(flat as any);
    nos += c.totalNos;
    eqLen += c.totalEquivalentLengthM;
    units += inst.count || 1;
    const typ = String(flat.fittingType || inst.spec || 'Other');
    byType[typ] = (byType[typ] || 0) + c.totalNos;
  });
  nos = round(nos, 0);
  eqLen = round(eqLen);

  const rate = rates.boqRate('ductFittings');
  const boq: ReportLine[] = [];
  let boqTot = 0;
  boq.push(group(`A — ${meta.label}`));
  let i = 0;
  Object.keys(byType)
    .sort()
    .forEach((typ) => {
      const qty = byType[typ];
      if (!(qty > 0)) return;
      i++;
      boq.push(
        item(
          `A${i}`,
          `Duct fitting / HVAC — ${typ}; supply and fix`,
          qty,
          'nos',
          rate,
          { dec: 0 },
        ),
      );
      const a = lineAmount(qty, rate);
      if (a != null) boqTot += a;
    });
  if (eqLen > 0) {
    i++;
    boq.push(
      item(
        `A${i}`,
        'Equivalent duct length (informational)',
        eqLen,
        'm',
        null,
      ),
    );
  }
  boq.push(total('Element total (excl. prelims & OH&P)', round(boqTot)));

  const days = Math.ceil(nos / 12) || (nos > 0 ? 1 : 0);
  const labour =
    nos > 0
      ? labourBundle(
          [
            {
              ref: 'L1',
              activity: 'Install duct fittings / HVAC',
              qty: nos,
              unit: 'nos',
              outputRate: '12 nos/day',
              gang: '2 Sheet-metal + 1 Labourer',
              days,
            },
          ],
          { Carpenter: days * 2, Labourer: days },
          rates.labRate,
        )
      : labourBundle([], {}, rates.labRate);

  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: 'mep',
    units,
    boq,
    bom: [],
    labour,
    summary: { nos, equivalentLength: eqLen },
    cost: { boq: boqTot, bom: 0, labour: labour.totalCost },
  };
}

export type FloorLevelTypesById = Record<string, FloorLevelType[]>;

export function buildFloorLevelTypesById(
  floors?: Array<{ floorId: string; label?: string; levelTypes?: unknown }>,
): FloorLevelTypesById {
  const map: FloorLevelTypesById = {};
  for (const f of floors || []) {
    if (!f?.floorId) continue;
    map[f.floorId] = resolveFloorLevelTypes({
      floorId: f.floorId,
      label: f.label,
      levelTypes: f.levelTypes,
    });
  }
  return map;
}

export function makeEntries(
  instances: IInstance[],
  floorLevelTypesById?: FloorLevelTypesById,
): ReportEntry[] {
  return instances.map((inst) => ({
    elementKey: inst.elementKey,
    floorId: inst.floorId,
    inst,
    flat: flattenInstance(inst),
    floorLevelTypes: floorLevelTypesById?.[inst.floorId],
  }));
}

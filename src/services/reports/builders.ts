import { round } from '../../engines/math';
import {
  calcEarthwork,
  calcFinish,
  calcStone,
  type FinishKind,
  type MaterialsConfig,
  type StructuralCalcResult,
} from '../../engines';
import type { IInstance } from '../../models/Instance';
import { flattenInstance } from '../flattenInstance';
import { ELEMENT_META, type ElementMeta } from './elementMeta';
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

export type ReportEntry = {
  elementKey: string;
  floorId: string;
  inst: IInstance;
  flat: Record<string, unknown>;
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

export function buildStructuralReports(
  meta: ElementMeta,
  entries: ReportEntry[],
  rates: RateAccessors,
  calculate: StructuralCalculator,
  materials?: MaterialsConfig | null,
): ElementReportBundle {
  const agg = aggregateStructural(entries, calculate);
  const boq: ReportLine[] = [];
  let boqTot = 0;

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

  const boq: ReportLine[] = [];
  let boqTot = 0;
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
    boq.push(item('B1', 'Lean concrete blinding, grade C15/20, under stone footing', blinding, 'm³', rate));
    const a = lineAmount(blinding, rate);
    if (a != null) boqTot += a;
  }
  boq.push(total('Stone foundation total', boqTot));

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
  /** roomLabel (trimmed) → spec → area m². Empty key = ungrouped. */
  const byRoomSpec: Record<string, Record<string, number>> = {};

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
    byRoomSpec[room][spec] = (byRoomSpec[room][spec] || 0) + c.totalAreaM2;
  });
  area = round(area);
  screed = round(screed);
  plaster = round(plaster);
  paintL = round(paintL, 1);
  tiles = round(tiles);

  const areaRateCode =
    finishKind === 'FLOOR' ? 'floorFinish' : finishKind === 'WALL' ? 'wallFinish' : 'ceilingFinish';
  const areaRate = rates.boqRate(areaRateCode);

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
    const specs = byRoomSpec[room];
    let roomAmt = 0;
    let roomArea = 0;
    if (room) {
      boq.push(group(`Room — ${room}`));
    }
    Object.keys(specs).forEach((spec) => {
      i++;
      const q = round(specs[spec]);
      roomArea += q;
      const desc = room
        ? `${meta.label} — ${room} — ${spec}`
        : `${meta.label} — ${spec}`;
      boq.push(item(`A${i}`, desc, q, 'm²', areaRate));
      const a = lineAmount(q, areaRate);
      if (a != null) {
        boqTot += a;
        roomAmt += a;
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
  boq.push(total(`${meta.label} total`, boqTot));

  const plMix = mixFor('C20/25', materials as any);
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
  if (screed > 0) {
    pushBom(`Cement for screed (${CEMENT_BAG_KG}kg bags)`, (screed * plMix.cement) / CEMENT_BAG_KG, 'bags', 'cementBag', 1);
    pushBom('Sand for screed', screed * plMix.sand, 'm³', 'sand', 2);
  }
  if (plaster > 0) {
    pushBom(`Cement for plaster (${CEMENT_BAG_KG}kg bags)`, (plaster * plMix.cement) / CEMENT_BAG_KG, 'bags', 'cementBag', 1);
    pushBom('Sand for plaster', plaster * plMix.sand, 'm³', 'sand', 2);
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
    summary: { area },
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
  const boq: ReportLine[] = [
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
    total('Earthworks total', excavationAmount + disposalAmount),
  ];

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
      boq: excavationAmount + disposalAmount,
      bom: 0,
      labour: labour.totalCost,
    },
  };
}

export function makeEntries(instances: IInstance[]): ReportEntry[] {
  return instances.map((inst) => ({
    elementKey: inst.elementKey,
    floorId: inst.floorId,
    inst,
    flat: flattenInstance(inst),
  }));
}

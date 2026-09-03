/**
 * Build Cost Plan from priced modelled instances + manual BOQ.
 * Primary sections = element type (Pad Foundation, Columns, …);
 * nested subheaders = work categories that element actually produces
 * (Concrete/Formwork/Reinforcement, Masonry/Blinding, Screed/Tiling, …).
 * UniFormat codes remain on lines as secondary metadata (optional tag on headings).
 * When project.gfaM2 is set, Rate/m² = amount ÷ gfaM2 on items and subtotals.
 */
import type { IInstance } from '../../models/Instance';
import type { IProject } from '../../models/Project';
import { DEFAULT_PRICING } from '../../defaults/projectDefaults';
import { ELEMENT_ENGINES } from '../../elementEngines';
import { round } from '../../engines/math';
import { ELEMENT_META } from '../reports/elementMeta';
import { makeEntries, buildFloorLevelTypesById, type FloorLevelTypesById } from '../reports/builders';
import { makeRateAccessors, lineAmount } from '../reports/pricing';
import { materialsForBom } from '../materialsMix';
import type { ManualBoqReportItem } from '../manualBoqPricing';
import type { ElementReportBundle, ReportLine } from '../reports/types';
import {
  computeCostPlanCascade,
  resolveCascadePercents,
  type CostPlanCascade,
} from './cascade';
import {
  UNIFORMAT_CODES,
  formatUniformatHeading,
  resolveUniformatCode,
} from './uniformat';

export type CostPlanWorkCategory =
  | 'Concrete'
  | 'Formwork'
  | 'Reinforcement'
  | 'Masonry'
  | 'Mortar'
  | 'Blinding'
  | 'Screed'
  | 'Tiling'
  | 'Plaster'
  | 'Paint'
  | 'Finishes'
  | 'MEP'
  | 'Excavation'
  | 'Disposal'
  | 'Other';

export type CostPlanLine = ReportLine & {
  uniformatCode?: string;
  elementKey?: string;
  /** amount ÷ gfaM2; omitted when GFA is not set. */
  ratePerM2?: number;
  /** Category subheader / item tag within an element section. */
  workCategory?: CostPlanWorkCategory;
  /**
   * Excel outline / accordion depth:
   * 0 = element section, 1 = category subheader, 2 = line item.
   */
  outlineLevel?: 0 | 1 | 2;
};

/** Full display order (used when element kind is unknown / Manual). */
export const WORK_CATEGORY_ORDER: CostPlanWorkCategory[] = [
  'Concrete',
  'Formwork',
  'Reinforcement',
  'Masonry',
  'Mortar',
  'Blinding',
  'Screed',
  'Tiling',
  'Plaster',
  'Paint',
  'Finishes',
  'MEP',
  'Excavation',
  'Disposal',
  'Other',
];

const STRUCTURAL_CATEGORY_ORDER: CostPlanWorkCategory[] = [
  'Concrete',
  'Formwork',
  'Reinforcement',
  'Other',
];
const MASONRY_CATEGORY_ORDER: CostPlanWorkCategory[] = [
  'Masonry',
  'Mortar',
  'Blinding',
  'Other',
];
const FINISH_CATEGORY_ORDER: CostPlanWorkCategory[] = [
  'Screed',
  'Tiling',
  'Plaster',
  'Paint',
  'Finishes',
  'Other',
];
const EARTHWORKS_CATEGORY_ORDER: CostPlanWorkCategory[] = [
  'Excavation',
  'Disposal',
  'Other',
];
const MEP_CATEGORY_ORDER: CostPlanWorkCategory[] = ['MEP', 'Other'];

export function categoryOrderForElement(
  elementKey?: string | null,
): CostPlanWorkCategory[] {
  const kind = elementKey ? ELEMENT_META[elementKey]?.kind : undefined;
  switch (kind) {
    case 'structural':
      return STRUCTURAL_CATEGORY_ORDER;
    case 'masonry':
      return MASONRY_CATEGORY_ORDER;
    case 'finish':
      return FINISH_CATEGORY_ORDER;
    case 'earthworks':
      return EARTHWORKS_CATEGORY_ORDER;
    case 'mep':
      return MEP_CATEGORY_ORDER;
    default:
      return WORK_CATEGORY_ORDER;
  }
}

export function classifyWorkCategory(
  line: Pick<ReportLine, 'description' | 'unit' | 'isRebar' | 'workCategory'> & {
    elementKey?: string;
    source?: string;
    summaryKey?: string;
  },
): CostPlanWorkCategory {
  const fromCatalogue = mapCatalogueWorkCategory(line);
  if (fromCatalogue) return fromCatalogue;

  if (line.isRebar) return 'Reinforcement';

  const key = (line.summaryKey || '').toLowerCase();
  if (key === 'masonry') return 'Masonry';
  if (key === 'mortar') return 'Mortar';
  if (key === 'blinding') return 'Blinding';
  if (key === 'concrete') return 'Concrete';
  if (key === 'formwork') return 'Formwork';
  if (key === 'steel' || key === 'reinforcement') return 'Reinforcement';
  if (key === 'screed') return 'Screed';
  if (key === 'tiles' || key === 'tiling') return 'Tiling';
  if (key === 'plaster') return 'Plaster';
  if (key === 'paint') return 'Paint';
  if (key === 'excavation') return 'Excavation';
  if (key === 'disposal') return 'Disposal';
  if (key === 'area') return 'Finishes';
  if (key === 'mep') return 'MEP';

  const el = (line.elementKey || '').toUpperCase();
  const d = (line.description || '').toLowerCase();

  if (
    /\brebar\b|\breinforcement\b|\bhigh-yield\b|\breinforcing\b|\bsteel bar/.test(
      d,
    )
  ) {
    return 'Reinforcement';
  }
  if (/\bformwork\b|\bfalsework\b|\bsoffit\b/.test(d)) return 'Formwork';
  if (/\bblinding\b/.test(d)) return 'Blinding';
  if (/\bmortar\b/.test(d)) return 'Mortar';
  if (
    /\bmasonry\b|\bblock work\b|\bblockwork\b|\bstone\b|\bbrick\b/.test(d)
  ) {
    return 'Masonry';
  }
  if (/\bscreed\b/.test(d)) return 'Screed';
  if (/\btile\b|\btiling\b/.test(d)) return 'Tiling';
  if (/\bplaster\b/.test(d)) return 'Plaster';
  if (/\bpaint\b|\bemulsion\b/.test(d)) return 'Paint';
  if (/\bexcavation\b|\bexcavate\b/.test(d)) return 'Excavation';
  if (/\bdisposal\b|\bspoil\b/.test(d)) return 'Disposal';
  if (/\bconcrete\b|\bin-situ\b|\binsitu\b/.test(d)) return 'Concrete';

  if (
    el === 'FLOOR_FINISH' ||
    el === 'WALL_FINISH' ||
    el === 'CEILING_FINISH' ||
    el === 'SKIRTING' ||
    el === 'DOORS_WINDOWS'
  ) {
    return 'Finishes';
  }
  if (el === 'MASONRY' || el === 'STONE_STRIP') return 'Masonry';
  if (
    el === 'DUCTS' ||
    el === 'DUCT_FITTINGS' ||
    el === 'PIPES' ||
    el === 'ELECTRICAL'
  ) {
    return 'MEP';
  }
  if (el === 'EARTHWORKS') return 'Other';
  if (el === 'LINTELS') {
    if (line.unit === 'm' || line.unit === 'lm') return 'Concrete';
  }
  if (line.unit === 'm³' || line.unit === 'm3') return 'Concrete';
  if (
    (line.unit === 'm²' ||
      line.unit === 'm2' ||
      line.unit === 'lm') &&
    (el === 'PAD_FOOTING' ||
      el === 'STRIP_FOOTING' ||
      el === 'RAFT' ||
      el === 'PILE_CAP' ||
      el === 'COLUMNS' ||
      el === 'BEAMS' ||
      el === 'WALLS' ||
      el === 'SLABS' ||
      el === 'STAIRS' ||
      el === 'RAMPS')
  ) {
    return 'Formwork';
  }

  return 'Other';
}

const KNOWN_COST_PLAN_CATEGORIES = new Set<string>(WORK_CATEGORY_ORDER);

/** Map client catalogue workCategory → cost-plan bucket when unambiguous. */
function mapCatalogueWorkCategory(
  line: Pick<ReportLine, 'description' | 'unit' | 'isRebar' | 'workCategory'>,
): CostPlanWorkCategory | null {
  const raw = (line.workCategory || '').trim();
  if (!raw) return null;

  if (raw === 'Earthworks') {
    const d = (line.description || '').toLowerCase();
    if (/\bexcavat/.test(d)) return 'Excavation';
    if (/\bdispos|\bcart away|\bspoil|\bhaul/.test(d)) return 'Disposal';
    return 'Other';
  }

  if (
    raw === 'Floor Finishes' ||
    raw === 'Wall Finishes' ||
    raw === 'Ceiling Finishes' ||
    raw === 'Doors & Windows'
  ) {
    return 'Finishes';
  }

  // Excel sometimes tags concrete under Reinforcement — defer to heuristics.
  if (raw === 'Reinforcement' && !line.isRebar) {
    const u = (line.unit || '').toLowerCase();
    if (u === 'm³' || u === 'm3' || u === 'm²' || u === 'm2') return null;
  }

  if (KNOWN_COST_PLAN_CATEGORIES.has(raw)) {
    return raw as CostPlanWorkCategory;
  }
  return null;
}

function categoryHeader(category: CostPlanWorkCategory): CostPlanLine {
  return {
    kind: 'group',
    description: category,
    source: 'MODELLED',
    workCategory: category,
    outlineLevel: 1,
  };
}

/**
 * Emit items under category subheaders for one element section.
 * Re-numbers refs as `{prefix}.1`, `{prefix}.2`, … in final display order.
 * Does not drop, duplicate, or alter amounts — only reorders + adds headers.
 */
export function emitCategorisedItems(
  prefix: string,
  items: CostPlanLine[],
  categoryOrder: CostPlanWorkCategory[] = WORK_CATEGORY_ORDER,
): { lines: CostPlanLine[]; flat: CostPlanLine[]; subtotal: number } {
  const buckets: Map<CostPlanWorkCategory, CostPlanLine[]> = new Map();
  for (const cat of categoryOrder) buckets.set(cat, []);
  // Catch any category not in the element-specific order
  for (const cat of WORK_CATEGORY_ORDER) {
    if (!buckets.has(cat)) buckets.set(cat, []);
  }

  for (const item of items) {
    const cat = item.workCategory || classifyWorkCategory(item);
    item.workCategory = cat;
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat)!.push(item);
  }

  const lines: CostPlanLine[] = [];
  const flat: CostPlanLine[] = [];
  let subtotal = 0;
  let n = 0;

  const order = [
    ...categoryOrder,
    ...WORK_CATEGORY_ORDER.filter((c) => !categoryOrder.includes(c)),
  ];

  for (const cat of order) {
    const rows = buckets.get(cat);
    if (!rows?.length) continue;
    const header = categoryHeader(cat);
    lines.push(header);
    flat.push(header);
    for (const row of rows) {
      n++;
      const numbered: CostPlanLine = {
        ...row,
        ref: row.source === 'MANUAL' ? `${prefix}.M${n}` : `${prefix}.${n}`,
        workCategory: cat,
        outlineLevel: 2,
      };
      lines.push(numbered);
      flat.push(numbered);
      if (numbered.amount != null) subtotal += numbered.amount;
    }
  }

  return { lines, flat, subtotal };
}

export type CostPlanRegroupIntegrity = {
  beforeItemCount: number;
  afterItemCount: number;
  beforeGrandTotal: number;
  afterGrandTotal: number;
};

let lastRegroupIntegrity: CostPlanRegroupIntegrity | null = null;

/** Last buildCostPlan() before/after item count & amount sum (category regroup check). */
export function getLastCostPlanRegroupIntegrity(): CostPlanRegroupIntegrity | null {
  return lastRegroupIntegrity;
}

export type CostPlanCategorySection = {
  category: CostPlanWorkCategory;
  title: string;
  lines: CostPlanLine[];
  subtotal: number;
};

/** One primary Cost Plan section = one element type (or Manual BOQ). */
export type CostPlanGroupSection = {
  id: string;
  title: string;
  heading: string;
  elementKey: string | null;
  /** Distinct UniFormat codes present in this section (secondary reference). */
  uniformatCodes: string[];
  categories: CostPlanCategorySection[];
  subtotal: number;
};

export type CostPlanPayload = {
  currency: string;
  scope: 'floor' | 'project';
  floorId: string | null;
  /** Gross Floor Area (m²). Null → omit Rate/m² column. */
  gfaM2: number | null;
  groups: CostPlanGroupSection[];
  /** Flat lines in element order (headers + items + subtotals) for table / Excel. */
  lines: CostPlanLine[];
  grandTotal: number;
  unclassifiedCount: number;
  /** Design Allowance / OH&P / Inflation cascade summary (bottom of report). */
  cascade: CostPlanCascade;
};

function resolvedGfaM2(project: IProject): number | null {
  const raw = project.gfaM2;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function applyRatePerM2(lines: CostPlanLine[], gfaM2: number): void {
  for (const line of lines) {
    if (line.kind !== 'item' && line.kind !== 'total') continue;
    if (line.amount == null || !Number.isFinite(line.amount)) continue;
    line.ratePerM2 = round(line.amount / gfaM2);
  }
}

export type ManualBoqCostPlanItem = ManualBoqReportItem & {
  uniformatCode?: string | null;
};

function groupLine(
  description: string,
  opts?: { elementKey?: string; outlineLevel?: 0 | 1 | 2 },
): CostPlanLine {
  return {
    kind: 'group',
    description,
    source: 'MODELLED',
    elementKey: opts?.elementKey,
    outlineLevel: opts?.outlineLevel ?? 0,
  };
}

function totalLine(
  description: string,
  amount: number,
  source: 'MODELLED' | 'MANUAL' = 'MODELLED',
): CostPlanLine {
  return { kind: 'total', description, amount, source, outlineLevel: 0 };
}

function itemFromReport(
  line: ReportLine,
  uniformatCode: string,
  elementKey: string,
): CostPlanLine {
  const { workCategory: _catalogueWc, ...rest } = line;
  return {
    ...rest,
    uniformatCode,
    elementKey,
    source: line.source || 'MODELLED',
  };
}

function buildBundleForInstances(
  elementKey: string,
  instances: IInstance[],
  project: IProject,
  floorLevelTypesById?: FloorLevelTypesById,
): ElementReportBundle | null {
  const engine = ELEMENT_ENGINES[elementKey];
  if (!engine || !instances.length) return null;
  const rates = makeRateAccessors(
    project.rateLib as any,
    DEFAULT_PRICING,
    project.useRateAnalysis !== false,
  );
  const materials = materialsForBom(project.materials);
  const entries = makeEntries(instances, floorLevelTypesById);
  return engine.buildReports(entries, materials, rates);
}

function codeBucketKey(code: string): string {
  return UNIFORMAT_CODES[code] ? code : 'Z9990';
}

function elementSortKey(elementKey: string): number {
  const meta = ELEMENT_META[elementKey];
  if (!meta) return 9999;
  // 2a Stone Strip after Strip (num 2)
  return meta.num * 10 + (meta.suffix === 'a' ? 1 : 0);
}

function elementHeading(
  label: string,
  uniformatCodes: string[],
): string {
  const codes = [...new Set(uniformatCodes.filter(Boolean))].sort();
  if (!codes.length) return label;
  // Secondary UniFormat tag — confirm with product owner whether to keep or drop
  return `${label} · ${codes.join(', ')}`;
}

function structuralSummaryKey(line: ReportLine): string | undefined {
  if (line.isRebar) return 'steel';
  const d = (line.description || '').toLowerCase();
  if (/\bformwork\b|\bfalsework\b/.test(d)) return 'formwork';
  if (/\bconcrete\b|\bin-situ\b|\binsitu\b/.test(d)) return 'concrete';
  return undefined;
}

function finishSummaryKey(line: ReportLine): string {
  const d = line.description || '';
  // Prefer material suffix from multi-material BOQ lines when present.
  if (/—\s*Screed\b/i.test(d) || /\bScreed$/i.test(d)) return 'screed';
  if (/—\s*Tiles?\b/i.test(d)) return 'tiles';
  if (/—\s*Plaster\b/i.test(d)) return 'plaster';
  if (/—\s*Paint\b/i.test(d)) return 'paint';
  // Screed before tile/tiling — screed templates say "to receive tiling".
  if (/\bscreed\b/i.test(d)) return 'screed';
  if (/\btile/i.test(d) || /\btiling\b/i.test(d)) return 'tiles';
  if (/\bplaster\b/i.test(d)) return 'plaster';
  if (/\bpaint\b|\bemulsion\b/i.test(d)) return 'paint';
  return 'area';
}

function masonrySummaryKey(line: ReportLine): string {
  const d = (line.description || '').toLowerCase();
  if (/\bblinding\b/.test(d)) return 'blinding';
  if (/\bmortar\b/.test(d)) return 'mortar';
  return 'masonry';
}

function collectFromBundle(
  elementKey: string,
  bundle: ElementReportBundle,
  project: IProject,
  defaultUniformat: string,
): CostPlanLine[] {
  const collected: CostPlanLine[] = [];

  if (bundle.kind === 'structural') {
    for (const line of bundle.boq) {
      if (line.kind !== 'item') continue;
      const row = itemFromReport(line, defaultUniformat, elementKey);
      row.workCategory = classifyWorkCategory({
        ...row,
        workCategory: line.workCategory,
        elementKey,
        summaryKey: structuralSummaryKey(line),
      });
      collected.push(row);
    }
    return collected;
  }

  if (bundle.kind === 'finish' || bundle.kind === 'mep') {
    for (const line of bundle.boq) {
      if (line.kind !== 'item') continue;
      const row = itemFromReport(line, defaultUniformat, elementKey);
      row.workCategory = classifyWorkCategory({
        ...row,
        elementKey,
        summaryKey:
          bundle.kind === 'mep' ? 'mep' : finishSummaryKey(line),
      });
      collected.push(row);
    }
    return collected;
  }

  if (bundle.kind === 'masonry') {
    // Prefer BOQ items (Masonry / Blinding) so categories match produced lines.
    for (const line of bundle.boq) {
      if (line.kind !== 'item') continue;
      const row = itemFromReport(line, defaultUniformat, elementKey);
      row.workCategory = classifyWorkCategory({
        ...row,
        workCategory: line.workCategory,
        elementKey,
        summaryKey: masonrySummaryKey(line),
      });
      collected.push(row);
    }
    return collected;
  }

  if (bundle.kind === 'earthworks') {
    for (const line of bundle.boq) {
      if (line.kind !== 'item') continue;
      const row = itemFromReport(line, defaultUniformat, elementKey);
      row.workCategory = classifyWorkCategory({
        ...row,
        workCategory: line.workCategory,
        elementKey,
        summaryKey: /\bdispos|\bcart|\bspoil|\bhaul/i.test(line.description || '')
          ? 'disposal'
          : 'excavation',
      });
      collected.push(row);
    }
    return collected;
  }

  // priced summary keys (legacy / other kinds)
  const rates = makeRateAccessors(
    project.rateLib as any,
    DEFAULT_PRICING,
    project.useRateAnalysis !== false,
  );
  for (const k of Object.keys(bundle.summary)) {
    const qty = bundle.summary[k];
    const unit = k === 'area' || k === 'tiles' ? 'm²' : 'm³';
    const rate = rates.boqRate(k);
    const amount = lineAmount(qty, rate);
    const row: CostPlanLine = {
      kind: 'item',
      description: `${bundle.label} — ${k.charAt(0).toUpperCase()}${k.slice(1)}`,
      qty,
      unit,
      rate,
      amount,
      uniformatCode: defaultUniformat,
      elementKey,
      source: 'MODELLED',
      workCategory: classifyWorkCategory({
        description: `${bundle.label} — ${k}`,
        unit,
        elementKey,
        summaryKey: k,
      }),
    };
    collected.push(row);
  }
  return collected;
}

function buildCategorySections(
  emittedLines: CostPlanLine[],
): CostPlanCategorySection[] {
  const sections: CostPlanCategorySection[] = [];
  let current: CostPlanCategorySection | null = null;
  for (const line of emittedLines) {
    if (line.kind === 'group' && line.workCategory) {
      current = {
        category: line.workCategory,
        title: line.workCategory,
        lines: [line],
        subtotal: 0,
      };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    if (line.kind === 'item' && line.amount != null) {
      current.subtotal += line.amount;
    }
  }
  for (const s of sections) s.subtotal = round(s.subtotal);
  return sections;
}

const MANUAL_SECTION_ID = 'MANUAL';

export function buildCostPlan(
  project: IProject,
  instances: IInstance[],
  opts: {
    scope: 'floor' | 'project';
    floorId?: string | null;
    floors?: Array<{ floorId: string; label?: string; levelTypes?: unknown }>;
  },
  manualItems: ManualBoqCostPlanItem[] = [],
): CostPlanPayload {
  let filtered = instances.filter((i) => Boolean(ELEMENT_ENGINES[i.elementKey]));
  if (opts.scope === 'floor') {
    if (!opts.floorId) throw new Error('floorId is required when scope=floor');
    filtered = filtered.filter((i) => i.floorId === opts.floorId);
  }

  const floorLevelTypesById = buildFloorLevelTypesById(opts.floors);

  /** elementKey → instances */
  const byElement: Map<string, IInstance[]> = new Map();
  for (const inst of filtered) {
    if (!byElement.has(inst.elementKey)) byElement.set(inst.elementKey, []);
    byElement.get(inst.elementKey)!.push(inst);
  }

  const groups: CostPlanGroupSection[] = [];
  const flat: CostPlanLine[] = [];
  let grandTotal = 0;
  let unclassifiedCount = 0;
  let beforeItemCount = 0;
  let beforeAmountSum = 0;

  const elementKeys = [...byElement.keys()].sort(
    (a, b) => elementSortKey(a) - elementSortKey(b),
  );

  for (const elementKey of elementKeys) {
    const insts = byElement.get(elementKey)!;
    const meta = ELEMENT_META[elementKey];
    const label = meta?.label || elementKey;

    // Dominant UniFormat for this element set (first resolved; collect all for tag)
    const uniformatCodes: string[] = [];
    for (const inst of insts) {
      const resolved = resolveUniformatCode(inst.elementKey, {
        location: (inst as IInstance & { location?: string | null }).location,
        floorId: inst.floorId,
      });
      const code = codeBucketKey(resolved.code);
      if (!uniformatCodes.includes(code)) uniformatCodes.push(code);
    }
    const defaultUf = uniformatCodes[0] || 'Z9990';

    const bundle = buildBundleForInstances(
      elementKey,
      insts,
      project,
      floorLevelTypesById,
    );
    if (!bundle) continue;

    const collected = collectFromBundle(elementKey, bundle, project, defaultUf);
    // Stamp per-instance UniFormat when walls split Interior/Exterior etc.
    // (bundle is aggregated; keep defaultUf on lines — codes still listed on heading)

    beforeItemCount += collected.length;
    for (const row of collected) {
      if (row.amount != null) beforeAmountSum += row.amount;
    }

    const heading = elementHeading(label, uniformatCodes);
    flat.push(
      groupLine(heading, { elementKey, outlineLevel: 0 }),
    );

    const prefix = meta ? `${meta.num}${meta.suffix || ''}` : elementKey;
    const emitted = emitCategorisedItems(
      prefix,
      collected,
      categoryOrderForElement(elementKey),
    );
    for (const row of emitted.flat) flat.push(row);

    const subtotal = round(emitted.subtotal);
    const sub = totalLine(`${label} total`, subtotal);
    sub.elementKey = elementKey;
    flat.push(sub);

    groups.push({
      id: elementKey,
      title: label,
      heading,
      elementKey,
      uniformatCodes,
      categories: buildCategorySections(emitted.lines),
      subtotal,
    });
    grandTotal += subtotal;
  }

  // Manual BOQ — own primary section (no modelled element key)
  if (manualItems.length) {
    const collected: CostPlanLine[] = [];
    const uniformatCodes: string[] = [];
    for (const m of manualItems) {
      const raw = (m.uniformatCode || '').trim().toUpperCase();
      const code = codeBucketKey(raw && UNIFORMAT_CODES[raw] ? raw : 'Z9990');
      if (!uniformatCodes.includes(code)) uniformatCodes.push(code);
      if (code === 'Z9990') unclassifiedCount += 1;
      const amount = lineAmount(m.quantity, m.appliedUnitRate);
      const row: CostPlanLine = {
        kind: 'item',
        description: m.description,
        qty: m.quantity,
        unit: m.unit,
        rate: m.appliedUnitRate,
        amount,
        uniformatCode: code,
        source: 'MANUAL',
        workCategory: classifyWorkCategory({
          description: m.description,
          unit: m.unit,
          source: 'MANUAL',
        }),
      };
      collected.push(row);
    }

    beforeItemCount += collected.length;
    for (const row of collected) {
      if (row.amount != null) beforeAmountSum += row.amount;
    }

    const label = 'Manual BOQ';
    const heading = elementHeading(label, uniformatCodes);
    flat.push(groupLine(heading, { outlineLevel: 0 }));

    const emitted = emitCategorisedItems('M', collected, WORK_CATEGORY_ORDER);
    for (const row of emitted.flat) flat.push(row);

    const subtotal = round(emitted.subtotal);
    flat.push(totalLine(`${label} total`, subtotal, 'MANUAL'));

    groups.push({
      id: MANUAL_SECTION_ID,
      title: label,
      heading,
      elementKey: null,
      uniformatCodes,
      categories: buildCategorySections(emitted.lines),
      subtotal,
    });
    grandTotal += subtotal;
  }

  grandTotal = round(grandTotal);
  flat.push(
    totalLine(
      'COST PLAN TOTAL (excl. Design Allowance, OH&P, Inflation)',
      grandTotal,
    ),
  );

  const afterItemCount = flat.filter((l) => l.kind === 'item').length;
  lastRegroupIntegrity = {
    beforeItemCount,
    afterItemCount,
    beforeGrandTotal: round(beforeAmountSum),
    afterGrandTotal: grandTotal,
  };

  const gfaM2 = resolvedGfaM2(project);
  if (gfaM2 != null) {
    applyRatePerM2(flat, gfaM2);
  }

  const cascade = computeCostPlanCascade(
    grandTotal,
    resolveCascadePercents(project),
    { gfaM2 },
  );

  return {
    currency: project.currency,
    scope: opts.scope,
    floorId: opts.scope === 'floor' ? opts.floorId || null : null,
    gfaM2,
    groups,
    lines: flat,
    grandTotal,
    unclassifiedCount,
    cascade,
  };
}

/** @deprecated kept for call sites that still format UniFormat headings */
export { formatUniformatHeading };

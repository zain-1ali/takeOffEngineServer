/**
 * Build UniFormat II Cost Plan from priced modelled instances + manual BOQ.
 * When project.gfaM2 is set, Rate/m² = amount ÷ gfaM2 on items and subtotals.
 */
import type { IInstance } from '../../models/Instance';
import type { IProject } from '../../models/Project';
import { DEFAULT_PRICING } from '../../defaults/projectDefaults';
import { ELEMENT_ENGINES } from '../../elementEngines';
import { round } from '../../engines/math';
import { ELEMENT_META } from '../reports/elementMeta';
import { makeEntries } from '../reports/builders';
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
  UNIFORMAT_GROUPS,
  formatGroupHeading,
  formatUniformatHeading,
  resolveUniformatCode,
} from './uniformat';

export type CostPlanWorkCategory =
  | 'Concrete'
  | 'Formwork'
  | 'Reinforcement'
  | 'Masonry'
  | 'Finishes'
  | 'Other';

export type CostPlanLine = ReportLine & {
  uniformatCode?: string;
  elementKey?: string;
  /** amount ÷ gfaM2; omitted when GFA is not set. */
  ratePerM2?: number;
  /** Second-level work category within a UniFormat code section. */
  workCategory?: CostPlanWorkCategory;
};

/** Display order for category subheaders within each UniFormat code. */
export const WORK_CATEGORY_ORDER: CostPlanWorkCategory[] = [
  'Concrete',
  'Formwork',
  'Reinforcement',
  'Masonry',
  'Finishes',
  'Other',
];

export function classifyWorkCategory(
  line: Pick<ReportLine, 'description' | 'unit' | 'isRebar'> & {
    elementKey?: string;
    source?: string;
    summaryKey?: string;
  },
): CostPlanWorkCategory {
  if (line.isRebar) return 'Reinforcement';

  const key = (line.summaryKey || '').toLowerCase();
  if (key === 'masonry' || key === 'mortar') return 'Masonry';
  if (key === 'area') return 'Finishes';
  if (key === 'blinding' || key === 'concrete') return 'Concrete';

  const el = (line.elementKey || '').toUpperCase();
  if (
    el === 'FLOOR_FINISH' ||
    el === 'WALL_FINISH' ||
    el === 'CEILING_FINISH'
  ) {
    return 'Finishes';
  }
  if (el === 'MASONRY' || el === 'STONE_STRIP') return 'Masonry';

  const d = (line.description || '').toLowerCase();
  if (
    /\brebar\b|\breinforcement\b|\bhigh-yield\b|\breinforcing\b|\bsteel bar/.test(
      d,
    )
  ) {
    return 'Reinforcement';
  }
  if (/\bformwork\b|\bfalsework\b|\bsoffit\b/.test(d)) return 'Formwork';
  if (
    /\bmasonry\b|\bblock work\b|\bblockwork\b|\bstone\b|\bbrick\b/.test(d)
  ) {
    return 'Masonry';
  }
  if (
    /\bfinish\b|\bplaster\b|\bpaint\b|\btile\b|\bscreed\b|\bceiling\b/.test(d)
  ) {
    return 'Finishes';
  }
  if (/\bconcrete\b|\bblinding\b|\bin-situ\b|\binsitu\b/.test(d)) {
    return 'Concrete';
  }

  // Structural m³ without other cues → concrete; m² often formwork for RC elements
  if (line.unit === 'm³' || line.unit === 'm3') return 'Concrete';
  if (
    (line.unit === 'm²' || line.unit === 'm2') &&
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

function categoryHeader(category: CostPlanWorkCategory): CostPlanLine {
  return {
    kind: 'group',
    description: category,
    source: 'MODELLED',
    workCategory: category,
  };
}

/**
 * Emit items under category subheaders (Concrete → … → Other).
 * Re-numbers refs as `{code}.1`, `{code}.2`, … in final display order.
 * Does not drop, duplicate, or alter amounts — only reorders + adds headers.
 */
export function emitCategorisedItems(
  code: string,
  items: CostPlanLine[],
): { lines: CostPlanLine[]; flat: CostPlanLine[]; subtotal: number } {
  const buckets: Map<CostPlanWorkCategory, CostPlanLine[]> = new Map();
  for (const cat of WORK_CATEGORY_ORDER) buckets.set(cat, []);

  for (const item of items) {
    const cat = item.workCategory || classifyWorkCategory(item);
    item.workCategory = cat;
    buckets.get(cat)!.push(item);
  }

  const lines: CostPlanLine[] = [];
  const flat: CostPlanLine[] = [];
  let subtotal = 0;
  let n = 0;

  for (const cat of WORK_CATEGORY_ORDER) {
    const rows = buckets.get(cat)!;
    if (!rows.length) continue;
    const header = categoryHeader(cat);
    lines.push(header);
    flat.push(header);
    for (const row of rows) {
      n++;
      const numbered: CostPlanLine = {
        ...row,
        ref: row.source === 'MANUAL' ? `${code}.M${n}` : `${code}.${n}`,
        workCategory: cat,
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


export type CostPlanCodeSection = {
  code: string;
  title: string;
  heading: string;
  lines: CostPlanLine[];
  subtotal: number;
};

export type CostPlanGroupSection = {
  id: string;
  title: string;
  heading: string;
  codes: CostPlanCodeSection[];
  subtotal: number;
};

export type CostPlanPayload = {
  currency: string;
  scope: 'floor' | 'project';
  floorId: string | null;
  /** Gross Floor Area (m²). Null → omit Rate/m² column. */
  gfaM2: number | null;
  groups: CostPlanGroupSection[];
  /** Flat lines in UniFormat order (headers + items + subtotals) for table render. */
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

function groupLine(description: string): CostPlanLine {
  return { kind: 'group', description, source: 'MODELLED' };
}

function totalLine(description: string, amount: number, source: 'MODELLED' | 'MANUAL' = 'MODELLED'): CostPlanLine {
  return { kind: 'total', description, amount, source };
}

function itemFromReport(
  line: ReportLine,
  uniformatCode: string,
  elementKey: string,
): CostPlanLine {
  return {
    ...line,
    uniformatCode,
    elementKey,
    source: line.source || 'MODELLED',
  };
}

function buildBundleForInstances(
  elementKey: string,
  instances: IInstance[],
  project: IProject,
): ElementReportBundle | null {
  const engine = ELEMENT_ENGINES[elementKey];
  if (!engine || !instances.length) return null;
  const rates = makeRateAccessors(
    project.rateLib as any,
    DEFAULT_PRICING,
    project.useRateAnalysis !== false,
  );
  const materials = materialsForBom(project.materials);
  const entries = makeEntries(instances);
  return engine.buildReports(entries, materials, rates);
}

function codeBucketKey(code: string): string {
  return UNIFORMAT_CODES[code] ? code : 'Z9990';
}

export function buildCostPlan(
  project: IProject,
  instances: IInstance[],
  opts: { scope: 'floor' | 'project'; floorId?: string | null },
  manualItems: ManualBoqCostPlanItem[] = [],
): CostPlanPayload {
  let filtered = instances.filter((i) => Boolean(ELEMENT_ENGINES[i.elementKey]));
  if (opts.scope === 'floor') {
    if (!opts.floorId) throw new Error('floorId is required when scope=floor');
    filtered = filtered.filter((i) => i.floorId === opts.floorId);
  }

  /** code → elementKey → instances */
  const byCodeElement: Map<string, Map<string, IInstance[]>> = new Map();

  for (const inst of filtered) {
    const resolved = resolveUniformatCode(inst.elementKey, {
      location: (inst as IInstance & { location?: string | null }).location,
      floorId: inst.floorId,
    });
    const code = codeBucketKey(resolved.code);
    if (!byCodeElement.has(code)) byCodeElement.set(code, new Map());
    const byEl = byCodeElement.get(code)!;
    if (!byEl.has(inst.elementKey)) byEl.set(inst.elementKey, []);
    byEl.get(inst.elementKey)!.push(inst);
  }

  /** code → manual items */
  const manualByCode: Map<string, ManualBoqCostPlanItem[]> = new Map();
  for (const m of manualItems) {
    if (opts.scope === 'floor' && m) {
      // floor filter already applied by caller for manual items
    }
    const raw = (m.uniformatCode || '').trim().toUpperCase();
    const code = codeBucketKey(raw && UNIFORMAT_CODES[raw] ? raw : 'Z9990');
    if (!manualByCode.has(code)) manualByCode.set(code, []);
    manualByCode.get(code)!.push(m);
  }

  const usedCodes = new Set([...byCodeElement.keys(), ...manualByCode.keys()]);
  const groups: CostPlanGroupSection[] = [];
  const flat: CostPlanLine[] = [];
  let grandTotal = 0;
  let unclassifiedCount = 0;
  let beforeItemCount = 0;
  let beforeAmountSum = 0;

  for (const g of UNIFORMAT_GROUPS) {
    const codesInGroup = Object.values(UNIFORMAT_CODES)
      .filter((c) => c.group === g.id && usedCodes.has(c.code))
      .sort((a, b) => a.code.localeCompare(b.code));

    if (!codesInGroup.length) continue;

    const groupHeading = formatGroupHeading(g.id);
    flat.push(groupLine(groupHeading));

    const codeSections: CostPlanCodeSection[] = [];
    let groupSubtotal = 0;

    for (const def of codesInGroup) {
      const heading = formatUniformatHeading(def.code);
      flat.push(groupLine(heading));

      const collected: CostPlanLine[] = [];

      const byEl = byCodeElement.get(def.code);
      if (byEl) {
        const elementKeys = [...byEl.keys()].sort(
          (a, b) => (ELEMENT_META[a]?.num || 0) - (ELEMENT_META[b]?.num || 0),
        );
        for (const elementKey of elementKeys) {
          const insts = byEl.get(elementKey)!;
          const bundle = buildBundleForInstances(elementKey, insts, project);
          if (!bundle) continue;

          if (bundle.kind === 'structural') {
            for (const line of bundle.boq) {
              if (line.kind !== 'item') continue;
              const row = itemFromReport(line, def.code, elementKey);
              row.workCategory = classifyWorkCategory({
                ...row,
                elementKey,
              });
              collected.push(row);
            }
          } else {
            // finish / masonry / earthworks — one priced summary line per summary key
            const rates = makeRateAccessors(
              project.rateLib as any,
              DEFAULT_PRICING,
              project.useRateAnalysis !== false,
            );
            for (const k of Object.keys(bundle.summary)) {
              if (k === 'mortar') continue;
              const qty = bundle.summary[k];
              const unit = k === 'area' ? 'm²' : 'm³';
              let rateCode = k;
              if (k === 'masonry') rateCode = 'stoneMasonry';
              if (k === 'blinding') rateCode = 'blinding';
              if (k === 'area') {
                if (elementKey === 'FLOOR_FINISH') rateCode = 'floorFinish';
                else if (elementKey === 'WALL_FINISH') rateCode = 'wallFinish';
                else rateCode = 'ceilingFinish';
              }
              const rate = rates.boqRate(rateCode);
              const amount = lineAmount(qty, rate);
              const row: CostPlanLine = {
                kind: 'item',
                description: `${bundle.label} — ${k.charAt(0).toUpperCase()}${k.slice(1)}`,
                qty,
                unit,
                rate,
                amount,
                uniformatCode: def.code,
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
          }
        }
      }

      const manuals = manualByCode.get(def.code) || [];
      for (const m of manuals) {
        const amount = lineAmount(m.quantity, m.appliedUnitRate);
        const row: CostPlanLine = {
          kind: 'item',
          description: m.description,
          qty: m.quantity,
          unit: m.unit,
          rate: m.appliedUnitRate,
          amount,
          uniformatCode: def.code,
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

      const emitted = emitCategorisedItems(def.code, collected);
      const sectionLines: CostPlanLine[] = [...emitted.lines];
      for (const row of emitted.flat) flat.push(row);
      let subtotal = emitted.subtotal;

      if (def.code === 'Z9990') {
        unclassifiedCount += sectionLines.filter((l) => l.kind === 'item').length;
      }

      subtotal = round(subtotal);
      const sub = totalLine(`${heading} · Sub-total`, subtotal);
      sub.uniformatCode = def.code;
      sectionLines.push(sub);
      flat.push(sub);

      codeSections.push({
        code: def.code,
        title: def.title,
        heading,
        lines: sectionLines,
        subtotal,
      });
      groupSubtotal += subtotal;
    }

    groupSubtotal = round(groupSubtotal);
    const gTot = totalLine(`${groupHeading} total`, groupSubtotal);
    flat.push(gTot);

    groups.push({
      id: g.id,
      title: g.title,
      heading: groupHeading,
      codes: codeSections,
      subtotal: groupSubtotal,
    });
    grandTotal += groupSubtotal;
  }

  grandTotal = round(grandTotal);
  flat.push(totalLine('COST PLAN TOTAL (excl. Design Allowance, OH&P, Inflation)', grandTotal));

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

import type { SelectedBoqReportItem } from '../selectedBoq';
import { lineAmount, type RateAccessors } from './pricing';
import {
  qtyContextFromSummary,
  resolveCatalogueQty,
} from './boqCatalogue/resolveCatalogueQty';
import { ELEMENT_META } from './elementMeta';
import type { ElementReportBundle, ReportLine, ReportSource } from './types';
import type { FloorLevelType } from '../../lib/levelCompatibility';

export function emptyElementBundle(elementKey: string): ElementReportBundle | null {
  const meta = ELEMENT_META[elementKey];
  if (!meta) return null;
  return {
    elementKey: meta.key,
    num: meta.num,
    suffix: meta.suffix,
    label: meta.label,
    kind: meta.kind,
    units: 0,
    boq: [],
    bom: [],
    labour: { activities: [], trades: [], totalManDays: 0, totalCost: 0 },
    summary: {},
    cost: { boq: 0, bom: 0, labour: 0 },
  };
}

function selectedLine(args: {
  sel: SelectedBoqReportItem;
  qty: number;
  unit: string;
  rate: number | null;
  suggestedQty?: number;
  isRebar?: boolean;
  dec?: number;
}): ReportLine {
  return {
    kind: 'item',
    ref: args.sel.catalogueRef,
    description: args.sel.description,
    qty: args.qty,
    unit: args.unit || args.sel.unit,
    rate: args.rate,
    amount: lineAmount(args.qty, args.rate),
    source: 'CATALOGUE' as ReportSource,
    nrm2Ref: args.sel.nrm2Ref,
    quantityBasis: args.sel.quantityBasis,
    workCategory: args.sel.workCategory,
    formulaText: args.sel.formulaText,
    applicableLevels: args.sel.applicableLevels,
    selectedBoqId: args.sel.id,
    suggestedQty: args.suggestedQty,
    isRebar: args.isRebar,
    dec: args.dec,
  };
}

/**
 * BOQ is only user-added catalogue items. Engine A/B/C lines are dropped.
 * Qty comes from the stored selection (manual / takeoff / applied schedule).
 * A bound schedule qty is exposed as suggestedQty — not auto-applied.
 */
export function mergeSelectedBoqIntoByElement(
  byElement: ElementReportBundle[],
  selected: SelectedBoqReportItem[],
  opts?: {
    floorId?: string | null;
    elementKey?: string | null;
    rates?: RateAccessors;
    floorLevelTypesByElement?: Record<string, FloorLevelType[] | 'all'>;
  },
): ElementReportBundle[] {
  const map = new Map<string, ElementReportBundle>();
  for (const be of byElement) {
    map.set(be.elementKey, {
      ...be,
      boq: [],
      bom: [...be.bom],
      summary: { ...be.summary },
      cost: { ...be.cost, boq: 0 },
      labour: {
        ...be.labour,
        activities: [...be.labour.activities],
        trades: [...be.labour.trades],
      },
    });
  }

  const filtered = selected.filter((s) => {
    if (opts?.elementKey && s.elementKey !== opts.elementKey) return false;
    if (opts?.floorId && s.floorId !== opts.floorId) return false;
    return true;
  });

  const byElementSelections = new Map<string, SelectedBoqReportItem[]>();
  for (const sel of filtered) {
    const list = byElementSelections.get(sel.elementKey) || [];
    list.push(sel);
    byElementSelections.set(sel.elementKey, list);
  }

  for (const [elementKey, sels] of byElementSelections) {
    let bundle = map.get(elementKey);
    if (!bundle) {
      const shell = emptyElementBundle(elementKey);
      if (!shell) continue;
      bundle = shell;
      map.set(elementKey, bundle);
    }

    const ctx = qtyContextFromSummary(bundle.summary);
    const floorTypes =
      opts?.floorLevelTypesByElement?.[elementKey] ?? ('all' as const);
    const rates = opts?.rates;

    const newBoq: ReportLine[] = [];
    let boqTot = 0;

    const ordered = [...sels].sort((a, b) =>
      a.catalogueRef.localeCompare(b.catalogueRef, undefined, { numeric: true }),
    );

    for (const sel of ordered) {
      if (
        sel.workCategory &&
        !newBoq.some(
          (l) => l.kind === 'group' && l.workCategory === sel.workCategory,
        )
      ) {
        newBoq.push({
          kind: 'group',
          description: sel.workCategory,
          workCategory: sel.workCategory,
          source: 'CATALOGUE',
        });
      }

      const resolved = resolveCatalogueQty({
        elementKey,
        catalogueRef: sel.catalogueRef,
        ctx,
        floorLevelTypes: floorTypes,
      });
      const suggestedQty =
        resolved && resolved.qty > 0 ? resolved.qty : undefined;
      const rate = resolved && rates ? rates.boqRate(resolved.rateKey) : null;
      const qty = Number(sel.quantity) || 0;
      const line = selectedLine({
        sel,
        qty,
        unit: sel.unit || resolved?.unit || '',
        rate,
        suggestedQty,
        isRebar: resolved?.isRebar,
        dec: resolved?.dec,
      });
      newBoq.push(line);
      if (line.amount != null) boqTot += line.amount;
    }

    if (newBoq.some((l) => l.kind === 'item')) {
      newBoq.push({
        kind: 'total',
        description: 'Element total (excl. prelims & OH&P)',
        amount: boqTot,
      });
    }

    bundle.boq = newBoq;
    bundle.cost = { ...bundle.cost, boq: boqTot };
  }

  return [...map.values()].sort(
    (a, b) => a.num - b.num || a.suffix.localeCompare(b.suffix),
  );
}

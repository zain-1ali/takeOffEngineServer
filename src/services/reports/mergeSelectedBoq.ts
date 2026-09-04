import type { SelectedBoqReportItem } from '../selectedBoq';
import { lineAmount, type RateAccessors } from './pricing';
import { normalizeRef } from './boqCatalogue';
import {
  qtyContextFromSummary,
  resolveCatalogueQty,
  type CatalogueQtyContext,
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

function indexMeasuredByRef(boq: ReportLine[]): Map<string, ReportLine[]> {
  const map = new Map<string, ReportLine[]>();
  for (const line of boq) {
    if (line.kind !== 'item' || !line.ref) continue;
    const key = normalizeRef(line.ref);
    const list = map.get(key) || [];
    list.push(line);
    map.set(key, list);
  }
  return map;
}

function selectedLine(args: {
  sel: SelectedBoqReportItem;
  qty: number;
  unit: string;
  rate: number | null;
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
    isRebar: args.isRebar,
    dec: args.dec,
  };
}

/**
 * When the user has Add-to-BOQ selections for an element:
 * rebuild that element's BOQ from those selections and fill qty from
 * schedule/engine measured lines (or summary bindings).
 *
 * When there are no selections for an element, leave engine BOQ as-is.
 * BOM / Labour stay engine-driven from instances (unchanged).
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
  if (!selected.length) return byElement;

  const map = new Map<string, ElementReportBundle>();
  for (const be of byElement) {
    map.set(be.elementKey, {
      ...be,
      boq: [...be.boq],
      bom: [...be.bom],
      summary: { ...be.summary },
      cost: { ...be.cost },
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

    const measured = indexMeasuredByRef(bundle.boq);
    const ctx: CatalogueQtyContext = qtyContextFromSummary(bundle.summary);
    const floorTypes =
      opts?.floorLevelTypesByElement?.[elementKey] ?? ('all' as const);
    const rates = opts?.rates;

    const newBoq: ReportLine[] = [];
    let boqTot = 0;

    // Stable order by catalogue ref
    const ordered = [...sels].sort((a, b) =>
      a.catalogueRef.localeCompare(b.catalogueRef, undefined, { numeric: true }),
    );

    for (const sel of ordered) {
      const want = normalizeRef(sel.catalogueRef);
      const existing = measured.get(want);

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

      if (existing && existing.length) {
        for (const line of existing) {
          newBoq.push({
            ...line,
            // Keep measured wording/qty; mark as catalogue pick when selected
            source: line.source || 'CATALOGUE',
          });
          if (line.amount != null) boqTot += line.amount;
        }
        continue;
      }

      const resolved = resolveCatalogueQty({
        elementKey,
        catalogueRef: sel.catalogueRef,
        ctx,
        floorLevelTypes: floorTypes,
      });

      if (resolved) {
        const rate = rates ? rates.boqRate(resolved.rateKey) : null;
        const line = selectedLine({
          sel,
          qty: resolved.qty,
          unit: sel.unit || resolved.unit,
          rate,
          isRebar: resolved.isRebar,
          dec: resolved.dec,
        });
        newBoq.push(line);
        if (line.amount != null) boqTot += line.amount;
      } else {
        newBoq.push(
          selectedLine({
            sel,
            qty: Number(sel.quantity) || 0,
            unit: sel.unit,
            rate: null,
          }),
        );
      }
    }

    newBoq.push({
      kind: 'total',
      description: 'Element total (excl. prelims & OH&P)',
      amount: boqTot,
    });

    bundle.boq = newBoq;
    bundle.cost = { ...bundle.cost, boq: boqTot };
  }

  return [...map.values()].sort(
    (a, b) => a.num - b.num || a.suffix.localeCompare(b.suffix),
  );
}

import type { SelectedBoqReportItem } from '../selectedBoq';
import { normalizeRef } from './boqCatalogue';
import { ELEMENT_META } from './elementMeta';
import type { ElementReportBundle, ReportLine, ReportSource } from './types';

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

export function selectedItemToReportLine(item: SelectedBoqReportItem): ReportLine {
  const qty = Number(item.quantity) || 0;
  return {
    kind: 'item',
    ref: item.catalogueRef,
    description: item.description,
    qty,
    unit: item.unit,
    rate: null,
    amount: null,
    source: 'CATALOGUE' as ReportSource,
    nrm2Ref: item.nrm2Ref,
    quantityBasis: item.quantityBasis,
    workCategory: item.workCategory,
    formulaText: item.formulaText,
    applicableLevels: item.applicableLevels,
  };
}

/**
 * Merge user-selected catalogue lines into byElement BOQ.
 * Skips refs already present from engine/catalogue core bindings.
 * Creates empty element shells when only selections exist (no instances).
 */
export function mergeSelectedBoqIntoByElement(
  byElement: ElementReportBundle[],
  selected: SelectedBoqReportItem[],
  opts?: { floorId?: string | null; elementKey?: string | null },
): ElementReportBundle[] {
  if (!selected.length) return byElement;

  const map = new Map<string, ElementReportBundle>();
  for (const be of byElement) {
    map.set(be.elementKey, {
      ...be,
      boq: [...be.boq],
    });
  }

  const filtered = selected.filter((s) => {
    if (opts?.elementKey && s.elementKey !== opts.elementKey) return false;
    if (opts?.floorId && s.floorId !== opts.floorId) return false;
    return true;
  });

  for (const sel of filtered) {
    let bundle = map.get(sel.elementKey);
    if (!bundle) {
      const shell = emptyElementBundle(sel.elementKey);
      if (!shell) continue;
      bundle = shell;
      map.set(sel.elementKey, bundle);
    }

    const want = normalizeRef(sel.catalogueRef);
    const already = bundle.boq.some(
      (l) => l.kind === 'item' && normalizeRef(l.ref || '') === want,
    );
    if (already) continue;

    if (
      sel.workCategory &&
      !bundle.boq.some(
        (l) => l.kind === 'group' && l.workCategory === sel.workCategory,
      )
    ) {
      bundle.boq.push({
        kind: 'group',
        description: sel.workCategory,
        workCategory: sel.workCategory,
        source: 'CATALOGUE',
      });
    }

    bundle.boq.push(selectedItemToReportLine(sel));
  }

  return [...map.values()].sort(
    (a, b) => a.num - b.num || a.suffix.localeCompare(b.suffix),
  );
}

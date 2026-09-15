import type { SelectedBoqReportItem } from '../selectedBoq';
import { billedQty } from './billedQty';
import { lineAmount, type RateAccessors } from './pricing';
import {
  qtyContextFromSummary,
  resolveCatalogueQty,
} from './boqCatalogue/resolveCatalogueQty';
import { rateKeyForBoqLine } from './boqCatalogue/rateKeyForLine';
import { workCategoriesForElement } from './boqCatalogue';
import { ELEMENT_META } from './elementMeta';
import type { ElementReportBundle, ReportLine, ReportSource } from './types';
import type { FloorLevelType } from '../../lib/levelCompatibility';
import {
  isCatalogueElementKey,
  parseCatalogueElementKey,
} from '../boqPack/elementAliases';
import { lookupPackCompositeRate } from '../boqPack/packRateLookup';
import { PROJECT_SCOPE_FLOOR_ID } from '../boqPack/scope';
import type { PackElementMeta } from '../boqPack/packReportContext';

export function emptyElementBundle(
  elementKey: string,
  packMeta?: Record<string, PackElementMeta>,
): ElementReportBundle | null {
  const pack = packMeta?.[elementKey];
  const engineKey = (pack?.engineKey || '').trim();
  const engineMeta = engineKey ? ELEMENT_META[engineKey] : undefined;
  const meta = ELEMENT_META[elementKey] || engineMeta;

  if (meta && !isCatalogueElementKey(elementKey)) {
    return {
      elementKey: meta.key,
      num: meta.num,
      suffix: meta.suffix,
      label: pack?.label || meta.label,
      kind: meta.kind,
      engineKey: engineKey || meta.key,
      units: 0,
      boq: [],
      bom: [],
      labour: { activities: [], trades: [], totalManDays: 0, totalCost: 0 },
      summary: {},
      cost: { boq: 0, bom: 0, labour: 0 },
    };
  }

  const parsed = parseCatalogueElementKey(elementKey);
  if (!pack && !parsed && !isCatalogueElementKey(elementKey)) return null;

  const moduleNo = pack?.moduleNo ?? parsed?.moduleNo ?? 0;
  const sortOrder = pack?.sortOrder ?? parsed?.elementNo ?? 0;
  return {
    elementKey,
    num: moduleNo * 1000 + sortOrder,
    suffix: '',
    label: pack?.label || `Module ${moduleNo} item`,
    kind: engineMeta?.kind || 'finish',
    engineKey: engineKey || undefined,
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
  quantityMode?: 'TYPED' | 'TAKEOFF' | '';
  qtySource?: ReportLine['qtySource'];
  isRebar?: boolean;
  dec?: number;
  takeoffLinked?: boolean;
  needsReview?: boolean;
}): ReportLine {
  return {
    kind: 'item',
    ref: args.sel.catalogueRef,
    description: args.sel.description,
    qty: args.qty,
    unit: args.unit || args.sel.unit,
    rate: args.rate,
    amount: args.needsReview ? null : lineAmount(args.qty, args.rate),
    source: (args.sel.isManual ? 'MANUAL' : 'CATALOGUE') as ReportSource,
    nrm2Ref: args.sel.nrm2Ref,
    quantityBasis: args.sel.quantityBasis,
    workCategory: args.sel.workCategory,
    formulaText: args.sel.formulaText,
    applicableLevels: args.sel.applicableLevels,
    selectedBoqId: args.sel.id,
    lineKey: args.sel.lineKey,
    suggestedQty: args.suggestedQty,
    quantityMode: args.quantityMode,
    qtySource: args.qtySource,
    isRebar: args.isRebar,
    dec: args.dec,
    takeoffKind: args.sel.takeoffKind,
    measurementSetId: args.sel.measurementSetId,
    takeoffLineCount: args.sel.takeoffLineCount,
    takeoffLinked: args.takeoffLinked,
  };
}

/**
 * BOQ is only user-added catalogue items. Engine A/B/C lines are dropped.
 * Bound CORE qty follows the engine unless quantityMode is TYPED or TAKEOFF.
 */
export function mergeSelectedBoqIntoByElement(
  byElement: ElementReportBundle[],
  selected: SelectedBoqReportItem[],
  opts?: {
    floorId?: string | null;
    elementKey?: string | null;
    rates?: RateAccessors;
    floorLevelTypesByElement?: Record<string, FloorLevelType[] | 'all'>;
    packRatesByLineKey?: Record<string, number>;
    packElementMeta?: Record<string, PackElementMeta>;
    hasActivePack?: boolean;
  },
): ElementReportBundle[] {
  const map = new Map();
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
    if (s.reconciliationStatus === 'ORPHANED') return false;
    if (opts?.elementKey && s.elementKey !== opts.elementKey) return false;
    if (opts?.floorId && s.floorId !== opts.floorId) {
      const projectWide =
        s.floorId === PROJECT_SCOPE_FLOOR_ID || s.scope === 'PROJECT';
      if (!projectWide) return false;
    }
    return true;
  });

  const byElementSelections = new Map();
  const setUsers = new Map();
  for (const sel of filtered) {
    const list = byElementSelections.get(sel.elementKey) || [];
    list.push(sel);
    byElementSelections.set(sel.elementKey, list);
    if (sel.measurementSetId) {
      setUsers.set(
        sel.measurementSetId,
        (setUsers.get(sel.measurementSetId) || 0) + 1,
      );
    }
  }

  for (const [elementKey, sels] of byElementSelections) {
    let bundle = map.get(elementKey);
    if (!bundle) {
      const shell = emptyElementBundle(elementKey, opts?.packElementMeta);
      if (!shell) continue;
      bundle = shell;
      map.set(elementKey, bundle);
    }

    const pack = opts?.packElementMeta?.[elementKey];
    const engineKey = (pack?.engineKey || bundle.engineKey || '').trim();
    if (engineKey && engineKey !== elementKey) {
      const engineBundle = map.get(engineKey);
      if (engineBundle?.summary && Object.keys(engineBundle.summary).length) {
        bundle.summary = { ...engineBundle.summary };
        bundle.units = bundle.units || engineBundle.units;
      }
    }
    bundle.engineKey = engineKey || bundle.engineKey;

    const ctx = qtyContextFromSummary(bundle.summary);
    const floorTypes =
      (engineKey && opts?.floorLevelTypesByElement?.[engineKey]) ||
      opts?.floorLevelTypesByElement?.[elementKey] ||
      ('all' as const);
    const rates = opts?.rates;

    const newBoq: ReportLine[] = [];
    let boqTot = 0;

    const catOrder = workCategoriesForElement(elementKey);
    const catIndex = (cat: string) => {
      const i = catOrder.indexOf(cat);
      return i === -1 ? catOrder.length : i;
    };
    const ordered = [...sels].sort((a, b) => {
      const ma = a.moduleNo ?? 99;
      const mb = b.moduleNo ?? 99;
      if (ma !== mb) return ma - mb;
      const lk = (a.lineKey || a.catalogueRef).localeCompare(
        b.lineKey || b.catalogueRef,
      );
      if (lk) return lk;
      const ca = (a.workCategory || '').trim();
      const cb = (b.workCategory || '').trim();
      const ia = ca ? catIndex(ca) : catOrder.length + 1;
      const ib = cb ? catIndex(cb) : catOrder.length + 1;
      if (ia !== ib) return ia - ib;
      if (ca !== cb) return ca.localeCompare(cb);
      if (Boolean(a.isManual) !== Boolean(b.isManual)) {
        return a.isManual ? 1 : -1;
      }
      return a.catalogueRef.localeCompare(b.catalogueRef, undefined, {
        numeric: true,
      });
    });

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
        engineKey: engineKey || undefined,
        headingLabel: pack?.label || bundle.label,
      });
      const engineQty = resolved ? resolved.qty : null;
      const suggestedQty = engineQty != null ? engineQty : undefined;
      const billed = billedQty({
        quantityMode: sel.quantityMode,
        storedQty: Number(sel.quantity) || 0,
        inputQty: sel.inputQuantity,
        inputQtySource: sel.inputQtySource,
        engineQty,
      });
      const packRate = lookupPackCompositeRate({
        hasActivePack: opts?.hasActivePack,
        isManual: sel.isManual,
        lineKey: sel.lineKey,
        moduleNo: sel.moduleNo,
        catalogueRef: sel.catalogueRef,
        packRatesByLineKey: opts?.packRatesByLineKey,
      });
      let rate: number | null = null;
      if (packRate != null) {
        rate = packRate;
      } else if (!opts?.hasActivePack || sel.isManual) {
        const rateKey =
          resolved?.rateKey ||
          rateKeyForBoqLine({
            elementKey,
            engineKey: engineKey || undefined,
            headingLabel: pack?.label || bundle.label,
            catalogueRef: sel.catalogueRef,
            workCategory: sel.workCategory,
            unit: sel.unit || resolved?.unit,
            description: sel.description,
            floorLevelTypes: floorTypes,
          });
        rate = rateKey && rates ? rates.boqRate(rateKey) : null;
      }
      const qty = billed.qty;
      const needsReview = sel.reconciliationStatus === 'NEEDS_REVIEW';
      const line = selectedLine({
        sel,
        qty,
        unit: sel.unit || resolved?.unit || '',
        rate,
        suggestedQty,
        quantityMode: sel.quantityMode || '',
        qtySource: billed.source,
        isRebar: resolved?.isRebar,
        dec: resolved?.dec,
        takeoffLinked: Boolean(
          (Number(sel.takeoffLineCount) || 0) > 0 ||
            Boolean(sel.measurementSetId) ||
            Boolean(sel.takeoffKind) ||
            (sel.measurementSetId &&
              (setUsers.get(sel.measurementSetId) || 0) > 1),
        ),
        needsReview,
      });
      newBoq.push(line);
      if (!needsReview && line.amount != null) boqTot += line.amount;
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

  const merged = [...map.values()].sort(
    (a, b) => a.num - b.num || a.suffix.localeCompare(b.suffix),
  );
  // Linked engines (Roof Slab → SLABS) leave both an engine shell and the
  // heading bundle. Element-tab reports must return the heading, not the
  // lower-numbered engine row (frontend reads byElement[0]).
  if (opts?.elementKey) {
    const heading = merged.find((be) => be.elementKey === opts.elementKey);
    if (heading) return [heading];
  }
  return merged;
}

import { Types } from 'mongoose';
import { BoqMeasurementSet } from '../../models/BoqMeasurementSet';
import { BlueprintSheet } from '../../models/BlueprintSheet';
import { TakeoffItemModel } from '../../models/TakeoffItem';
import {
  SelectedBoqItem,
  type ISelectedBoqItem,
} from '../../models/SelectedBoqItem';
import { bbsQuantity, sanitizeBars, type BbsBar } from './bbs';
import {
  clampQty,
  autoPrim,
  itemQuantity,
  sanitizeLines,
  takeoffKindFor,
  type TakeoffPrim,
  type TakeoffLine,
} from './measurement';

export type TakeoffLinkTarget = {
  setId: string;
  itemId: string;
  ref: string;
  description: string;
  unit: string;
  lineCount: number;
  lines: TakeoffLine[];
};

export type PdfMeasureTarget = {
  id: string;
  sheetId: string;
  sheetName: string;
  label: string;
  type: 'LINEAR' | 'AREA' | 'COUNT';
  value: number;
  unit: string;
  line: TakeoffLine;
};

export type TakeoffSharedBy = {
  id: string;
  ref: string;
  description: string;
  unit: string;
};

export type TakeoffDetail = {
  kind: 'dim' | 'bbs';
  unit: string;
  ref: string;
  description: string;
  elementKey: string;
  floorId: string;
  wastePct: number;
  measurementSetId: string | null;
  linked: boolean;
  lines: TakeoffLine[];
  bars: BbsBar[];
  sharedBy: TakeoffSharedBy[];
  linkTargets: TakeoffLinkTarget[];
  pdfMeasurements: PdfMeasureTarget[];
};

function pdfPrim(type: string): TakeoffPrim {
  if (type === 'COUNT') return 'count';
  if (type === 'LINEAR') return 'linear';
  return 'area';
}

function metricPdfValue(value: number, unit: string, prim: TakeoffPrim): number {
  const u = String(unit || '').trim().toLowerCase().replace('²', '2');
  if (prim === 'count') return value;
  if (prim === 'linear') {
    if (u === 'ft' || u === 'feet' || u === 'foot') return value * 0.3048;
    if (u === 'in' || u === 'inch' || u === 'inches') return value * 0.0254;
    if (u === 'mm') return value / 1000;
    if (u === 'cm') return value / 100;
    return value;
  }
  if (u === 'ft2' || u === 'sq ft' || u === 'sqft') return value * 0.09290304;
  if (u === 'in2' || u === 'sq in') return value * 0.00064516;
  if (u === 'mm2') return value / 1_000_000;
  if (u === 'cm2') return value / 10_000;
  return value;
}

function pdfLine(input: {
  id: string;
  sheetId: string;
  sheetName: string;
  label: string;
  type: string;
  value: number;
  unit: string;
}): TakeoffLine {
  const prim = pdfPrim(input.type);
  return {
    id: `pdf_${input.id}`,
    label: `PDF · ${input.sheetName} · ${input.label}`,
    ded: false,
    nr: 1,
    shape: 'direct',
    dims: {},
    depth: '',
    direct: {
      value: metricPdfValue(input.value, input.unit, prim),
      prim,
    },
    pdfTakeoffItemId: input.id,
    pdfSheetId: input.sheetId,
  };
}

async function loadPdfTargets(
  projectId: Types.ObjectId,
  floorId: string,
  targetUnit: string,
): Promise<PdfMeasureTarget[]> {
  const sheetFilter: Record<string, unknown> = { projectId };
  if (floorId !== '__PROJECT__') sheetFilter.floorId = floorId;
  const sheets = await BlueprintSheet.find(sheetFilter)
    .select({ _id: 1, name: 1, title: 1, pageNumber: 1 })
    .sort({ sortOrder: 1, pageNumber: 1 })
    .lean();
  if (!sheets.length) return [];
  const targetPrim = autoPrim(targetUnit);
  const items = await TakeoffItemModel.find({
    sheetId: { $in: sheets.map((s) => s._id) },
    type:
      targetPrim === 'count'
        ? 'COUNT'
        : targetPrim === 'linear'
          ? 'LINEAR'
          : targetPrim === 'area'
            ? 'AREA'
            : { $in: [] },
  })
    .sort({ createdAt: 1 })
    .lean();
  const sheetById = new Map(
    sheets.map((s) => [
      s._id.toString(),
      String(s.title || s.name || `Page ${s.pageNumber}`),
    ]),
  );
  return items.map((item) => {
    const id = item._id.toString();
    const sheetId = item.sheetId.toString();
    const sheetName = sheetById.get(sheetId) || 'Drawing';
    const label = String(item.label || item.type);
    const line = pdfLine({
      id,
      sheetId,
      sheetName,
      label,
      type: item.type,
      value: Number(item.calculatedValue) || 0,
      unit: item.unit,
    });
    return {
      id,
      sheetId,
      sheetName,
      label,
      type: item.type,
      value: Number(item.calculatedValue) || 0,
      unit: item.unit,
      line,
    };
  });
}

async function refreshPdfLines(
  projectId: Types.ObjectId,
  lines: TakeoffLine[],
): Promise<TakeoffLine[]> {
  const linked = lines.filter((line) => line.pdfTakeoffItemId);
  if (!linked.length) return lines;
  const ids = linked
    .map((line) => asObjectId(line.pdfTakeoffItemId))
    .filter((id): id is Types.ObjectId => Boolean(id));
  const items = await TakeoffItemModel.find({ _id: { $in: ids } }).lean();
  const sheets = await BlueprintSheet.find({
    _id: { $in: items.map((item) => item.sheetId) },
    projectId,
  })
    .select({ _id: 1, name: 1, title: 1, pageNumber: 1 })
    .lean();
  const sheetById = new Map(
    sheets.map((s) => [
      s._id.toString(),
      String(s.title || s.name || `Page ${s.pageNumber}`),
    ]),
  );
  const itemById = new Map(items.map((item) => [item._id.toString(), item]));
  return lines.map((line) => {
    if (!line.pdfTakeoffItemId) return line;
    const item = itemById.get(line.pdfTakeoffItemId);
    if (!item || !sheetById.has(item.sheetId.toString())) return line;
    return pdfLine({
      id: item._id.toString(),
      sheetId: item.sheetId.toString(),
      sheetName: sheetById.get(item.sheetId.toString()) || 'Drawing',
      label: String(item.label || item.type),
      type: item.type,
      value: Number(item.calculatedValue) || 0,
      unit: item.unit,
    });
  });
}

function asObjectId(id: unknown): Types.ObjectId | null {
  const s = String(id ?? '').trim();
  if (!Types.ObjectId.isValid(s)) return null;
  return new Types.ObjectId(s);
}

async function deleteSetIfOrphan(
  projectId: Types.ObjectId,
  setId: Types.ObjectId | null | undefined,
  exceptItemId?: Types.ObjectId,
) {
  if (!setId) return;
  const filter: Record<string, unknown> = {
    projectId,
    measurementSetId: setId,
  };
  if (exceptItemId) filter._id = { $ne: exceptItemId };
  const stillUsed = await SelectedBoqItem.exists(filter);
  if (!stillUsed) {
    await BoqMeasurementSet.deleteOne({ _id: setId, projectId });
  }
}

export async function recalcItemsOnSet(
  projectId: Types.ObjectId,
  setId: Types.ObjectId,
  lines: TakeoffLine[],
): Promise<string[]> {
  const siblings = await SelectedBoqItem.find({
    projectId,
    measurementSetId: setId,
    takeoffKind: 'dim',
  });
  const updated: string[] = [];
  for (const sib of siblings) {
    const q = itemQuantity(sib.unit, lines, sib.wastePct);
    sib.quantity = clampQty(q.total);
    sib.takeoffLineCount = lines.length;
    sib.quantityMode = 'TAKEOFF';
    await sib.save();
    updated.push(sib._id.toString());
  }
  return updated;
}

export async function getTakeoffDetail(
  projectId: Types.ObjectId,
  item: ISelectedBoqItem,
): Promise<TakeoffDetail> {
  const kind = takeoffKindFor(item.unit);
  const setId = item.measurementSetId || null;
  let lines: TakeoffLine[] = [];
  if (setId) {
    const set = await BoqMeasurementSet.findOne({
      _id: setId,
      projectId,
    });
    lines = sanitizeLines(set?.lines);
    const refreshed = await refreshPdfLines(projectId, lines);
    if (set && JSON.stringify(refreshed) !== JSON.stringify(lines)) {
      set.lines = refreshed;
      await set.save();
      await recalcItemsOnSet(projectId, set._id, refreshed);
    }
    lines = refreshed;
  }

  const sharedBy: TakeoffSharedBy[] = [];
  if (setId) {
    const others = await SelectedBoqItem.find({
      projectId,
      measurementSetId: setId,
      _id: { $ne: item._id },
    }).select({ catalogueRef: 1, description: 1, unit: 1 });
    for (const o of others) {
      sharedBy.push({
        id: o._id.toString(),
        ref: o.catalogueRef,
        description: o.description,
        unit: o.unit,
      });
    }
  }

  const candidates = await SelectedBoqItem.find({
    projectId,
    floorId: item.floorId,
    takeoffKind: 'dim',
    measurementSetId: { $ne: null },
    _id: { $ne: item._id },
  }).select({
    catalogueRef: 1,
    description: 1,
    unit: 1,
    measurementSetId: 1,
    takeoffLineCount: 1,
  });

  const seen = new Set<string>();
  const linkTargets: TakeoffLinkTarget[] = [];
  const targetSetIds = candidates
    .map((c) => c.measurementSetId)
    .filter((id): id is NonNullable<typeof id> => Boolean(id));
  const uniqueSetIds = [
    ...new Map(targetSetIds.map((id) => [id.toString(), id])).values(),
  ];
  const targetSets = uniqueSetIds.length
    ? await BoqMeasurementSet.find({
        projectId,
        _id: { $in: uniqueSetIds },
      })
    : [];
  const linesBySet = new Map(
    targetSets.map((s) => [s._id.toString(), sanitizeLines(s.lines)]),
  );
  for (const c of candidates) {
    const sid = c.measurementSetId?.toString();
    if (!sid || seen.has(sid)) continue;
    if (setId && sid === setId.toString()) continue;
    const tLines = linesBySet.get(sid) || [];
    if (tLines.length < 1) continue;
    seen.add(sid);
    linkTargets.push({
      setId: sid,
      itemId: c._id.toString(),
      ref: c.catalogueRef,
      description: c.description,
      unit: c.unit,
      lineCount: tLines.length,
      lines: tLines,
    });
  }

  const pdfMeasurements =
    kind === 'dim'
      ? await loadPdfTargets(projectId, item.floorId, item.unit)
      : [];

  return {
    kind,
    unit: item.unit,
    ref: item.catalogueRef,
    description: item.description,
    elementKey: item.elementKey,
    floorId: item.floorId,
    wastePct: Number(item.wastePct) || 0,
    measurementSetId: setId ? setId.toString() : null,
    linked: sharedBy.length > 0,
    lines,
    bars: sanitizeBars(item.bbsBars),
    sharedBy,
    linkTargets,
    pdfMeasurements,
  };
}

export async function applyDimTakeoff(opts: {
  projectId: Types.ObjectId;
  item: ISelectedBoqItem;
  wastePct: number;
  lines: unknown;
  measurementSetId?: string | null;
}): Promise<{ updatedIds: string[] }> {
  const lines = await refreshPdfLines(
    opts.projectId,
    sanitizeLines(opts.lines),
  );
  const requested = asObjectId(opts.measurementSetId);
  const prevSetId = opts.item.measurementSetId || null;

  let set = requested
    ? await BoqMeasurementSet.findOne({
        _id: requested,
        projectId: opts.projectId,
      })
    : null;

  if (!set && prevSetId && !requested) {
    const others = await SelectedBoqItem.exists({
      projectId: opts.projectId,
      measurementSetId: prevSetId,
      _id: { $ne: opts.item._id },
    });
    if (!others) {
      set = await BoqMeasurementSet.findOne({
        _id: prevSetId,
        projectId: opts.projectId,
      });
    }
  }

  if (!set) {
    set = await BoqMeasurementSet.create({
      projectId: opts.projectId,
      floorId: opts.item.floorId,
      name: opts.item.catalogueRef,
      lines,
    });
  } else {
    set.lines = lines;
    await set.save();
  }

  opts.item.measurementSetId = set._id;
  opts.item.wastePct = opts.wastePct;
  opts.item.takeoffKind = 'dim';
  opts.item.bbsBars = undefined;
  opts.item.bbsTotalKg = undefined;
  const q = itemQuantity(opts.item.unit, lines, opts.wastePct);
  opts.item.quantity = clampQty(q.total);
  opts.item.takeoffLineCount = lines.length;
  opts.item.quantityMode = 'TAKEOFF';
  await opts.item.save();

  if (prevSetId && prevSetId.toString() !== set._id.toString()) {
    await deleteSetIfOrphan(opts.projectId, prevSetId, opts.item._id);
  }

  const updatedIds = await recalcItemsOnSet(opts.projectId, set._id, lines);
  if (!updatedIds.includes(opts.item._id.toString())) {
    updatedIds.push(opts.item._id.toString());
  }
  return { updatedIds };
}

export async function applyBbsTakeoff(opts: {
  projectId: Types.ObjectId;
  item: ISelectedBoqItem;
  wastePct: number;
  bars: unknown;
}): Promise<{ updatedIds: string[] }> {
  const bars = sanitizeBars(opts.bars);
  const prevSetId = opts.item.measurementSetId || null;
  const q = bbsQuantity(opts.item.unit, bars, opts.wastePct);

  opts.item.wastePct = opts.wastePct;
  opts.item.takeoffKind = 'bbs';
  opts.item.measurementSetId = null;
  opts.item.bbsBars = bars;
  opts.item.bbsTotalKg = q.totalKg;
  opts.item.quantity = clampQty(q.total);
  opts.item.takeoffLineCount = bars.length;
  opts.item.quantityMode = 'TAKEOFF';
  await opts.item.save();

  await deleteSetIfOrphan(opts.projectId, prevSetId, opts.item._id);
  return { updatedIds: [opts.item._id.toString()] };
}

export async function cleanupItemMeasurementSet(item: ISelectedBoqItem) {
  await deleteSetIfOrphan(item.projectId, item.measurementSetId, item._id);
}

/**
 * Refresh linked PDF values before reports are built, so changes made on the
 * drawing flow through to BOQ quantities without re-entering the takeoff.
 */
export async function syncPdfLinkedTakeoffs(
  projectId: Types.ObjectId,
  floorId?: string | null,
): Promise<number> {
  const filter: Record<string, unknown> = {
    projectId,
    'lines.pdfTakeoffItemId': { $exists: true },
  };
  if (floorId) filter.floorId = floorId;
  const sets = await BoqMeasurementSet.find(filter);
  let updated = 0;
  for (const set of sets) {
    const before = sanitizeLines(set.lines);
    const after = await refreshPdfLines(projectId, before);
    if (JSON.stringify(after) === JSON.stringify(before)) continue;
    set.lines = after;
    await set.save();
    await recalcItemsOnSet(projectId, set._id, after);
    updated++;
  }
  return updated;
}

import { Types } from 'mongoose';
import { BoqMeasurementSet } from '../../models/BoqMeasurementSet';
import {
  SelectedBoqItem,
  type ISelectedBoqItem,
} from '../../models/SelectedBoqItem';
import { bbsQuantity, sanitizeBars, type BbsBar } from './bbs';
import {
  clampQty,
  itemQuantity,
  sanitizeLines,
  takeoffKindFor,
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
  wastePct: number;
  measurementSetId: string | null;
  linked: boolean;
  lines: TakeoffLine[];
  bars: BbsBar[];
  sharedBy: TakeoffSharedBy[];
  linkTargets: TakeoffLinkTarget[];
};

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

  return {
    kind,
    unit: item.unit,
    ref: item.catalogueRef,
    description: item.description,
    elementKey: item.elementKey,
    wastePct: Number(item.wastePct) || 0,
    measurementSetId: setId ? setId.toString() : null,
    linked: sharedBy.length > 0,
    lines,
    bars: sanitizeBars(item.bbsBars),
    sharedBy,
    linkTargets,
  };
}

export async function applyDimTakeoff(opts: {
  projectId: Types.ObjectId;
  item: ISelectedBoqItem;
  wastePct: number;
  lines: unknown;
  measurementSetId?: string | null;
}): Promise<{ updatedIds: string[] }> {
  const lines = sanitizeLines(opts.lines);
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
  await opts.item.save();

  await deleteSetIfOrphan(opts.projectId, prevSetId, opts.item._id);
  return { updatedIds: [opts.item._id.toString()] };
}

export async function cleanupItemMeasurementSet(item: ISelectedBoqItem) {
  await deleteSetIfOrphan(item.projectId, item.measurementSetId, item._id);
}

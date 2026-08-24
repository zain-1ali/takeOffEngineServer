import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import {
  TAKEOFF_SOURCES,
  TAKEOFF_TYPES,
  TakeoffItemModel,
  type TakeoffPoint,
  type TakeoffSource,
  type TakeoffType,
} from '../models/TakeoffItem';
import { mapTakeoffItem } from '../utils/mapTakeoffItem';
import { findOwnedSheet } from '../utils/sheetOwnership';
import {
  areaUnitLabel,
  polygonAreaPx2,
  polylineLengthPx,
  toRealArea,
  toRealLength,
} from '../utils/measurementMath';
import type { BlueprintSheetDocument } from '../models/BlueprintSheet';
import { LayerModel } from '../models/Layer';
import { resolveLayerIdForProject } from '../utils/resolveLayerId';
import { UNASSIGNED_ITEM_COLOR } from '../utils/itemLayerColor';

const takeoffItemsRouter = Router({ mergeParams: true });

interface SheetParams {
  sheetId: string;
}

const DEFAULT_COLORS: Record<TakeoffType, string> = {
  LINEAR: '#3b82f6',
  AREA: '#22c55e',
  COUNT: '#e29a12',
};

function isTakeoffType(value: unknown): value is TakeoffType {
  return (
    typeof value === 'string' &&
    (TAKEOFF_TYPES as readonly string[]).includes(value)
  );
}

function parsePoints(raw: unknown): TakeoffPoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const points: TakeoffPoint[] = [];
  for (const entry of raw) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as TakeoffPoint).x !== 'number' ||
      typeof (entry as TakeoffPoint).y !== 'number' ||
      !Number.isFinite((entry as TakeoffPoint).x) ||
      !Number.isFinite((entry as TakeoffPoint).y)
    ) {
      return null;
    }
    points.push({
      x: (entry as TakeoffPoint).x,
      y: (entry as TakeoffPoint).y,
    });
  }
  return points;
}

/** Conditions are not in this step — only null is accepted. */
function parseOptionalConditionId(
  raw: unknown,
): { ok: true; value: Types.ObjectId | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
  if (typeof raw === 'string' && Types.ObjectId.isValid(raw)) {
    return {
      ok: false,
      error: 'conditionId assignment is not available yet',
    };
  }
  return { ok: false, error: 'conditionId must be a string id or null' };
}

async function storedColorForLayer(
  projectId: Types.ObjectId | string,
  layerId: Types.ObjectId | null,
  fallback: string,
): Promise<string> {
  if (!layerId) return UNASSIGNED_ITEM_COLOR;
  const layer = await LayerModel.findOne({
    _id: layerId,
    projectId,
  })
    .select('color')
    .exec();
  return (
    (typeof layer?.color === 'string' && layer.color.trim()) || fallback
  );
}

async function loadOwnedSheet(
  req: Request,
  res: Response,
): Promise<BlueprintSheetDocument | null> {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const { sheetId } = req.params as unknown as SheetParams;
  if (!Types.ObjectId.isValid(sheetId)) {
    res.status(400).json({ error: 'Invalid sheetId' });
    return null;
  }
  const sheet = await findOwnedSheet(sheetId, userId);
  if (!sheet) {
    res.status(404).json({ error: 'Sheet not found' });
    return null;
  }
  return sheet;
}

/** GET /api/sheets/:sheetId/takeoff-items */
takeoffItemsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const sheet = await loadOwnedSheet(req, res);
  if (!sheet) return;

  try {
    const docs = await TakeoffItemModel.find({ sheetId: sheet._id })
      .sort({ createdAt: 1 })
      .exec();
    res.status(200).json({ items: docs.map(mapTakeoffItem) });
  } catch (error: unknown) {
    console.error('List takeoff items failed:', error);
    res.status(500).json({ error: 'Failed to list takeoff items' });
  }
});

/** POST /api/sheets/:sheetId/takeoff-items */
takeoffItemsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const sheet = await loadOwnedSheet(req, res);
  if (!sheet) return;

  const type = req.body?.type;
  const points = parsePoints(req.body?.points);
  const label =
    typeof req.body?.label === 'string' && req.body.label.trim()
      ? req.body.label.trim()
      : null;
  if (!isTakeoffType(type)) {
    res.status(400).json({ error: 'type must be LINEAR, AREA, or COUNT' });
    return;
  }

  if (!points) {
    res.status(400).json({
      error: 'points must be a non-empty array of {x,y} numbers',
    });
    return;
  }

  const conditionParsed = parseOptionalConditionId(req.body?.conditionId);
  if (!conditionParsed.ok) {
    res.status(400).json({ error: conditionParsed.error });
    return;
  }

  try {
    let calculatedValue: number;
    let unit: string;

    if (type === 'COUNT') {
      calculatedValue = points.length;
      unit = 'ea';
    } else {
      const scale = sheet.calibrationScale;
      const calibrationUnit = sheet.calibrationUnit;

      if (scale == null || !(scale > 0) || !calibrationUnit) {
        res.status(400).json({
          error: 'Sheet must be calibrated before LINEAR/AREA measurements',
        });
        return;
      }

      if (type === 'LINEAR') {
        if (points.length < 2) {
          res.status(400).json({ error: 'LINEAR requires at least 2 points' });
          return;
        }
        calculatedValue = toRealLength(polylineLengthPx(points), scale);
        unit = calibrationUnit;
      } else {
        if (points.length < 3) {
          res.status(400).json({ error: 'AREA requires at least 3 points' });
          return;
        }
        calculatedValue = toRealArea(polygonAreaPx2(points), scale);
        unit = areaUnitLabel(calibrationUnit);
      }
    }

    if (!Number.isFinite(calculatedValue)) {
      res.status(400).json({ error: 'calculatedValue is not finite' });
      return;
    }

    let layerId: Types.ObjectId | null = null;
    if (req.body?.layerId !== undefined) {
      const resolved = await resolveLayerIdForProject(
        sheet.projectId.toString(),
        req.body.layerId,
      );
      if (!resolved.ok) {
        res.status(400).json({ error: resolved.error });
        return;
      }
      layerId = resolved.layerId;
    }

    const storedColor = await storedColorForLayer(
      sheet.projectId,
      layerId,
      DEFAULT_COLORS[type],
    );

    const doc = await TakeoffItemModel.create({
      sheetId: sheet._id,
      type,
      points,
      calculatedValue,
      perimeter: null,
      unit,
      label,
      color: storedColor,
      source: 'MANUAL',
      layerId,
      conditionId: conditionParsed.value,
    });

    res.status(201).json({ item: mapTakeoffItem(doc) });
  } catch (error: unknown) {
    console.error('Create takeoff item failed:', error);
    res.status(500).json({ error: 'Failed to create takeoff item' });
  }
});

/** PATCH /api/sheets/:sheetId/takeoff-items/:itemId — label / points / source */
takeoffItemsRouter.patch(
  '/:itemId',
  async (req: Request, res: Response): Promise<void> => {
    const sheet = await loadOwnedSheet(req, res);
    if (!sheet) return;

    const itemId = Array.isArray(req.params.itemId)
      ? req.params.itemId[0]
      : req.params.itemId;
    if (!itemId || !Types.ObjectId.isValid(itemId)) {
      res.status(400).json({ error: 'Invalid sheetId or itemId' });
      return;
    }

    try {
      const item = await TakeoffItemModel.findOne({
        _id: itemId,
        sheetId: sheet._id,
      }).exec();

      if (!item) {
        res.status(404).json({ error: 'Takeoff item not found' });
        return;
      }

      if (req.body?.label !== undefined) {
        item.label =
          typeof req.body.label === 'string' && req.body.label.trim()
            ? req.body.label.trim()
            : null;
      }

      if (req.body?.layerId !== undefined) {
        const resolved = await resolveLayerIdForProject(
          sheet.projectId.toString(),
          req.body.layerId,
        );
        if (!resolved.ok) {
          res.status(400).json({ error: resolved.error });
          return;
        }
        item.layerId = resolved.layerId;
      }

      if (req.body?.conditionId !== undefined) {
        const resolved = parseOptionalConditionId(req.body.conditionId);
        if (!resolved.ok) {
          res.status(400).json({ error: resolved.error });
          return;
        }
        item.conditionId = resolved.value;
      }

      if (req.body?.points !== undefined) {
        const points = parsePoints(req.body.points);
        if (!points || points.length < 3) {
          res.status(400).json({
            error: 'points must be an array of at least 3 {x,y} numbers',
          });
          return;
        }
        item.set('points', points);
      }

      if (req.body?.source !== undefined) {
        const source = req.body.source;
        if (
          typeof source !== 'string' ||
          !(TAKEOFF_SOURCES as readonly string[]).includes(source)
        ) {
          res.status(400).json({
            error: `source must be one of: ${TAKEOFF_SOURCES.join(', ')}`,
          });
          return;
        }
        item.source = source as TakeoffSource;
      }

      await item.save();
      res.status(200).json({ item: mapTakeoffItem(item) });
    } catch (error: unknown) {
      console.error('Update takeoff item failed:', error);
      res.status(500).json({ error: 'Failed to update takeoff item' });
    }
  },
);

/** DELETE /api/sheets/:sheetId/takeoff-items/:itemId */
takeoffItemsRouter.delete(
  '/:itemId',
  async (req: Request, res: Response): Promise<void> => {
    const sheet = await loadOwnedSheet(req, res);
    if (!sheet) return;

    const itemId = Array.isArray(req.params.itemId)
      ? req.params.itemId[0]
      : req.params.itemId;
    if (!itemId || !Types.ObjectId.isValid(itemId)) {
      res.status(400).json({ error: 'Invalid sheetId or itemId' });
      return;
    }

    try {
      const deleted = await TakeoffItemModel.findOneAndDelete({
        _id: itemId,
        sheetId: sheet._id,
      }).exec();

      if (!deleted) {
        res.status(404).json({ error: 'Takeoff item not found' });
        return;
      }

      res.status(200).json({ item: mapTakeoffItem(deleted) });
    } catch (error: unknown) {
      console.error('Delete takeoff item failed:', error);
      res.status(500).json({ error: 'Failed to delete takeoff item' });
    }
  },
);

export default takeoffItemsRouter;

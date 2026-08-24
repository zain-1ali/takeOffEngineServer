import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import {
  MARKUP_TYPES,
  MarkupObjectModel,
  type MarkupData,
  type MarkupType,
} from '../models/MarkupObject';
import { mapMarkupObject } from '../utils/mapMarkupObject';
import { findOwnedSheet } from '../utils/sheetOwnership';
import type { BlueprintSheetDocument } from '../models/BlueprintSheet';
import { LayerModel } from '../models/Layer';
import { resolveLayerIdForProject } from '../utils/resolveLayerId';
import { UNASSIGNED_ITEM_COLOR } from '../utils/itemLayerColor';

const markupObjectsRouter = Router({ mergeParams: true });

interface SheetParams {
  sheetId: string;
}

function isMarkupType(value: unknown): value is MarkupType {
  return (
    typeof value === 'string' &&
    (MARKUP_TYPES as readonly string[]).includes(value)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function storedColorForLayer(
  projectId: Types.ObjectId | string,
  layerId: Types.ObjectId | null,
): Promise<string> {
  if (!layerId) return UNASSIGNED_ITEM_COLOR;
  const layer = await LayerModel.findOne({
    _id: layerId,
    projectId,
  })
    .select('color')
    .exec();
  return (
    (typeof layer?.color === 'string' && layer.color.trim()) ||
    UNASSIGNED_ITEM_COLOR
  );
}

function paramId(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * Validate geometry only — markup never computes length/area/count.
 */
function validateMarkupPayload(
  type: MarkupType,
  data: unknown,
  textContent: unknown,
):
  | { ok: true; data: MarkupData; textContent: string | null }
  | { ok: false; error: string } {
  if (!isPlainObject(data)) {
    return { ok: false, error: 'data must be a JSON object' };
  }

  const text =
    typeof textContent === 'string'
      ? textContent
      : textContent == null
        ? null
        : null;

  if (type === 'TEXT') {
    if (typeof data.x !== 'number' || typeof data.y !== 'number') {
      return { ok: false, error: 'TEXT data requires numeric x, y' };
    }
    if (text == null || !text.trim()) {
      return { ok: false, error: 'TEXT requires non-empty textContent' };
    }
    return {
      ok: true,
      data: { x: data.x, y: data.y },
      textContent: text.trim(),
    };
  }

  if (type === 'FREEHAND') {
    if (!Array.isArray(data.points) || data.points.length < 2) {
      return {
        ok: false,
        error: 'FREEHAND data.points requires at least 2 points',
      };
    }
    return { ok: true, data: { points: data.points }, textContent: null };
  }

  if (type === 'POLYGON') {
    if (!Array.isArray(data.points) || data.points.length < 3) {
      return {
        ok: false,
        error: 'POLYGON data.points requires at least 3 points',
      };
    }
    for (const point of data.points) {
      if (
        typeof point !== 'object' ||
        point === null ||
        typeof (point as { x?: unknown }).x !== 'number' ||
        typeof (point as { y?: unknown }).y !== 'number'
      ) {
        return { ok: false, error: 'POLYGON points must be {x,y} numbers' };
      }
    }
    return { ok: true, data: { points: data.points }, textContent: null };
  }

  if (type === 'LINE') {
    const { x1, y1, x2, y2 } = data;
    if (
      [x1, y1, x2, y2].some((v) => typeof v !== 'number' || !Number.isFinite(v))
    ) {
      return { ok: false, error: 'LINE data requires numeric x1,y1,x2,y2' };
    }
    return { ok: true, data: { x1, y1, x2, y2 }, textContent: null };
  }

  if (type === 'RECTANGLE') {
    const { x, y, width, height } = data;
    if (
      [x, y, width, height].some(
        (v) => typeof v !== 'number' || !Number.isFinite(v),
      )
    ) {
      return {
        ok: false,
        error: 'RECTANGLE data requires numeric x,y,width,height',
      };
    }
    return { ok: true, data: { x, y, width, height }, textContent: null };
  }

  if (type === 'ELLIPSE') {
    const { cx, cy, radiusX, radiusY } = data;
    if (
      [cx, cy, radiusX, radiusY].some(
        (v) => typeof v !== 'number' || !Number.isFinite(v),
      )
    ) {
      return {
        ok: false,
        error: 'ELLIPSE data requires numeric cx,cy,radiusX,radiusY',
      };
    }
    return { ok: true, data: { cx, cy, radiusX, radiusY }, textContent: null };
  }

  return { ok: false, error: 'Unsupported markup type' };
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

/** GET /api/sheets/:sheetId/markups */
markupObjectsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const sheet = await loadOwnedSheet(req, res);
  if (!sheet) return;

  try {
    const docs = await MarkupObjectModel.find({ sheetId: sheet._id })
      .sort({ createdAt: 1 })
      .exec();
    res.status(200).json({ markups: docs.map(mapMarkupObject) });
  } catch (error: unknown) {
    console.error('List markups failed:', error);
    res.status(500).json({ error: 'Failed to list markups' });
  }
});

/** POST /api/sheets/:sheetId/markups */
markupObjectsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const sheet = await loadOwnedSheet(req, res);
  if (!sheet) return;

  const type = req.body?.type;
  if (!isMarkupType(type)) {
    res.status(400).json({
      error:
        'type must be FREEHAND, LINE, RECTANGLE, ELLIPSE, POLYGON, or TEXT',
    });
    return;
  }

  const strokeWidth = Number(req.body?.strokeWidth);
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) {
    res.status(400).json({ error: 'strokeWidth must be a positive number' });
    return;
  }

  const validated = validateMarkupPayload(
    type,
    req.body?.data,
    req.body?.textContent,
  );
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  try {
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

    const storedColor = await storedColorForLayer(sheet.projectId, layerId);

    const doc = await MarkupObjectModel.create({
      sheetId: sheet._id,
      type,
      data: validated.data,
      color: storedColor,
      strokeWidth,
      textContent: validated.textContent,
      layerId,
    });

    res.status(201).json({ markup: mapMarkupObject(doc) });
  } catch (error: unknown) {
    console.error('Create markup failed:', error);
    res.status(500).json({ error: 'Failed to create markup' });
  }
});

/** PATCH /api/sheets/:sheetId/markups/:markupId */
markupObjectsRouter.patch(
  '/:markupId',
  async (req: Request, res: Response): Promise<void> => {
    const sheet = await loadOwnedSheet(req, res);
    if (!sheet) return;

    const markupId = paramId(req.params.markupId);
    if (!markupId || !Types.ObjectId.isValid(markupId)) {
      res.status(400).json({ error: 'Invalid sheetId or markupId' });
      return;
    }

    try {
      const existing = await MarkupObjectModel.findOne({
        _id: markupId,
        sheetId: sheet._id,
      }).exec();

      if (!existing) {
        res.status(404).json({ error: 'Markup not found' });
        return;
      }

      const nextType = isMarkupType(req.body?.type)
        ? req.body.type
        : (existing.type as MarkupType);

      const nextColor =
        typeof req.body?.color === 'string' && req.body.color.trim()
          ? req.body.color.trim()
          : existing.color;

      const nextStroke =
        req.body?.strokeWidth !== undefined
          ? Number(req.body.strokeWidth)
          : existing.strokeWidth;

      if (!Number.isFinite(nextStroke) || nextStroke <= 0) {
        res.status(400).json({ error: 'strokeWidth must be a positive number' });
        return;
      }

      const nextData =
        req.body?.data !== undefined ? req.body.data : existing.data;
      const nextText =
        req.body?.textContent !== undefined
          ? req.body.textContent
          : existing.textContent;

      const validated = validateMarkupPayload(nextType, nextData, nextText);
      if (!validated.ok) {
        res.status(400).json({ error: validated.error });
        return;
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
        existing.layerId = resolved.layerId;
      }

      existing.type = nextType;
      existing.data = validated.data;
      existing.color = nextColor;
      existing.strokeWidth = nextStroke;
      existing.textContent = validated.textContent;
      await existing.save();

      res.status(200).json({ markup: mapMarkupObject(existing) });
    } catch (error: unknown) {
      console.error('Update markup failed:', error);
      res.status(500).json({ error: 'Failed to update markup' });
    }
  },
);

/** DELETE /api/sheets/:sheetId/markups/:markupId */
markupObjectsRouter.delete(
  '/:markupId',
  async (req: Request, res: Response): Promise<void> => {
    const sheet = await loadOwnedSheet(req, res);
    if (!sheet) return;

    const markupId = paramId(req.params.markupId);
    if (!markupId || !Types.ObjectId.isValid(markupId)) {
      res.status(400).json({ error: 'Invalid sheetId or markupId' });
      return;
    }

    try {
      const deleted = await MarkupObjectModel.findOneAndDelete({
        _id: markupId,
        sheetId: sheet._id,
      }).exec();

      if (!deleted) {
        res.status(404).json({ error: 'Markup not found' });
        return;
      }

      res.status(200).json({ markup: mapMarkupObject(deleted) });
    } catch (error: unknown) {
      console.error('Delete markup failed:', error);
      res.status(500).json({ error: 'Failed to delete markup' });
    }
  },
);

export default markupObjectsRouter;

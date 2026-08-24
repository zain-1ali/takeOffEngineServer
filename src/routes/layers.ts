import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { LayerModel } from '../models/Layer';
import { TakeoffItemModel } from '../models/TakeoffItem';
import { MarkupObjectModel } from '../models/MarkupObject';
import { mapLayer } from '../utils/mapLayer';
import { ensureDefaultProjectLayer } from '../utils/defaultProjectLayer';

const layersRouter = Router({ mergeParams: true });

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function paramId(
  raw: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function parseRequiredHex(value: unknown): string | null {
  if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) {
    return null;
  }
  return value.trim();
}

function projectIdOf(req: Request): string | undefined {
  if (req.project) return req.project._id.toString();
  return paramId(req.params.projectId);
}

/** GET /api/projects/:projectId/layers */
layersRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const projectId = projectIdOf(req);
  if (!projectId || !Types.ObjectId.isValid(projectId)) {
    res.status(400).json({ error: 'Invalid projectId' });
    return;
  }

  try {
    await ensureDefaultProjectLayer(projectId);

    const docs = await LayerModel.find({ projectId })
      .sort({ sortOrder: 1, createdAt: 1 })
      .exec();

    res.status(200).json({ layers: docs.map(mapLayer) });
  } catch (error: unknown) {
    console.error('List layers failed:', error);
    res.status(500).json({ error: 'Failed to list layers' });
  }
});

/** POST /api/projects/:projectId/layers */
layersRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const projectId = projectIdOf(req);
  if (!projectId || !Types.ObjectId.isValid(projectId)) {
    res.status(400).json({ error: 'Invalid projectId' });
    return;
  }

  const name =
    typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim()
      : null;

  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const color = parseRequiredHex(req.body?.color);
  if (!color) {
    res.status(400).json({ error: 'color is required (hex like #RRGGBB)' });
    return;
  }

  try {
    const highest = await LayerModel.findOne({ projectId })
      .sort({ sortOrder: -1 })
      .select('sortOrder')
      .exec();
    const nextOrder = (highest?.sortOrder ?? -1) + 1;

    const doc = await LayerModel.create({
      projectId: new Types.ObjectId(projectId),
      name,
      color,
      visible: true,
      sortOrder: nextOrder,
    });

    res.status(201).json({ layer: mapLayer(doc) });
  } catch (error: unknown) {
    console.error('Create layer failed:', error);
    res.status(500).json({ error: 'Failed to create layer' });
  }
});

/** PATCH /api/projects/:projectId/layers/:layerId — rename / recolor / reorder / visibility */
layersRouter.patch(
  '/:layerId',
  async (req: Request, res: Response): Promise<void> => {
    const projectId = projectIdOf(req);
    const layerId = paramId(req.params.layerId);

    if (
      !projectId ||
      !layerId ||
      !Types.ObjectId.isValid(projectId) ||
      !Types.ObjectId.isValid(layerId)
    ) {
      res.status(400).json({ error: 'Invalid projectId or layerId' });
      return;
    }

    try {
      const layer = await LayerModel.findOne({
        _id: layerId,
        projectId,
      }).exec();

      if (!layer) {
        res.status(404).json({ error: 'Layer not found' });
        return;
      }

      if (req.body?.name !== undefined) {
        if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
          res.status(400).json({ error: 'name must be a non-empty string' });
          return;
        }
        layer.name = req.body.name.trim();
      }

      if (req.body?.color !== undefined) {
        const nextColor = parseRequiredHex(req.body.color);
        if (!nextColor) {
          res
            .status(400)
            .json({ error: 'color must be a hex string like #RRGGBB' });
          return;
        }
        layer.color = nextColor;
      }

      if (req.body?.visible !== undefined) {
        if (typeof req.body.visible !== 'boolean') {
          res.status(400).json({ error: 'visible must be a boolean' });
          return;
        }
        layer.visible = req.body.visible;
      }

      if (req.body?.sortOrder !== undefined) {
        const sortOrder = Number(req.body.sortOrder);
        if (!Number.isFinite(sortOrder) || !Number.isInteger(sortOrder)) {
          res.status(400).json({ error: 'sortOrder must be an integer' });
          return;
        }
        layer.sortOrder = sortOrder;
      }

      await layer.save();
      res.status(200).json({ layer: mapLayer(layer) });
    } catch (error: unknown) {
      console.error('Update layer failed:', error);
      res.status(500).json({ error: 'Failed to update layer' });
    }
  },
);

/** DELETE /api/projects/:projectId/layers/:layerId — items fall back to Uncategorized */
layersRouter.delete(
  '/:layerId',
  async (req: Request, res: Response): Promise<void> => {
    const projectId = projectIdOf(req);
    const layerId = paramId(req.params.layerId);

    if (
      !projectId ||
      !layerId ||
      !Types.ObjectId.isValid(projectId) ||
      !Types.ObjectId.isValid(layerId)
    ) {
      res.status(400).json({ error: 'Invalid projectId or layerId' });
      return;
    }

    try {
      const deleted = await LayerModel.findOneAndDelete({
        _id: layerId,
        projectId,
      }).exec();

      if (!deleted) {
        res.status(404).json({ error: 'Layer not found' });
        return;
      }

      await Promise.all([
        TakeoffItemModel.updateMany(
          { layerId },
          { $set: { layerId: null } },
        ).exec(),
        MarkupObjectModel.updateMany(
          { layerId },
          { $set: { layerId: null } },
        ).exec(),
      ]);

      res.status(200).json({ layer: mapLayer(deleted) });
    } catch (error: unknown) {
      console.error('Delete layer failed:', error);
      res.status(500).json({ error: 'Failed to delete layer' });
    }
  },
);

export default layersRouter;

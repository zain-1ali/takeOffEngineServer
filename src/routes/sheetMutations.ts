import { Router, type Request, type Response, type NextFunction } from 'express';
import { Types } from 'mongoose';
import { BlueprintSheet } from '../models/BlueprintSheet';
import { mapSheet } from '../utils/mapSheet';
import { findOwnedSheet, userOwnsProject } from '../utils/sheetOwnership';

const ALLOWED_UNITS = new Set(['ft', 'm', 'in']);

const sheetMutationsRouter = Router();

async function loadOwnedSheetParam(
  req: Request,
  res: Response,
  next: NextFunction,
  sheetId: string,
): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!Types.ObjectId.isValid(sheetId)) {
    res.status(400).json({ error: 'Invalid sheetId' });
    return;
  }
  const sheet = await findOwnedSheet(sheetId, userId);
  if (!sheet) {
    res.status(404).json({ error: 'Sheet not found' });
    return;
  }
  next();
}

sheetMutationsRouter.param('sheetId', (req, res, next, sheetId) => {
  void loadOwnedSheetParam(req, res, next, sheetId);
});

/**
 * PATCH /api/sheets/reorder
 * Body: { projectId, orderedIds: string[] }
 */
sheetMutationsRouter.patch(
  '/reorder',
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const projectId = req.body?.projectId;
    const orderedIds = req.body?.orderedIds;

    if (typeof projectId !== 'string' || !Types.ObjectId.isValid(projectId)) {
      res.status(400).json({ error: 'Valid projectId is required' });
      return;
    }

    const owned = await userOwnsProject(projectId, userId);
    if (!owned) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (
      !Array.isArray(orderedIds) ||
      orderedIds.length === 0 ||
      orderedIds.some(
        (id) => typeof id !== 'string' || !Types.ObjectId.isValid(id),
      )
    ) {
      res.status(400).json({
        error: 'orderedIds must be a non-empty array of sheet ids',
      });
      return;
    }

    try {
      const sheets = await BlueprintSheet.find({
        projectId,
        _id: { $in: orderedIds },
      }).exec();

      if (sheets.length !== orderedIds.length) {
        res.status(400).json({
          error: 'orderedIds must include only sheets from this project',
        });
        return;
      }

      const orderIndex = new Map(
        orderedIds.map((id: string, index: number) => [id, index]),
      );

      await Promise.all(
        sheets.map(async (sheet) => {
          sheet.sortOrder =
            orderIndex.get(sheet._id.toString()) ?? sheet.sortOrder;
          await sheet.save();
        }),
      );

      const updated = await BlueprintSheet.find({ projectId })
        .sort({ sortOrder: 1, pageNumber: 1 })
        .exec();

      res.status(200).json({ sheets: updated.map(mapSheet) });
    } catch (error: unknown) {
      console.error('Reorder sheets failed:', error);
      res.status(500).json({ error: 'Failed to reorder sheets' });
    }
  },
);

/** PATCH /api/sheets/:sheetId/calibration */
sheetMutationsRouter.patch(
  '/:sheetId/calibration',
  async (req: Request, res: Response): Promise<void> => {
    const { sheetId } = req.params;
    const rawScale = req.body?.calibrationScale;
    const rawUnit = req.body?.calibrationUnit;

    const calibrationScale =
      typeof rawScale === 'number'
        ? rawScale
        : typeof rawScale === 'string'
          ? Number(rawScale)
          : NaN;

    const calibrationUnit =
      typeof rawUnit === 'string' ? rawUnit.trim().toLowerCase() : '';

    if (!Number.isFinite(calibrationScale) || calibrationScale <= 0) {
      res.status(400).json({
        error: 'calibrationScale must be a positive finite number',
      });
      return;
    }

    if (!ALLOWED_UNITS.has(calibrationUnit)) {
      res.status(400).json({
        error: 'calibrationUnit must be one of: "ft", "m", "in"',
      });
      return;
    }

    try {
      const doc = await BlueprintSheet.findByIdAndUpdate(
        sheetId,
        { $set: { calibrationScale, calibrationUnit } },
        { new: true },
      ).exec();

      if (!doc) {
        res.status(404).json({ error: 'Sheet not found' });
        return;
      }

      res.status(200).json({ sheet: mapSheet(doc) });
    } catch (error: unknown) {
      console.error('Update calibration failed:', error);
      res.status(500).json({ error: 'Failed to update calibration' });
    }
  },
);

/** PATCH /api/sheets/:sheetId */
sheetMutationsRouter.patch(
  '/:sheetId',
  async (req: Request, res: Response): Promise<void> => {
    const { sheetId } = req.params;
    try {
      const sheet = await BlueprintSheet.findById(sheetId).exec();
      if (!sheet) {
        res.status(404).json({ error: 'Sheet not found' });
        return;
      }

      if (req.body?.name !== undefined) {
        if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
          res.status(400).json({ error: 'name must be a non-empty string' });
          return;
        }
        sheet.name = req.body.name.trim();
      }

      if (req.body?.discipline !== undefined) {
        if (
          typeof req.body.discipline !== 'string' ||
          !req.body.discipline.trim()
        ) {
          res
            .status(400)
            .json({ error: 'discipline must be a non-empty string' });
          return;
        }
        sheet.discipline = req.body.discipline.trim();
      }

      if (req.body?.sortOrder !== undefined) {
        const sortOrder = Number(req.body.sortOrder);
        if (!Number.isFinite(sortOrder) || !Number.isInteger(sortOrder)) {
          res.status(400).json({ error: 'sortOrder must be an integer' });
          return;
        }
        sheet.sortOrder = sortOrder;
      }

      await sheet.save();
      res.status(200).json({ sheet: mapSheet(sheet) });
    } catch (error: unknown) {
      console.error('Update sheet failed:', error);
      res.status(500).json({ error: 'Failed to update sheet' });
    }
  },
);

export default sheetMutationsRouter;

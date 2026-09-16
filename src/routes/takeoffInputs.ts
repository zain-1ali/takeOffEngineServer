import { Router, Request, Response, NextFunction } from 'express';
import { loadOwnedProject } from '../middleware/loadOwnedProject';
import {
  TakeoffInputSet,
  type TakeoffLineInput,
} from '../models/TakeoffInputSet';
import { SelectedBoqItem } from '../models/SelectedBoqItem';
import { selectedBoqQueryFilter } from '../services/selectedBoq';
import { loadActivePackReportContext } from '../services/boqPack/packReportContext';
import { PROJECT_SCOPE_FLOOR_ID } from '../services/boqPack/scope';
import { visibleSchemaForLines } from '../services/takeoffInputs';

const router = Router({ mergeParams: true });

const scope = (req: Request) => ({
  floorId: String(req.query.floorId ?? '').trim(),
  elementKey: String(req.query.elementKey ?? '').trim(),
});

const publicSet = (doc: any, floorId: string, elementKey: string) => ({
  id: doc?._id?.toString?.() || null,
  projectId: doc?.projectId?.toString?.() || '',
  floorId,
  elementKey,
  shared: doc?.shared || {},
  lineInputs: doc?.lineInputs || {},
  updatedAt: doc?.updatedAt?.toISOString?.() || '',
});

router.get(
  '/schema',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { floorId, elementKey } = scope(req);
      if (!floorId || !elementKey) {
        res.status(400).json({ error: 'floorId and elementKey are required' });
        return;
      }
      const packCtx = await loadActivePackReportContext(req.project!._id);
      const engineKey =
        (packCtx?.elementMeta?.[elementKey]?.engineKey || '').trim() || undefined;
      const persistFloorId =
        packCtx?.elementMeta?.[elementKey]?.scope === 'PROJECT'
          ? PROJECT_SCOPE_FLOOR_ID
          : floorId;
      const selected = await SelectedBoqItem.find(
        selectedBoqQueryFilter({
          projectId: req.project!._id,
          floorId: persistFloorId === PROJECT_SCOPE_FLOOR_ID ? floorId : persistFloorId,
          elementKey,
        }),
      ).sort({ catalogueRef: 1 });
      const lines = selected
        .filter(
          (item) =>
            item.elementKey === elementKey &&
            (item.floorId === persistFloorId ||
              item.floorId === floorId ||
              item.floorId === PROJECT_SCOPE_FLOOR_ID),
        )
        .map((item) => ({
          lineKey: item.lineKey || '',
          catalogueRef: item.catalogueRef,
          description: item.description,
          unit: item.unit,
          quantityBasis: item.quantityBasis,
          workCategory: item.workCategory,
        }));
      const visible = visibleSchemaForLines(elementKey, lines, engineKey);
      res.json({
        elementKey,
        engineKey: engineKey || elementKey,
        persistFloorId,
        fields: visible.fields,
        selectedCount: lines.length,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { floorId, elementKey } = scope(req);
      if (!floorId || !elementKey) {
        res.status(400).json({ error: 'floorId and elementKey are required' });
        return;
      }
      const doc = await TakeoffInputSet.findOne({
        projectId: req.project!._id,
        floorId,
        elementKey,
      });
      res.json({ inputSet: publicSet(doc, floorId, elementKey) });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { floorId, elementKey } = scope(req);
      if (!floorId || !elementKey) {
        res.status(400).json({ error: 'floorId and elementKey are required' });
        return;
      }
      const update: Record<string, unknown> = {};
      if (req.body?.shared && typeof req.body.shared === 'object') {
        update.shared = req.body.shared;
      }
      if (req.body?.lineInputs && typeof req.body.lineInputs === 'object') {
        update.lineInputs = req.body.lineInputs as Record<string, TakeoffLineInput>;
      }
      if (!Object.keys(update).length) {
        const existing = await TakeoffInputSet.findOne({
          projectId: req.project!._id,
          floorId,
          elementKey,
        });
        res.json({ inputSet: publicSet(existing, floorId, elementKey) });
        return;
      }
      const doc = await TakeoffInputSet.findOneAndUpdate(
        { projectId: req.project!._id, floorId, elementKey },
        { $set: update },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      res.json({ inputSet: publicSet(doc, floorId, elementKey) });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

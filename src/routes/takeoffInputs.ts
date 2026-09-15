import { Router, Request, Response, NextFunction } from 'express';
import { loadOwnedProject } from '../middleware/loadOwnedProject';
import {
  TakeoffInputSet,
  type TakeoffLineInput,
} from '../models/TakeoffInputSet';

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
      const shared =
        req.body?.shared && typeof req.body.shared === 'object'
          ? req.body.shared
          : {};
      const lineInputs =
        req.body?.lineInputs && typeof req.body.lineInputs === 'object'
          ? (req.body.lineInputs as Record<string, TakeoffLineInput>)
          : {};
      const doc = await TakeoffInputSet.findOneAndUpdate(
        { projectId: req.project!._id, floorId, elementKey },
        { $set: { shared, lineInputs } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      res.json({ inputSet: publicSet(doc, floorId, elementKey) });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

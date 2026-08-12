import { Router, Request, Response, NextFunction } from 'express';
import { loadOwnedProject } from '../middleware/loadOwnedProject';
import { ManualBoqItem } from '../models/ManualBoqItem';
import {
  publicManualBoqItem,
  resolveManualRateSnapshot,
  type ManualBoqInput,
} from '../services/manualBoq';
import type { RateLib } from '../engines/rateAnalysis';

const router = Router({ mergeParams: true });

function parseBody(body: any): ManualBoqInput {
  const linkKind = (body?.linkKind || 'none') as ManualBoqInput['linkKind'];
  const labourMode = (body?.labourMode || 'none') as ManualBoqInput['labourMode'];
  return {
    floorId:
      body?.floorId === undefined || body?.floorId === '' || body?.floorId === null
        ? null
        : String(body.floorId).trim(),
    description: String(body?.description ?? '').trim(),
    unit: String(body?.unit ?? 'nr').trim() || 'nr',
    quantity: Number(body?.quantity) || 0,
    linkKind,
    analysisCode:
      linkKind === 'analysis' && body?.analysisCode
        ? String(body.analysisCode).trim()
        : null,
    resourceGroup:
      linkKind === 'resource' && body?.resourceGroup
        ? body.resourceGroup
        : null,
    resourceCode:
      linkKind === 'resource' && body?.resourceCode
        ? String(body.resourceCode).trim()
        : null,
    labourMode,
    outputPerDay:
      labourMode === 'outputRate' && body?.outputPerDay != null
        ? Number(body.outputPerDay)
        : null,
    gangDescription:
      labourMode === 'outputRate' && body?.gangDescription
        ? String(body.gangDescription).trim()
        : null,
    uniformatCode:
      body?.uniformatCode != null && String(body.uniformatCode).trim() !== ''
        ? String(body.uniformatCode).trim().toUpperCase()
        : null,
    unitRate:
      body?.unitRate != null && body?.unitRate !== ''
        ? Number(body.unitRate)
        : null,
  };
}

router.get(
  '/',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter: Record<string, unknown> = { projectId: req.project!._id };
      if (req.query.floorId != null && String(req.query.floorId).trim() !== '') {
        const floorId = String(req.query.floorId).trim();
        // Floor scope: floor-specific + project-wide (null floorId)
        filter.$or = [{ floorId }, { floorId: null }];
      }
      const items = await ManualBoqItem.find(filter).sort({ createdAt: 1 });
      res.json({ items: items.map((d) => publicManualBoqItem(d as any)) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = parseBody(req.body);
      if (!input.description) {
        res.status(400).json({ error: 'description is required' });
        return;
      }
      const snap = resolveManualRateSnapshot(
        input,
        req.project!.rateLib as RateLib,
        req.project!.revision,
      );
      const { unitRate: _unitRate, ...fields } = input;
      const doc = await ManualBoqItem.create({
        projectId: req.project!._id,
        ...fields,
        ...snap,
      });
      res.status(201).json({ item: publicManualBoqItem(doc as any) });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/:itemId',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const item = await ManualBoqItem.findOne({
        _id: req.params.itemId,
        projectId: req.project!._id,
      });
      if (!item) {
        res.status(404).json({ error: 'Manual BOQ item not found' });
        return;
      }

      const input = parseBody({
        ...publicManualBoqItem(item as any),
        ...req.body,
      });
      if (!input.description) {
        res.status(400).json({ error: 'description is required' });
        return;
      }

      const prevLink = {
        linkKind: item.linkKind,
        analysisCode: item.analysisCode,
        resourceGroup: item.resourceGroup,
        resourceCode: item.resourceCode,
        labourMode: item.labourMode,
      };

      item.floorId = input.floorId ?? null;
      item.description = input.description;
      item.unit = input.unit;
      item.quantity = input.quantity;
      item.linkKind = input.linkKind || 'none';
      item.analysisCode = input.analysisCode ?? null;
      item.resourceGroup = input.resourceGroup ?? null;
      item.resourceCode = input.resourceCode ?? null;
      item.labourMode = input.labourMode || 'none';
      item.outputPerDay = input.outputPerDay ?? null;
      item.gangDescription = input.gangDescription ?? null;
      item.uniformatCode = input.uniformatCode ?? null;

      // Re-seed applied snapshot only when the link / labour path changes
      // (new selection). RateLib price edits wait for a revision bump.
      const linkChanged =
        prevLink.linkKind !== item.linkKind ||
        prevLink.analysisCode !== item.analysisCode ||
        prevLink.resourceGroup !== item.resourceGroup ||
        prevLink.resourceCode !== item.resourceCode ||
        prevLink.labourMode !== item.labourMode;

      if (linkChanged) {
        const snap = resolveManualRateSnapshot(
          input,
          req.project!.rateLib as RateLib,
          req.project!.revision,
        );
        item.appliedUnitRate = snap.appliedUnitRate;
        item.appliedBomUnitLines = snap.appliedBomUnitLines as any;
        item.appliedLabUnitLines = snap.appliedLabUnitLines as any;
        item.appliedAtRevision = snap.appliedAtRevision;
      } else if (
        (item.linkKind || 'none') === 'none' &&
        input.unitRate != null &&
        Number.isFinite(Number(input.unitRate))
      ) {
        // Direct lump-sum rate edit (no linked rate).
        item.appliedUnitRate = Number(input.unitRate);
        item.appliedAtRevision = String(req.project!.revision);
      }

      await item.save();
      res.json({ item: publicManualBoqItem(item as any) });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/:itemId',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await ManualBoqItem.deleteOne({
        _id: req.params.itemId,
        projectId: req.project!._id,
      });
      if (!result.deletedCount) {
        res.status(404).json({ error: 'Manual BOQ item not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

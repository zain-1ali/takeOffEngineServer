import { Router, Request, Response, NextFunction } from 'express';
import { loadOwnedProject } from '../middleware/loadOwnedProject';
import { SelectedBoqItem } from '../models/SelectedBoqItem';
import {
  catalogueItemsForElement,
  catalogueItemAppliesToFloor,
  findCatalogueItem,
  normalizeRef,
} from '../services/reports/boqCatalogue';
import { resolveFloorLevelTypes } from '../lib/levelCompatibility';
import { Floor } from '../models/Floor';
import { BlueprintSheet } from '../models/BlueprintSheet';
import { TakeoffItemModel } from '../models/TakeoffItem';
import { publicSelectedBoqItem } from '../services/selectedBoq';
import {
  applyBbsTakeoff,
  applyDimTakeoff,
  cleanupItemMeasurementSet,
  getTakeoffDetail,
} from '../services/boqTakeoff/applyTakeoff';
import { numOr, takeoffKindFor } from '../services/boqTakeoff/measurement';

const router = Router({ mergeParams: true });

/** GET / — catalogue rows for one element (optional floor filter). */
router.get(
  '/catalogue',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const elementKey = String(req.query.elementKey ?? '').trim();
      if (!elementKey) {
        res.status(400).json({ error: 'elementKey is required' });
        return;
      }
      let items = catalogueItemsForElement(elementKey);
      const floorId =
        req.query.floorId != null ? String(req.query.floorId).trim() : '';
      if (floorId) {
        const floor = await Floor.findOne({
          projectId: req.project!._id,
          floorId,
        });
        const levelTypes = resolveFloorLevelTypes({
          floorId,
          label: floor?.label,
          levelTypes: floor?.levelTypes,
        });
        items = items.filter((i) =>
          catalogueItemAppliesToFloor(i, levelTypes),
        );
      }
      res.json({
        elementKey,
        items: items.map((i) => ({
          ref: i.ref,
          elementKey: i.elementKey,
          elementLabel: i.elementLabel,
          description: i.description,
          unit: i.unit,
          formulaText: i.formulaText,
          quantityBasis: i.quantityBasis,
          nrm2Ref: i.nrm2Ref,
          workCategory: i.workCategory,
          applicableLevels: i.applicableLevels,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

/** GET / — selected lines for floor + optional elementKey. */
router.get(
  '/',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const floorId = String(req.query.floorId ?? '').trim();
      if (!floorId) {
        res.status(400).json({ error: 'floorId is required' });
        return;
      }
      const filter: Record<string, unknown> = {
        projectId: req.project!._id,
        floorId,
      };
      const elementKey = String(req.query.elementKey ?? '').trim();
      if (elementKey) filter.elementKey = elementKey;

      const docs = await SelectedBoqItem.find(filter).sort({
        elementKey: 1,
        catalogueRef: 1,
      });
      res.json({ items: docs.map((d) => publicSelectedBoqItem(d as any)) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST / — add one or more catalogue refs to the element BOQ.
 * Body: { floorId, elementKey, catalogueRefs: string[] }
 */
router.post(
  '/',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const floorId = String(req.body?.floorId ?? '').trim();
      const elementKey = String(req.body?.elementKey ?? '').trim();
      const refsRaw = req.body?.catalogueRefs;
      const refs: string[] = Array.isArray(refsRaw)
        ? refsRaw.map((r: unknown) => String(r).trim()).filter(Boolean)
        : req.body?.catalogueRef
          ? [String(req.body.catalogueRef).trim()]
          : [];

      if (!floorId || !elementKey) {
        res.status(400).json({ error: 'floorId and elementKey are required' });
        return;
      }
      if (!refs.length) {
        res.status(400).json({ error: 'catalogueRefs is required' });
        return;
      }

      const floor = await Floor.findOne({
        projectId: req.project!._id,
        floorId,
      });
      if (!floor) {
        res.status(400).json({ error: 'floorId does not exist on this project' });
        return;
      }

      const created: ReturnType<typeof publicSelectedBoqItem>[] = [];
      const skipped: string[] = [];

      for (const ref of refs) {
        const cat = findCatalogueItem(elementKey, ref);
        if (!cat) {
          skipped.push(ref);
          continue;
        }
        try {
          const doc = await SelectedBoqItem.create({
            projectId: req.project!._id,
            floorId,
            elementKey,
            catalogueRef: cat.ref,
            description: cat.description,
            unit: cat.unit || 'nr',
            formulaText: cat.formulaText || '',
            quantityBasis: cat.quantityBasis,
            nrm2Ref: cat.nrm2Ref || '',
            workCategory: cat.workCategory || '',
            applicableLevels: cat.applicableLevels || [],
            quantity: 0,
          });
          created.push(publicSelectedBoqItem(doc as any));
        } catch (err: any) {
          // Duplicate key — already on BOQ
          if (err?.code === 11000) {
            skipped.push(normalizeRef(ref));
            continue;
          }
          throw err;
        }
      }

      res.status(201).json({ items: created, skipped });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /takeoffs?q= — previous PDF takeoffs for this project (search by label / code).
 */
router.get(
  '/takeoffs',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = String(req.query.q ?? '').trim().toLowerCase();
      const sheets = await BlueprintSheet.find({
        projectId: req.project!._id,
      }).select({ _id: 1, name: 1, title: 1, floorId: 1 });
      const sheetIds = sheets.map((s) => s._id);
      const sheetById = new Map(
        sheets.map((s) => [
          s._id.toString(),
          {
            name: s.title || s.name,
            floorId: s.floorId || '',
          },
        ]),
      );
      const docs = await TakeoffItemModel.find({
        sheetId: { $in: sheetIds },
      })
        .sort({ updatedAt: -1 })
        .limit(200);
      const items = docs
        .map((d) => {
          const sheet = sheetById.get(d.sheetId.toString());
          const label = (d.label || '').trim();
          return {
            id: d._id.toString(),
            sheetId: d.sheetId.toString(),
            sheetName: sheet?.name || '',
            floorId: sheet?.floorId || '',
            type: d.type,
            label,
            qty: Number(d.calculatedValue) || 0,
            unit: d.unit,
          };
        })
        .filter((row) => {
          if (!q) return true;
          return (
            row.label.toLowerCase().includes(q) ||
            row.sheetName.toLowerCase().includes(q) ||
            row.type.toLowerCase().includes(q) ||
            row.unit.toLowerCase().includes(q)
          );
        })
        .slice(0, 50);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:itemId/takeoff',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const item = await SelectedBoqItem.findOne({
        _id: req.params.itemId,
        projectId: req.project!._id,
      });
      if (!item) {
        res.status(404).json({ error: 'Selected BOQ item not found' });
        return;
      }
      const takeoff = await getTakeoffDetail(req.project!._id, item as any);
      res.json({ takeoff });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/:itemId/takeoff',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const item = await SelectedBoqItem.findOne({
        _id: req.params.itemId,
        projectId: req.project!._id,
      });
      if (!item) {
        res.status(404).json({ error: 'Selected BOQ item not found' });
        return;
      }
      const kind = String(req.body?.kind ?? takeoffKindFor(item.unit)).trim();
      const wastePct = Math.max(0, numOr(req.body?.wastePct, 0));
      if (kind === 'bbs') {
        await applyBbsTakeoff({
          projectId: req.project!._id,
          item: item as any,
          wastePct,
          bars: req.body?.bars,
        });
      } else {
        await applyDimTakeoff({
          projectId: req.project!._id,
          item: item as any,
          wastePct,
          lines: req.body?.lines,
          measurementSetId: req.body?.measurementSetId ?? null,
        });
      }
      const takeoff = await getTakeoffDetail(req.project!._id, item as any);
      res.json({
        item: publicSelectedBoqItem(item as any),
        takeoff,
      });
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
      const item = await SelectedBoqItem.findOne({
        _id: req.params.itemId,
        projectId: req.project!._id,
      });
      if (!item) {
        res.status(404).json({ error: 'Selected BOQ item not found' });
        return;
      }
      if (req.body?.quantity != null && req.body.quantity !== '') {
        const qty = Number(req.body.quantity);
        if (!Number.isFinite(qty) || qty < 0) {
          res.status(400).json({ error: 'quantity must be a number ≥ 0' });
          return;
        }
        item.quantity = qty;
      }
      await item.save();
      res.json({ item: publicSelectedBoqItem(item as any) });
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
      const item = await SelectedBoqItem.findOne({
        _id: req.params.itemId,
        projectId: req.project!._id,
      });
      if (!item) {
        res.status(404).json({ error: 'Selected BOQ item not found' });
        return;
      }
      await cleanupItemMeasurementSet(item as any);
      await item.deleteOne();
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import { Floor } from '../models/Floor';
import { BoqPackElement } from '../models/BoqPackElement';
import { loadOwnedProject } from '../middleware/loadOwnedProject';
import {
  findActiveBoqPack,
  persistBoqPackFromWorkbook,
  toPublicBoqPack,
} from '../services/boqPack/persistBoqPack';
import { ensureDefaultBoqPack } from '../services/boqPack/ensureDefaultBoqPack';
import {
  BOQ_PACK_MAX_UPLOAD_BYTES,
  boqPackMulterTooLargeMessage,
  isBoqPackWorkbookFile,
} from '../services/boqPack/workbookFile';
import { ensureCatalogueSelected } from '../services/boqTakeoff/ensureCatalogueSelected';
import {
  PackAnalysisError,
  getPackAnalysis,
  listPackAnalyses,
  listPackResources,
  patchPackAnalysis,
  patchPackResource,
  createPackResource,
  recalculatePackAnalyses,
} from '../services/boqPack/packAnalysisService';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BOQ_PACK_MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!isBoqPackWorkbookFile(file)) {
      cb(new Error('Only Excel workbooks (.xlsx) are accepted'));
      return;
    }
    cb(null, true);
  },
});

const router = Router({ mergeParams: true });

router.get(
  '/',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pack = await ensureDefaultBoqPack({
        projectId: req.project!._id,
        projectCurrency: req.project!.currency,
      });
      if (!pack) {
        res.json({ pack: null, elements: [] });
        return;
      }
      const elements = await BoqPackElement.find({ packId: pack._id })
        .sort({ moduleNo: 1, sortOrder: 1 })
        .lean();
      res.json({
        pack: toPublicBoqPack(pack),
        elements: elements.map((el) => ({
          elementKey: el.elementKey,
          label: el.label,
          moduleNo: el.moduleNo,
          bindingKind: el.bindingKind,
          engineKey: el.engineKey || '',
          scope: el.scope,
          sortOrder: el.sortOrder,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/',
  loadOwnedProject,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      const tooLarge = boqPackMulterTooLargeMessage(err);
      if (tooLarge) {
        res.status(400).json({ error: tooLarge });
        return;
      }
      if (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        res.status(400).json({ error: message });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file?.buffer?.length) {
        res.status(400).json({
          error: 'Excel workbook is required (field name: file)',
        });
        return;
      }

      const uploadedBy = Types.ObjectId.isValid(req.user!.userId)
        ? new Types.ObjectId(req.user!.userId)
        : null;

      const result = await persistBoqPackFromWorkbook({
        projectId: req.project!._id,
        buffer: file.buffer,
        fileName: file.originalname || 'boq-pack.xlsx',
        uploadedBy,
        projectCurrency: req.project!.currency,
      });

      const floors = await Floor.find({ projectId: req.project!._id }).select({
        floorId: 1,
        label: 1,
        levelTypes: 1,
      });
      const selectedCreated = await ensureCatalogueSelected({
        projectId: req.project!._id,
        floors: floors.map((f) => ({
          floorId: f.floorId,
          label: f.label,
          levelTypes: f.levelTypes,
        })),
      });

      const pack = await findActiveBoqPack(req.project!._id);
      res.status(201).json({
        pack: pack ? toPublicBoqPack(pack) : null,
        packId: result.packId,
        reconcile: result.reconcile,
        selectedCreated,
        warnings: result.parsed.warnings,
      });
    } catch (err: unknown) {
      const parsed = (err as { parsed?: { errors?: string[]; warnings?: string[] } })
        .parsed;
      if (parsed?.errors?.length) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Invalid workbook',
          errors: parsed.errors,
          warnings: parsed.warnings || [],
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Upload failed';
      if (/Excel workbook|File too large|Workbook file is empty/i.test(message)) {
        res.status(400).json({ error: message, errors: [message] });
        return;
      }
      next(err);
    }
  },
);

function handlePackAnalysisError(
  err: unknown,
  res: Response,
  next: NextFunction,
): boolean {
  if (err instanceof PackAnalysisError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}

router.get(
  '/resources',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await listPackResources({
        projectId: req.project!._id,
        packId: typeof req.query.packId === 'string' ? req.query.packId : undefined,
        category: typeof req.query.category === 'string' ? req.query.category : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
      });
      res.json(data);
    } catch (err) {
      if (!handlePackAnalysisError(err, res, next)) next(err);
    }
  },
);

router.patch(
  '/resources/:resourceId',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body || {};
      const data = await patchPackResource({
        projectId: req.project!._id,
        resourceId: String(req.params.resourceId),
        packId: body.packId,
        patch: {
          code: body.code,
          description: body.description,
          unit: body.unit,
          unitRate: body.unitRate,
          wastePct: body.wastePct,
          category: body.category,
        },
      });
      res.json(data);
    } catch (err) {
      if (!handlePackAnalysisError(err, res, next)) next(err);
    }
  },
);

router.post(
  '/resources',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body || {};
      const data = await createPackResource({
        projectId: req.project!._id,
        packId: body.packId,
        code: String(body.code || ''),
        category: body.category,
        description: body.description,
        unit: body.unit,
        unitRate: body.unitRate,
        wastePct: body.wastePct,
      });
      res.status(201).json(data);
    } catch (err) {
      if (!handlePackAnalysisError(err, res, next)) next(err);
    }
  },
);

router.get(
  '/analyses',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await listPackAnalyses({
        projectId: req.project!._id,
        packId: typeof req.query.packId === 'string' ? req.query.packId : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json(data);
    } catch (err) {
      if (!handlePackAnalysisError(err, res, next)) next(err);
    }
  },
);

router.get(
  '/analyses/:lineKey',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await getPackAnalysis({
        projectId: req.project!._id,
        lineKey: String(req.params.lineKey),
        packId: typeof req.query.packId === 'string' ? req.query.packId : undefined,
      });
      res.json(data);
    } catch (err) {
      if (!handlePackAnalysisError(err, res, next)) next(err);
    }
  },
);

router.patch(
  '/analyses/:lineKey',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body || {};
      const data = await patchPackAnalysis({
        projectId: req.project!._id,
        lineKey: String(req.params.lineKey),
        packId: body.packId,
        revision: Number(body.revision),
        apply: Boolean(body.apply),
        lines: body.lines,
        allowances: body.allowances,
      });
      res.json(data);
    } catch (err) {
      if (!handlePackAnalysisError(err, res, next)) next(err);
    }
  },
);

router.post(
  '/recalculate',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body || {};
      const data = await recalculatePackAnalyses({
        projectId: req.project!._id,
        packId: body.packId,
        resourceIds: body.resourceIds,
        lineKeys: body.lineKeys,
        all: Boolean(body.all),
        apply: Boolean(body.apply),
      });
      res.json(data);
    } catch (err) {
      if (!handlePackAnalysisError(err, res, next)) next(err);
    }
  },
);

export default router;

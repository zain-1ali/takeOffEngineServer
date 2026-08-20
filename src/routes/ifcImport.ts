import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import fsPromises from 'fs/promises';
import multer from 'multer';
import { Types } from 'mongoose';
import { loadOwnedProject } from '../middleware/loadOwnedProject';
import { Floor } from '../models/Floor';
import { Instance } from '../models/Instance';
import {
  IfcImportJob,
  type IIfcImportJob,
  type IfcSuggestionStatus,
  type IfcWallSuggestionRow,
} from '../models/IfcImportJob';
import { IfcSuggestion } from '../models/IfcSuggestion';
import { parseIfc } from '../services/ifcImport';
import { buildWallInstanceBodies } from '../services/ifcImportCommit';
import { enqueueIfcImport } from '../services/ifcImportQueue';
import {
  acceptIfcSuggestion,
  loadOwnedSuggestion,
  patchIfcSuggestionMappedData,
  publicIfcSuggestion,
  rejectIfcSuggestion,
} from '../services/ifcAcceptSuggestion';
import {
  ensureIfcUploadsDir,
  IFC_MAX_UPLOAD_BYTES,
  multerFileTooLargeMessage,
} from '../services/ifcUploadLimits';
import { mapIfcWallsToSuggestions } from '../services/ifcWallMap';

ensureIfcUploadsDir();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, ensureIfcUploadsDir());
      } catch (err) {
        cb(err as Error, '');
      }
    },
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || 'model.ifc')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 80);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safe}`);
    },
  }),
  limits: { fileSize: IFC_MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const ok =
      name.endsWith('.ifc') ||
      file.mimetype === 'application/x-step' ||
      file.mimetype === 'application/octet-stream' ||
      file.mimetype === 'text/plain';
    if (!ok) {
      cb(new Error('Only IFC files (.ifc) are accepted'));
      return;
    }
    cb(null, true);
  },
});

const router = Router({ mergeParams: true });

function publicJob(job: IIfcImportJob) {
  return {
    id: job._id.toString(),
    projectId: job.projectId.toString(),
    fileName: job.fileName,
    status: job.status,
    error: job.error || null,
    summary: job.summary,
    suggestions: job.suggestions,
    committedAt: job.committedAt || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function uploadSingle(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const oversized = multerFileTooLargeMessage(err);
      const message =
        oversized || (err instanceof Error ? err.message : 'Upload failed');
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
}

async function unlinkQuiet(filePath: string | undefined | null): Promise<void> {
  if (!filePath) return;
  try {
    await fsPromises.unlink(filePath);
  } catch {
    /* ignore */
  }
}

async function loadOwnedJob(
  req: Request,
  res: Response,
): Promise<IIfcImportJob | null> {
  const jobId = Array.isArray(req.params.jobId)
    ? req.params.jobId[0]
    : req.params.jobId;
  if (!jobId || !Types.ObjectId.isValid(jobId)) {
    res.status(400).json({ error: 'Invalid job id' });
    return null;
  }
  const job = await IfcImportJob.findById(jobId);
  if (!job || job.projectId.toString() !== req.project!._id.toString()) {
    res.status(404).json({ error: 'Import job not found' });
    return null;
  }
  if (job.userId.toString() !== req.user!.userId) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  return job;
}

function applySuggestionPatches(
  jobSuggestions: IfcWallSuggestionRow[],
  updates: unknown[],
): void {
  const byId = new Map(jobSuggestions.map((s) => [s.id, s]));
  for (const patch of updates) {
    if (!patch || typeof patch !== 'object') continue;
    const p = patch as Record<string, unknown>;
    if (typeof p.id !== 'string') continue;
    const row = byId.get(p.id);
    if (!row) continue;

    if (p.status != null) {
      const st = String(p.status) as IfcSuggestionStatus;
      if (st === 'PENDING' || st === 'ACCEPTED' || st === 'REJECTED') {
        row.status = st;
      }
    }
    if (p.mark != null) {
      const mark = String(p.mark).trim();
      row.mark = mark || null;
    }
    if (p.shape === 'LINEAR' || p.shape === 'CURVED' || p.shape === null) {
      row.shape = p.shape;
    }
    if (p.geometry != null && typeof p.geometry === 'object') {
      const g = p.geometry as Record<string, unknown>;
      const next = { ...(row.geometry || { thickness: 0, height: 0 }) };
      if (g.length != null) {
        const n = Number(g.length);
        if (Number.isFinite(n) && n > 0) next.length = n;
      }
      if (g.radius != null) {
        const n = Number(g.radius);
        if (Number.isFinite(n) && n > 0) next.radius = n;
      }
      if (g.arcAngleDeg != null) {
        const n = Number(g.arcAngleDeg);
        if (Number.isFinite(n) && n > 0) next.arcAngleDeg = n;
      }
      if (g.thickness != null) {
        const n = Number(g.thickness);
        if (Number.isFinite(n) && n > 0) next.thickness = n;
      }
      if (g.height != null) {
        const n = Number(g.height);
        if (Number.isFinite(n) && n > 0) next.height = n;
      }
      row.geometry = next;
    }
  }
}

/**
 * POST /api/projects/:projectId/ifc-import
 * Upload IFC to disk → QUEUED job → background parse (p-queue).
 */
router.post('/', loadOwnedProject, uploadSingle, async (req: Request, res: Response) => {
  const diskPath = req.file?.path;
  try {
    if (!diskPath || !req.file) {
      res.status(400).json({ error: 'IFC file is required (field name: file)' });
      return;
    }
    if (!fs.existsSync(diskPath) || req.file.size <= 0) {
      await unlinkQuiet(diskPath);
      res.status(400).json({ error: 'IFC file is required (field name: file)' });
      return;
    }

    const job = await IfcImportJob.create({
      projectId: req.project!._id,
      userId: req.user!.userId,
      fileName: req.file.originalname || 'model.ifc',
      status: 'QUEUED',
      tempFilePath: diskPath,
      summary: { walls: 0, slabs: 0, geometryOk: 0, skipped: 0 },
      suggestions: [],
    });

    enqueueIfcImport(job._id.toString());

    res.status(201).json({
      jobId: job._id.toString(),
      job: publicJob(job),
    });
  } catch (err) {
    await unlinkQuiet(diskPath);
    const message = err instanceof Error ? err.message : 'IFC upload failed';
    res.status(422).json({ error: message });
  }
});

/**
 * POST /api/projects/:projectId/ifc-import/parse
 * Legacy/stateless parse (no job persistence). Prefer POST /.
 */
router.post(
  '/parse',
  loadOwnedProject,
  uploadSingle,
  async (req: Request, res: Response) => {
    const diskPath = req.file?.path;
    try {
      if (!diskPath || !req.file) {
        res.status(400).json({ error: 'IFC file is required (field name: file)' });
        return;
      }
      const buffer = await fsPromises.readFile(diskPath);
      if (!buffer.length) {
        res.status(400).json({ error: 'IFC file is required (field name: file)' });
        return;
      }
      const result = await parseIfc(buffer);
      const wallSuggestions = mapIfcWallsToSuggestions(result.entities);
      res.json({
        projectId: req.project!._id.toString(),
        fileName: req.file.originalname,
        ...result,
        wallSuggestions,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'IFC parse failed';
      res.status(422).json({ error: message });
    } finally {
      await unlinkQuiet(diskPath);
    }
  },
);

router.get(
  '/:jobId',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await loadOwnedJob(req, res);
      if (!job) return;
      res.json({ job: publicJob(job) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /:jobId/suggestions — first-class IfcSuggestion rows for review UI.
 * Sorted: HIGH first, then MEDIUM, then LOW; manual-modeling flagged rows last within tier.
 */
router.get(
  '/:jobId/suggestions',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await loadOwnedJob(req, res);
      if (!job) return;
      const rows = await IfcSuggestion.find({
        projectId: req.project!._id,
        jobId: job._id,
      });
      const rank = (c: string) =>
        c === 'HIGH' ? 0 : c === 'MEDIUM' ? 1 : 2;
      rows.sort((a, b) => {
        if (a.entityType !== b.entityType) {
          return a.entityType.localeCompare(b.entityType);
        }
        const rd = rank(a.confidence) - rank(b.confidence);
        if (rd !== 0) return rd;
        if (a.needsManualModeling !== b.needsManualModeling) {
          return a.needsManualModeling ? 1 : -1;
        }
        return a.expressId - b.expressId;
      });
      res.json({
        suggestions: rows.map(publicIfcSuggestion),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/:jobId/suggestions/:suggestionId',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await loadOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'SUCCEEDED') {
        res.status(409).json({ error: 'Suggestions are only editable after parse succeeds' });
        return;
      }
      const suggestion = await loadOwnedSuggestion(
        req.project!._id,
        String(req.params.suggestionId),
      );
      if (!suggestion || suggestion.jobId.toString() !== job._id.toString()) {
        res.status(404).json({ error: 'Suggestion not found' });
        return;
      }
      const updated = await patchIfcSuggestionMappedData(
        suggestion,
        req.body?.mappedInstanceData || req.body || {},
      );
      res.json({ suggestion: publicIfcSuggestion(updated) });
    } catch (err: unknown) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status?: number }).status)
          : 0;
      if (status) {
        res.status(status).json({
          error: err instanceof Error ? err.message : 'Update failed',
        });
        return;
      }
      next(err);
    }
  },
);

/**
 * POST /:jobId/suggestions/:suggestionId/accept
 * Body: { floorId, mappedInstanceData? }
 * Creates WALLS instance tagged source=IFC_IMPORT; dedupes on sourceGlobalId.
 */
router.post(
  '/:jobId/suggestions/:suggestionId/accept',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await loadOwnedJob(req, res);
      if (!job) return;
      if (job.status !== 'SUCCEEDED' && job.status !== 'COMMITTED') {
        res.status(409).json({ error: 'Cannot accept until parse succeeds' });
        return;
      }
      const suggestion = await loadOwnedSuggestion(
        req.project!._id,
        String(req.params.suggestionId),
      );
      if (!suggestion || suggestion.jobId.toString() !== job._id.toString()) {
        res.status(404).json({ error: 'Suggestion not found' });
        return;
      }
      const floorId = String(req.body?.floorId ?? '').trim();
      if (!floorId) {
        res.status(400).json({ error: 'floorId is required' });
        return;
      }
      const result = await acceptIfcSuggestion({
        suggestion,
        project: req.project!,
        floorId,
        mappedPatch: req.body?.mappedInstanceData,
      });
      res.json({
        suggestion: publicIfcSuggestion(result.suggestion),
        skippedDuplicate: result.skippedDuplicate,
        instance: result.instance
          ? {
              id: result.instance._id.toString(),
              mark: result.instance.mark,
              shape: result.instance.shape,
              floorId: result.instance.floorId,
              elementKey: result.instance.elementKey,
              source: result.instance.source,
              sourceGlobalId: result.instance.sourceGlobalId,
            }
          : null,
      });
    } catch (err: unknown) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status?: number }).status)
          : 0;
      if (status) {
        res.status(status).json({
          error: err instanceof Error ? err.message : 'Accept failed',
        });
        return;
      }
      next(err);
    }
  },
);

router.post(
  '/:jobId/suggestions/:suggestionId/reject',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await loadOwnedJob(req, res);
      if (!job) return;
      const suggestion = await loadOwnedSuggestion(
        req.project!._id,
        String(req.params.suggestionId),
      );
      if (!suggestion || suggestion.jobId.toString() !== job._id.toString()) {
        res.status(404).json({ error: 'Suggestion not found' });
        return;
      }
      const updated = await rejectIfcSuggestion(suggestion);
      res.json({ suggestion: publicIfcSuggestion(updated) });
    } catch (err: unknown) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status?: number }).status)
          : 0;
      if (status) {
        res.status(status).json({
          error: err instanceof Error ? err.message : 'Reject failed',
        });
        return;
      }
      next(err);
    }
  },
);

router.patch(
  '/:jobId/suggestions',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await loadOwnedJob(req, res);
      if (!job) return;
      if (job.status === 'COMMITTED') {
        res.status(409).json({ error: 'This import was already committed' });
        return;
      }
      if (job.status !== 'SUCCEEDED') {
        res.status(409).json({ error: 'Suggestions are only editable after parse succeeds' });
        return;
      }

      const updates = req.body?.suggestions;
      if (!Array.isArray(updates)) {
        res.status(400).json({ error: 'Body must include suggestions: []' });
        return;
      }

      applySuggestionPatches(job.suggestions, updates);
      job.markModified('suggestions');
      await job.save();
      res.json({ job: publicJob(job) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/projects/:projectId/ifc-import/:jobId/commit
 * Body: { floorId, suggestions?: patch[] }
 * Creates WALLS Instances for ACCEPTED suggestions only.
 */
router.post(
  '/:jobId/commit',
  loadOwnedProject,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await loadOwnedJob(req, res);
      if (!job) return;
      if (job.status === 'COMMITTED') {
        res.status(409).json({ error: 'This import was already committed' });
        return;
      }
      if (job.status !== 'SUCCEEDED') {
        res.status(409).json({ error: 'Cannot commit until parse succeeds' });
        return;
      }

      const floorId = String(req.body?.floorId ?? '').trim();
      if (!floorId) {
        res.status(400).json({ error: 'floorId is required' });
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

      const updates = req.body?.suggestions;
      if (Array.isArray(updates)) {
        applySuggestionPatches(job.suggestions, updates);
        job.markModified('suggestions');
      }

      const accepted = job.suggestions.filter((s) => s.status === 'ACCEPTED');
      if (!accepted.length) {
        res.status(400).json({
          error: 'Accept at least one suggestion before creating instances',
        });
        return;
      }

      const existing = await Instance.find({
        projectId: req.project!._id,
        floorId,
        elementKey: 'WALLS',
      }).select('mark');
      const existingMarks = existing.map((i) => i.mark);

      const { bodies, skipped } = buildWallInstanceBodies(accepted, {
        floorId,
        project: req.project!,
        existingMarks,
      });

      if (!bodies.length) {
        res.status(400).json({
          error:
            'No accepted walls have complete geometry (need shape + dimensions). Fix or reject incomplete rows.',
          skipped,
        });
        return;
      }

      const created = await Instance.insertMany(
        bodies.map((b) => ({
          projectId: req.project!._id,
          floorId: b.floorId,
          elementKey: b.elementKey,
          shape: b.shape,
          mark: b.mark,
          count: b.count,
          geometry: b.geometry,
          concreteGrade: b.concreteGrade,
          reinforcement: b.reinforcement,
          spec: b.spec,
          location: b.location,
          source: 'IFC_IMPORT' as const,
          sourceGlobalId: b.sourceGlobalId,
        })),
      );

      // Mirror accept onto first-class IfcSuggestion rows when present.
      for (const body of bodies) {
        await IfcSuggestion.updateMany(
          {
            projectId: req.project!._id,
            jobId: job._id,
            sourceGlobalId: body.sourceGlobalId,
            status: 'PENDING',
          },
          {
            $set: {
              status: 'ACCEPTED',
              needsManualModeling: false,
              skipReason: null,
            },
          },
        );
      }

      job.status = 'COMMITTED';
      job.committedAt = new Date();
      await job.save();

      res.json({
        added: created.length,
        skipped,
        instances: created.map((inst) => ({
          id: inst._id.toString(),
          mark: inst.mark,
          shape: inst.shape,
          floorId: inst.floorId,
          elementKey: inst.elementKey,
        })),
        job: publicJob(job),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

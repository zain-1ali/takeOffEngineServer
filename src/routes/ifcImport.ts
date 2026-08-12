import { Router, Request, Response, NextFunction } from 'express';
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
import { parseIfc } from '../services/ifcImport';
import {
  buildWallInstanceBodies,
  toJobWallSuggestion,
} from '../services/ifcImportCommit';
import { mapIfcWallsToSuggestions } from '../services/ifcWallMap';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
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
 * Upload IFC → persist job with PENDING wall suggestions (no Instance commit).
 */
router.post(
  '/',
  loadOwnedProject,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
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
      if (!req.file?.buffer?.length) {
        res.status(400).json({ error: 'IFC file is required (field name: file)' });
        return;
      }
      const result = await parseIfc(req.file.buffer);
      const mapped = mapIfcWallsToSuggestions(result.entities);
      const suggestions = mapped.map(toJobWallSuggestion);

      const job = await IfcImportJob.create({
        projectId: req.project!._id,
        userId: req.user!.userId,
        fileName: req.file.originalname || 'model.ifc',
        status: 'SUCCEEDED',
        summary: result.summary,
        suggestions,
      });

      res.status(201).json({
        jobId: job._id.toString(),
        job: publicJob(job),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'IFC parse failed';
      res.status(422).json({ error: message });
    }
  },
);

/**
 * POST /api/projects/:projectId/ifc-import/parse
 * Legacy/stateless parse (no job persistence). Prefer POST /.
 */
router.post(
  '/parse',
  loadOwnedProject,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        res.status(400).json({ error: message });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      if (!req.file?.buffer?.length) {
        res.status(400).json({ error: 'IFC file is required (field name: file)' });
        return;
      }
      const result = await parseIfc(req.file.buffer);
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
        })),
      );

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

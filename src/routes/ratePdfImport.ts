import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import { loadOwnedProject } from '../middleware/loadOwnedProject';
import {
  RatePdfImportJob,
  type RateSuggestionStatus,
} from '../models/RatePdfImportJob';
import { commitAcceptedSuggestions } from '../services/ratePdfImport/commit';
import {
  enqueueRatePdfImport,
  storePendingPdf,
} from '../services/ratePdfImport/queue';
import {
  parseCategory,
  parseUnitCost,
} from '../services/ratePdfImport/normalize';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');
    if (!ok) {
      cb(new Error('Only PDF files are accepted'));
      return;
    }
    cb(null, true);
  },
});

const router = Router({ mergeParams: true });

function publicJob(job: InstanceType<typeof RatePdfImportJob>) {
  return {
    id: job._id.toString(),
    projectId: job.projectId.toString(),
    fileName: job.fileName,
    status: job.status,
    error: job.error || null,
    suggestions: job.suggestions,
    committedAt: job.committedAt || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function loadOwnedJob(
  req: Request,
  res: Response,
): Promise<InstanceType<typeof RatePdfImportJob> | null> {
  const jobId = Array.isArray(req.params.jobId)
    ? req.params.jobId[0]
    : req.params.jobId;
  if (!jobId || !Types.ObjectId.isValid(jobId)) {
    res.status(400).json({ error: 'Invalid job id' });
    return null;
  }
  const job = await RatePdfImportJob.findById(jobId);
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
      if (!process.env.OPENROUTER_API_KEY) {
        res.status(503).json({
          error: 'PDF import is not configured (missing OPENROUTER_API_KEY)',
        });
        return;
      }
      const file = req.file;
      if (!file?.buffer?.length) {
        res.status(400).json({ error: 'PDF file is required (field name: file)' });
        return;
      }

      const job = await RatePdfImportJob.create({
        projectId: req.project!._id,
        userId: req.user!.userId,
        fileName: file.originalname || 'rates.pdf',
        status: 'QUEUED',
        suggestions: [],
      });

      storePendingPdf(job._id.toString(), job.fileName, file.buffer);
      enqueueRatePdfImport(job._id.toString());

      res.status(202).json({ jobId: job._id.toString(), job: publicJob(job) });
    } catch (err) {
      next(err);
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
        res.status(409).json({ error: 'Suggestions are only editable after extraction succeeds' });
        return;
      }

      const updates = req.body?.suggestions;
      if (!Array.isArray(updates)) {
        res.status(400).json({ error: 'Body must include suggestions: []' });
        return;
      }

      const byId = new Map(job.suggestions.map((s) => [s.id, s]));
      for (const patch of updates) {
        if (!patch || typeof patch.id !== 'string') continue;
        const row = byId.get(patch.id);
        if (!row) continue;

        if (patch.status != null) {
          const st = String(patch.status) as RateSuggestionStatus;
          if (st === 'PENDING' || st === 'ACCEPTED' || st === 'REJECTED') {
            row.status = st;
          }
        }
        if (patch.name != null) {
          const name = String(patch.name).trim();
          if (name) row.name = name;
        }
        if (patch.unit != null) {
          const unit = String(patch.unit).trim();
          if (unit) row.unit = unit;
        }
        if (patch.category != null) {
          const cat = parseCategory(patch.category);
          if (cat) row.category = cat;
        }
        if (patch.unitCost != null) {
          const cost = parseUnitCost(patch.unitCost);
          if (cost != null) row.unitCost = cost;
        }
      }

      job.markModified('suggestions');
      await job.save();
      res.json({ job: publicJob(job) });
    } catch (err) {
      next(err);
    }
  },
);

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
        res.status(409).json({ error: 'Cannot commit until extraction succeeds' });
        return;
      }

      // Apply any last-minute suggestion patches from the same payload.
      const updates = req.body?.suggestions;
      if (Array.isArray(updates)) {
        const byId = new Map(job.suggestions.map((s) => [s.id, s]));
        for (const patch of updates) {
          if (!patch || typeof patch.id !== 'string') continue;
          const row = byId.get(patch.id);
          if (!row) continue;
          if (patch.status != null) {
            const st = String(patch.status) as RateSuggestionStatus;
            if (st === 'PENDING' || st === 'ACCEPTED' || st === 'REJECTED') {
              row.status = st;
            }
          }
          if (patch.name != null) {
            const name = String(patch.name).trim();
            if (name) row.name = name;
          }
          if (patch.unit != null) {
            const unit = String(patch.unit).trim();
            if (unit) row.unit = unit;
          }
          if (patch.category != null) {
            const cat = parseCategory(patch.category);
            if (cat) row.category = cat;
          }
          if (patch.unitCost != null) {
            const cost = parseUnitCost(patch.unitCost);
            if (cost != null) row.unitCost = cost;
          }
        }
        job.markModified('suggestions');
      }

      const accepted = job.suggestions.filter((s) => s.status === 'ACCEPTED');
      if (!accepted.length) {
        res.status(400).json({
          error: 'Accept at least one suggestion before importing to the databank',
        });
        return;
      }

      const project = req.project!;
      const { added, rateLib } = commitAcceptedSuggestions(project, job);
      project.rateLib = rateLib;
      await project.save();

      job.status = 'COMMITTED';
      job.committedAt = new Date();
      await job.save();

      res.json({
        added,
        job: publicJob(job),
        project: {
          id: project._id.toString(),
          rateLib: project.rateLib,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

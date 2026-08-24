import { Router, type Request, type Response, type NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Types } from 'mongoose';
import { Project } from '../models/Project';
import { BlueprintSheet } from '../models/BlueprintSheet';
import { convertPdfToSheets, UPLOADS_ROOT } from '../services/pdfConversion';
import { enqueueBackgroundJob } from '../services/pdfJobQueue';
import { mapSheet } from '../utils/mapSheet';

type MulterFile = Express.Multer.File;

const TEMP_UPLOAD_DIR = path.join(UPLOADS_ROOT, '_tmp');

const upload = multer({
  dest: TEMP_UPLOAD_DIR,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 20,
  },
  fileFilter: (_req, file, cb) => {
    const isPdfMime = file.mimetype === 'application/pdf';
    const isPdfExt = path.extname(file.originalname).toLowerCase() === '.pdf';
    if (isPdfMime || isPdfExt) {
      cb(null, true);
      return;
    }
    cb(new Error('Only PDF files are allowed'));
  },
});

const sheetsRouter = Router({ mergeParams: true });

interface ProjectParams {
  projectId: string;
}

async function ensureTempDir(): Promise<void> {
  await fs.mkdir(TEMP_UPLOAD_DIR, { recursive: true });
}

function collectUploadedPdfs(req: Request): MulterFile[] {
  const files: MulterFile[] = [];
  if (Array.isArray(req.files)) {
    files.push(...req.files);
  } else if (req.files && typeof req.files === 'object') {
    const map = req.files as Record<string, MulterFile[]>;
    if (map.files) files.push(...map.files);
    if (map.file) files.push(...map.file);
  }
  if (req.file) files.push(req.file);
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  });
}

function safeFileStem(name: string): string {
  return (
    path
      .parse(name)
      .name.replace(/[^\w\-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80) || 'upload'
  );
}

/** GET /api/projects/:projectId/sheets */
sheetsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params as unknown as ProjectParams;
  if (!Types.ObjectId.isValid(projectId)) {
    res.status(400).json({ error: 'Invalid projectId' });
    return;
  }
  try {
    const project = await Project.findById(projectId).exec();
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const docs = await BlueprintSheet.find({ projectId })
      .sort({ sortOrder: 1, pageNumber: 1, createdAt: 1 })
      .exec();
    res.status(200).json({ sheets: docs.map(mapSheet) });
  } catch (error: unknown) {
    console.error('List sheets failed:', error);
    res.status(500).json({ error: 'Failed to list sheets' });
  }
});

/** POST /api/projects/:projectId/sheets/upload */
sheetsRouter.post(
  '/upload',
  async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      await ensureTempDir();
      next();
    } catch (error: unknown) {
      next(error);
    }
  },
  (req: Request, res: Response, next: NextFunction) => {
    upload.fields([
      { name: 'files', maxCount: 20 },
      { name: 'file', maxCount: 1 },
    ])(req, res, (error: unknown) => {
      if (error instanceof MulterError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params as unknown as ProjectParams;
    const uploaded = collectUploadedPdfs(req);

    if (!Types.ObjectId.isValid(projectId)) {
      await Promise.all(
        uploaded.map((file) => fs.unlink(file.path).catch(() => undefined)),
      );
      res.status(400).json({ error: 'Invalid projectId' });
      return;
    }

    if (uploaded.length === 0) {
      res.status(400).json({
        error: 'PDF file is required (field name: files or file)',
      });
      return;
    }

    try {
      const project = await Project.findById(projectId).exec();
      if (!project) {
        await Promise.all(
          uploaded.map((file) => fs.unlink(file.path).catch(() => undefined)),
        );
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const discipline =
        typeof req.body?.discipline === 'string' && req.body.discipline.trim()
          ? req.body.discipline.trim()
          : 'Other';

      const workItems: Array<{ path: string; originalName: string }> = [];
      for (const file of uploaded) {
        const stableName = `${projectId}-${Date.now()}-${safeFileStem(file.originalname)}-${workItems.length}.pdf`;
        const stablePath = path.join(TEMP_UPLOAD_DIR, stableName);
        await fs.rename(file.path, stablePath);
        workItems.push({
          path: stablePath,
          originalName: file.originalname,
        });
      }

      enqueueBackgroundJob(async () => {
        for (const item of workItems) {
          try {
            await convertPdfToSheets(projectId, item.path, item.originalName, {
              discipline,
            });
          } catch (error: unknown) {
            console.error(
              `[pdf upload] conversion failed for ${item.originalName}:`,
              error,
            );
          } finally {
            await fs.unlink(item.path).catch(() => undefined);
          }
        }
      }, `pdf-upload project=${projectId} files=${workItems.length}`);

      res.status(202).json({
        projectId,
        status: 'processing',
        message: 'PDF processing started',
        fileCount: workItems.length,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to process PDF upload';
      console.error('PDF upload failed:', error);
      await Promise.all(
        uploaded.map((file) => fs.unlink(file.path).catch(() => undefined)),
      );
      res.status(500).json({ error: message });
    }
  },
);

export default sheetsRouter;

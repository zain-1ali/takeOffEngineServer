import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { IProject, Project } from '../models/Project';

declare global {
  namespace Express {
    interface Request {
      project?: IProject;
    }
  }
}

/** Load project by :projectId and ensure it belongs to the authenticated user. */
export async function loadOwnedProject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;
    if (!projectId || !Types.ObjectId.isValid(projectId)) {
      res.status(400).json({ error: 'Invalid project id' });
      return;
    }

    const project = await Project.findById(projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (project.userId.toString() !== req.user!.userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    req.project = project;
    next();
  } catch (err) {
    next(err);
  }
}

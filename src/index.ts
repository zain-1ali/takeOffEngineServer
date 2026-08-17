import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import { requireAuth } from './middleware/requireAuth';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import projectsRouter from './routes/projects';

dotenv.config();

const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/takeoff-engine';

/** Comma-separated allowlist, e.g. https://app.vercel.app,http://localhost:5173 */
function parseCorsOrigins(): string[] {
  const raw =
    process.env.FRONTEND_ORIGINS ||
    process.env.FRONTEND_ORIGIN ||
    'http://localhost:5173';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

const CORS_ORIGINS = parseCorsOrigins();

async function start() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in environment');
  }

  await connectDB(MONGODB_URI);

  const app = express();

  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin / server-to-server / curl (no Origin header)
        if (!origin) {
          cb(null, true);
          return;
        }
        const normalized = origin.replace(/\/$/, '');
        if (CORS_ORIGINS.includes(normalized)) {
          cb(null, true);
          return;
        }
        cb(null, false);
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Public routes
  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);

  // Authenticated API
  app.use('/api/projects', requireAuth, projectsRouter);

  // Catch-all auth for any future /api routes not listed above
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    if (
      path === '/health' ||
      path.startsWith('/auth/') ||
      path.startsWith('/projects')
    ) {
      next();
      return;
    }
    requireAuth(req, res, next);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
    console.log(
      `CORS origins: ${CORS_ORIGINS.join(', ') || '(none)'} (credentials: true)`,
    );
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

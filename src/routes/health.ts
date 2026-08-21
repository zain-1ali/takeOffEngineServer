import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus =
    dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';

    const envVars = {
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASS: process.env.SMTP_PASS,
      SMTP_FROM: process.env.SMTP_FROM,
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_PORT: process.env.SMTP_PORT,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
      PORT: process.env.PORT,
      MONGODB_URI: process.env.MONGODB_URI,
      JWT_SECRET: process.env.JWT_SECRET,
      NODE_ENV: process.env.NODE_ENV,
    };

  res.status(200).json({
    status: 'ok',
    service: 'takeoff-engine-api',
    timestamp: new Date().toISOString(),
    db: dbStatus,
    envVars
  });
});

export default router;

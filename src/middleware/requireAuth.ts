import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { COOKIE_NAME, verifyToken } from '../utils/jwt';

export type AuthUser = {
  userId: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const user = await User.findById(payload.userId).select('tokenVersion');
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    if (user.tokenVersion !== payload.tokenVersion) {
      res.status(401).json({ error: 'Session invalidated' });
      return;
    }

    req.user = { userId: user._id.toString() };
    next();
  } catch (err) {
    next(err);
  }
}

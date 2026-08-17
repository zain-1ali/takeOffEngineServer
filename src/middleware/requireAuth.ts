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

/** Cookie (preferred when same-site) or Authorization: Bearer <jwt>. */
function extractToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken) return cookieToken;

  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }
  return undefined;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractToken(req);
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

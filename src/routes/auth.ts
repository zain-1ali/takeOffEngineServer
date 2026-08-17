import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import { requireAuth } from '../middleware/requireAuth';
import { clearAuthCookie, setAuthCookie, signToken } from '../utils/jwt';

const router = Router();
const SALT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user: { _id: { toString(): string }; email: string; name: string }) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
  };
}

router.post('/signup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'Enter a valid email address' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const existing = await User.findOne({ email });
    if (existing) {
      res.status(409).json({ error: 'An account with that email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({ email, passwordHash, name, tokenVersion: 0 });

    const token = signToken({
      userId: user._id.toString(),
      tokenVersion: user.tokenVersion,
    });
    setAuthCookie(res, token);

    res.status(201).json({ user: publicUser(user), token });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await User.findOne({ email });
    if (!user) {
      res.status(401).json({ error: 'Incorrect email or password' });
      return;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Incorrect email or password' });
      return;
    }

    const token = signToken({
      userId: user._id.toString(),
      tokenVersion: user.tokenVersion,
    });
    setAuthCookie(res, token);

    res.json({ user: publicUser(user), token });
  } catch (err) {
    next(err);
  }
});

/** Always clears cookie; auth optional so logout works when cookies were blocked. */
router.post('/logout', (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user!.userId).select('email name');
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

export default router;

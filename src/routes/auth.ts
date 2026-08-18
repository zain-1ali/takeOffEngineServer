import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/User';
import { requireAuth } from '../middleware/requireAuth';
import { clearAuthCookie, setAuthCookie, signToken } from '../utils/jwt';
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../utils/mail';
import { createOpaqueToken, hashToken, hoursFromNow } from '../utils/tokens';

const router = Router();
const SALT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GENERIC_RESET_MSG =
  'If an account exists for that email, we sent password reset instructions.';
const GENERIC_VERIFY_MSG =
  'If an unverified account exists for that email, we sent a verification link.';

function publicUser(user: {
  _id: { toString(): string };
  email: string;
  name: string;
  emailVerified?: boolean;
}) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    emailVerified: Boolean(user.emailVerified !== false),
  };
}

function issueSession(
  res: Response,
  user: { _id: { toString(): string }; tokenVersion: number; email: string; name: string; emailVerified?: boolean },
) {
  const token = signToken({
    userId: user._id.toString(),
    tokenVersion: user.tokenVersion,
  });
  setAuthCookie(res, token);
  return { user: publicUser(user), token };
}

function googleClientId(): string | undefined {
  return process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
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
    const { token: verifyToken, hash: verifyHash } = createOpaqueToken();
    const user = await User.create({
      email,
      passwordHash,
      name,
      tokenVersion: 0,
      emailVerified: false,
      emailVerificationTokenHash: verifyHash,
      emailVerificationExpires: hoursFromNow(24),
    });

    try {
      await sendVerificationEmail(email, verifyToken);
    } catch (mailErr) {
      console.error('[auth] verification email failed', mailErr);
    }

    res.status(201).json({
      needsVerification: true,
      email: user.email,
      message: 'Check your email to verify your account before signing in.',
    });
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
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Incorrect email or password' });
      return;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Incorrect email or password' });
      return;
    }

    if (user.emailVerified === false) {
      res.status(403).json({
        error: 'Please verify your email before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
      });
      return;
    }

    res.json(issueSession(res, user));
  } catch (err) {
    next(err);
  }
});

router.post('/google', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = googleClientId();
    if (!clientId) {
      res.status(503).json({ error: 'Google sign-in is not configured' });
      return;
    }

    const credential = String(req.body?.credential ?? '').trim();
    if (!credential) {
      res.status(400).json({ error: 'Google credential is required' });
      return;
    }

    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.sub) {
      res.status(401).json({ error: 'Invalid Google credential' });
      return;
    }
    if (payload.email_verified === false) {
      res.status(401).json({ error: 'Google email is not verified' });
      return;
    }

    const email = payload.email.toLowerCase();
    const googleId = payload.sub;
    const name =
      String(payload.name || '').trim() ||
      email.split('@')[0] ||
      'Google user';

    let user = await User.findOne({
      $or: [{ googleId }, { email }],
    });

    if (user) {
      if (!user.googleId) user.googleId = googleId;
      if (user.emailVerified === false) user.emailVerified = true;
      if (!user.name && name) user.name = name;
      user.emailVerificationTokenHash = undefined;
      user.emailVerificationExpires = undefined;
      await user.save();
    } else {
      user = await User.create({
        email,
        name,
        googleId,
        emailVerified: true,
        tokenVersion: 0,
      });
    }

    res.json(issueSession(res, user));
  } catch (err) {
    next(err);
  }
});

router.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String(req.body?.token ?? '').trim();
    if (!token) {
      res.status(400).json({ error: 'Verification token is required' });
      return;
    }

    const hash = hashToken(token);
    const user = await User.findOne({
      emailVerificationTokenHash: hash,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired verification link' });
      return;
    }

    user.emailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({
      ...issueSession(res, user),
      message: 'Email verified. You are signed in.',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/resend-verification', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'Enter a valid email address' });
      return;
    }

    const user = await User.findOne({ email });
    if (user && user.emailVerified === false && user.passwordHash) {
      const { token, hash } = createOpaqueToken();
      user.emailVerificationTokenHash = hash;
      user.emailVerificationExpires = hoursFromNow(24);
      await user.save();
      try {
        await sendVerificationEmail(email, token);
      } catch (mailErr) {
        console.error('[auth] resend verification failed', mailErr);
      }
    }

    res.json({ message: GENERIC_VERIFY_MSG });
  } catch (err) {
    next(err);
  }
});

router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'Enter a valid email address' });
      return;
    }

    const user = await User.findOne({ email });
    if (user?.passwordHash) {
      const { token, hash } = createOpaqueToken();
      user.passwordResetTokenHash = hash;
      user.passwordResetExpires = hoursFromNow(1);
      await user.save();
      try {
        await sendPasswordResetEmail(email, token);
      } catch (mailErr) {
        console.error('[auth] password reset email failed', mailErr);
      }
    }

    res.json({ message: GENERIC_RESET_MSG });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String(req.body?.token ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (!token) {
      res.status(400).json({ error: 'Reset token is required' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const hash = hashToken(token);
    const user = await User.findOne({
      passwordResetTokenHash: hash,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired reset link' });
      return;
    }

    user.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpires = undefined;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    // Completing reset implies they control the inbox.
    user.emailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({
      ...issueSession(res, user),
      message: 'Password updated. You are signed in.',
    });
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
    const user = await User.findById(req.user!.userId).select('email name emailVerified');
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/** Public: whether Google button should render (client id is also on the frontend). */
router.get('/providers', (_req: Request, res: Response) => {
  res.json({ google: Boolean(googleClientId()) });
});

export default router;

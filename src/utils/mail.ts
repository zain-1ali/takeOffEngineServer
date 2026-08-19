import nodemailer from 'nodemailer';

function frontendBaseUrl(): string {
  const raw =
    process.env.FRONTEND_ORIGINS ||
    process.env.FRONTEND_ORIGIN ||
    'http://localhost:5173';
  return raw.split(',')[0]!.trim().replace(/\/$/, '');
}

export function appFrontendUrl(path: string): string {
  const base = frontendBaseUrl();
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/** Gmail app passwords are often copied with spaces — strip them. */
function smtpPass(): string {
  return String(process.env.SMTP_PASS || '').replace(/\s+/g, '');
}

function smtpFrom(): string {
  const raw = String(
    process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@takeoffengine.local',
  ).trim();
  // Strip wrapping quotes if present in .env
  return raw.replace(/^["']|["']$/g, '');
}

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && smtpPass());
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure && port === 587,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPass(),
    },
  });
}

export type SendMailResult = { sent: true } | { sent: false; reason: string };

export async function sendAppEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendMailResult> {
  const from = smtpFrom();

  if (!smtpConfigured()) {
    const reason = 'SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)';
    console.warn(`[mail] ${reason} — email not sent. Preview:`);
    console.warn(`  To: ${opts.to}`);
    console.warn(`  Subject: ${opts.subject}`);
    console.warn(`  ${opts.text}`);
    return { sent: false, reason };
  }

  try {
    const transport = createTransport();
    const info = await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    console.log(
      `[mail] sent to ${opts.to} subject="${opts.subject}" id=${info.messageId || 'n/a'}`,
    );
    return { sent: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[mail] FAILED to ${opts.to}: ${reason}`);
    console.warn(`[mail] Fallback link preview:\n${opts.text}`);
    return { sent: false, reason };
  }
}

export async function sendVerificationEmail(
  to: string,
  token: string,
): Promise<SendMailResult> {
  const url = appFrontendUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  // Always log in non-production so local testing works even when SMTP is slow/fails
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[mail] verification link for ${to}: ${url}`);
  }
  return sendAppEmail({
    to,
    subject: 'Verify your AgileQS email',
    text: `Verify your email by opening this link (expires in 24 hours):\n\n${url}\n`,
    html: `<p>Verify your AgileQS email by clicking the link below (expires in 24 hours):</p>
<p><a href="${url}">${url}</a></p>`,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<SendMailResult> {
  const url = appFrontendUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[mail] password-reset link for ${to}: ${url}`);
  }
  return sendAppEmail({
    to,
    subject: 'Reset your AgileQS password',
    text: `Reset your password by opening this link (expires in 1 hour):\n\n${url}\n\nIf you did not request this, you can ignore this email.\n`,
    html: `<p>Reset your AgileQS password by clicking the link below (expires in 1 hour):</p>
<p><a href="${url}">${url}</a></p>
<p>If you did not request this, you can ignore this email.</p>`,
  });
}

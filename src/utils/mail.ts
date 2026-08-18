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

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendAppEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@takeoffengine.local';

  if (!smtpConfigured()) {
    // Dev / misconfigured: surface the message so flows remain testable.
    console.warn('[mail] SMTP not configured — email not sent. Preview:');
    console.warn(`  To: ${opts.to}`);
    console.warn(`  Subject: ${opts.subject}`);
    console.warn(`  ${opts.text}`);
    return;
  }

  const transport = createTransport();
  await transport.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = appFrontendUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  await sendAppEmail({
    to,
    subject: 'Verify your AgileQS email',
    text: `Verify your email by opening this link (expires in 24 hours):\n\n${url}\n`,
    html: `<p>Verify your AgileQS email by clicking the link below (expires in 24 hours):</p>
<p><a href="${url}">${url}</a></p>`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = appFrontendUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  await sendAppEmail({
    to,
    subject: 'Reset your AgileQS password',
    text: `Reset your password by opening this link (expires in 1 hour):\n\n${url}\n\nIf you did not request this, you can ignore this email.\n`,
    html: `<p>Reset your AgileQS password by clicking the link below (expires in 1 hour):</p>
<p><a href="${url}">${url}</a></p>
<p>If you did not request this, you can ignore this email.</p>`,
  });
}

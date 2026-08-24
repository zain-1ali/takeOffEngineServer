import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Request, Response } from 'express';

/** Directory for local fallback (and conversion temp): backend/uploads */
export const UPLOADS_ROOT = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(__dirname, '../../uploads');

export function publicUploadUrl(key: string): string {
  return `/uploads/${key.replace(/^\/+/, '')}`;
}

export function uploadKeyFromPublicUrl(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/uploads\//, '').replace(/^uploads\//, '');
}

type BucketConfig = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

function readBucketConfig(): BucketConfig | null {
  const bucket =
    process.env.RAILWAY_BUCKET?.trim() || process.env.BUCKET?.trim() || '';
  const endpoint =
    process.env.RAILWAY_ENDPOINT?.trim() || process.env.ENDPOINT?.trim() || '';
  const accessKeyId =
    process.env.RAILWAY_ACCESS_KEY_ID?.trim() ||
    process.env.ACCESS_KEY_ID?.trim() ||
    '';
  const secretAccessKey =
    process.env.RAILWAY_SECRET_ACCESS_KEY?.trim() ||
    process.env.SECRET_ACCESS_KEY?.trim() ||
    '';
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }
  const forcePathStyle =
    process.env.RAILWAY_S3_FORCE_PATH_STYLE === 'true' ||
    endpoint.includes('t3.storageapi.dev');
  return {
    bucket,
    endpoint,
    region:
      process.env.RAILWAY_REGION?.trim() ||
      process.env.REGION?.trim() ||
      'auto',
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
  };
}

export function isObjectStorageConfigured(): boolean {
  return readBucketConfig() != null;
}

export function objectStorageSummary(): string {
  const config = readBucketConfig();
  if (!config) return 'local disk';
  return `Railway bucket ${config.bucket} @ ${config.endpoint}`;
}

let cachedClient: S3Client | null = null;
let cachedClientKey = '';

function s3Client(): S3Client {
  const config = readBucketConfig();
  if (!config) {
    throw new Error('Railway object storage is not configured');
  }
  const cacheKey = `${config.endpoint}|${config.bucket}|${config.accessKeyId}|${config.forcePathStyle}`;
  if (cachedClient && cachedClientKey === cacheKey) {
    return cachedClient;
  }
  cachedClient = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedClientKey = cacheKey;
  return cachedClient;
}

function contentTypeForKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function assertSafeKey(key: string): string {
  const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
  if (
    !normalized ||
    normalized.includes('..') ||
    path.isAbsolute(normalized) ||
    normalized.startsWith('_tmp/')
  ) {
    throw new Error('Invalid upload key');
  }
  return normalized;
}

async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const config = readBucketConfig();
  if (!config) {
    throw new Error('Railway object storage is not configured');
  }
  await s3Client().send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

async function getObject(key: string): Promise<Buffer> {
  const config = readBucketConfig();
  if (!config) {
    throw new Error('Railway object storage is not configured');
  }
  const response = await s3Client().send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) {
    throw new Error(`Empty object for key ${key}`);
  }
  return Buffer.from(bytes);
}

/** Write to the Railway bucket when configured, otherwise local uploads/. */
export async function persistUpload(
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<string> {
  const safeKey = assertSafeKey(key);
  const type = contentType ?? contentTypeForKey(safeKey);
  if (isObjectStorageConfigured()) {
    await putObject(safeKey, body, type);
  } else {
    const absolutePath = path.join(UPLOADS_ROOT, safeKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, body);
  }
  return publicUploadUrl(safeKey);
}

export async function readUpload(keyOrUrl: string): Promise<Buffer> {
  const safeKey = assertSafeKey(uploadKeyFromPublicUrl(keyOrUrl));
  if (isObjectStorageConfigured()) {
    return getObject(safeKey);
  }
  return fs.readFile(path.join(UPLOADS_ROOT, safeKey));
}

export async function serveUpload(
  req: Request,
  res: Response,
): Promise<void> {
  const rawPath = decodeURIComponent(req.path).replace(/^\/uploads\//, '');
  let key: string;
  try {
    key = assertSafeKey(rawPath);
  } catch {
    res.status(400).json({ error: 'Invalid upload path' });
    return;
  }

  try {
    const body = isObjectStorageConfigured()
      ? await getObject(key)
      : await fs.readFile(path.join(UPLOADS_ROOT, key));
    res.setHeader('Content-Type', contentTypeForKey(key));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(body);
  } catch (error: unknown) {
    const code =
      error && typeof error === 'object' && 'name' in error
        ? String((error as { name: string }).name)
        : '';
    if (
      code === 'NoSuchKey' ||
      code === 'NotFound' ||
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    console.error(`Failed to serve upload ${key}:`, error);
    res.status(500).json({ error: 'Failed to load file' });
  }
}

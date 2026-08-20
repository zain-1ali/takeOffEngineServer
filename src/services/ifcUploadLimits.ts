/**
 * IFC upload limits + temp directory for disk-backed multer storage.
 */
import fs from 'fs';
import path from 'path';

/** Max IFC upload size (200 MB). */
export const IFC_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export const IFC_MAX_UPLOAD_LABEL = '200 MB';

export function ifcUploadsDir(): string {
  return path.join(process.cwd(), 'tmp', 'ifc-uploads');
}

export function ensureIfcUploadsDir(): string {
  const dir = ifcUploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function multerFileTooLargeMessage(err: unknown): string | null {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: string }).code === 'LIMIT_FILE_SIZE'
  ) {
    return `File too large (max ${IFC_MAX_UPLOAD_LABEL})`;
  }
  return null;
}

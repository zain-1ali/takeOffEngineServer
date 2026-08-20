/**
 * IFC upload size limits (memory-backed multer; no disk persistence).
 */
/** Max IFC upload size (200 MB). */
export const IFC_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export const IFC_MAX_UPLOAD_LABEL = '200 MB';

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

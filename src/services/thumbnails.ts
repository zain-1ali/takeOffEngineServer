import path from 'node:path';
import sharp from 'sharp';

const THUMB_MAX_WIDTH = 360;

/**
 * Write a small JPEG thumbnail next to a full-size page PNG.
 * Returns the public URL path (`/uploads/{projectId}/{sheetId}.thumb.jpg`).
 */
export async function writeSheetThumbnail(
  fullImageAbsolutePath: string,
  projectId: string,
  sheetId: string,
): Promise<string> {
  const dir = path.dirname(fullImageAbsolutePath);
  const thumbFileName = `${sheetId}.thumb.jpg`;
  const thumbAbsolutePath = path.join(dir, thumbFileName);

  await sharp(fullImageAbsolutePath)
    .resize({
      width: THUMB_MAX_WIDTH,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(thumbAbsolutePath);

  return `/uploads/${projectId}/${thumbFileName}`;
}

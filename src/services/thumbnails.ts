import sharp from 'sharp';

const THUMB_MAX_WIDTH = 360;

/** Small JPEG thumbnail from a full-size page PNG buffer. */
export async function renderSheetThumbnailJpeg(
  fullImage: Buffer,
): Promise<Buffer> {
  return sharp(fullImage)
    .resize({
      width: THUMB_MAX_WIDTH,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
}

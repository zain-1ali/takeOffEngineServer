import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { Types } from 'mongoose';
import { BlueprintSheet, type Sheet } from '../models/BlueprintSheet';
import { mapSheet } from '../utils/mapSheet';
import { persistUpload } from './objectStorage';
import { renderSheetThumbnailJpeg } from './thumbnails';

/** @deprecated Use objectStorage.UPLOADS_ROOT — re-exported for existing imports. */
export { UPLOADS_ROOT } from './objectStorage';

const PDF_RENDER_SCALE = 3;

export interface ConvertPdfResult {
  sheets: Sheet[];
  pageCount: number;
}

async function nextSortOrder(projectId: string): Promise<number> {
  const highest = await BlueprintSheet.findOne({ projectId })
    .sort({ sortOrder: -1 })
    .select('sortOrder')
    .exec();
  return (highest?.sortOrder ?? -1) + 1;
}

function toBuffer(data: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/**
 * Convert each PDF page to a PNG + thumbnail, persist the original PDF and
 * page assets (Railway bucket when configured, otherwise local uploads/),
 * and create one BlueprintSheet per page.
 */
export async function convertPdfToSheets(
  projectId: string,
  pdfFilePath: string,
  originalFileName: string,
  options?: { discipline?: string; floorId?: string | null },
): Promise<ConvertPdfResult> {
  const pdfBytes = await fs.readFile(pdfFilePath);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();

  if (pageCount < 1) {
    throw new Error('PDF has no pages');
  }

  const sourceId = new Types.ObjectId().toString();
  const sourcePdfUrl = await persistUpload(
    `${projectId}/source/${sourceId}.pdf`,
    pdfBytes,
    'application/pdf',
  );

  const { pdf } = await import('pdf-to-img');
  const document = await pdf(pdfFilePath, { scale: PDF_RENDER_SCALE });

  const baseName = path.parse(originalFileName).name || 'Sheet';
  const projectObjectId = new Types.ObjectId(projectId);
  const createdSheets: Sheet[] = [];
  const discipline =
    typeof options?.discipline === 'string' && options.discipline.trim()
      ? options.discipline.trim()
      : 'Other';
  const floorId =
    typeof options?.floorId === 'string' && options.floorId.trim()
      ? options.floorId.trim()
      : null;

  let sortOrder = await nextSortOrder(projectId);
  let pageNumber = 0;

  for await (const imageData of document) {
    pageNumber += 1;
    if (pageNumber > pageCount) break;

    const imageBuffer = toBuffer(imageData);
    const sheetId = new Types.ObjectId();
    const sheetIdStr = sheetId.toString();
    const originalFileUrl = await persistUpload(
      `${projectId}/${sheetIdStr}.png`,
      imageBuffer,
      'image/png',
    );

    try {
      const singlePagePdf = await PDFDocument.create();
      const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [
        pageNumber - 1,
      ]);
      singlePagePdf.addPage(copiedPage);
      const pageBytes = await singlePagePdf.save();
      await persistUpload(
        `${projectId}/${sheetIdStr}.page.pdf`,
        toBuffer(pageBytes),
        'application/pdf',
      );
    } catch (error: unknown) {
      console.error(
        `Failed to write single-page PDF for sheet ${sheetIdStr}:`,
        error,
      );
    }

    let imageWidth: number | null = null;
    let imageHeight: number | null = null;
    try {
      const meta = await sharp(imageBuffer).metadata();
      imageWidth = meta.width ?? null;
      imageHeight = meta.height ?? null;
    } catch (error: unknown) {
      console.error('Failed to read page image dimensions:', error);
    }

    let thumbnailFileUrl: string | null = null;
    try {
      const thumb = await renderSheetThumbnailJpeg(imageBuffer);
      thumbnailFileUrl = await persistUpload(
        `${projectId}/${sheetIdStr}.thumb.jpg`,
        thumb,
        'image/jpeg',
      );
    } catch (error: unknown) {
      console.error('Thumbnail generation failed:', error);
    }

    const sheetDoc = await BlueprintSheet.create({
      _id: sheetId,
      projectId: projectObjectId,
      floorId,
      name: `${baseName} - Page ${pageNumber}`,
      title: baseName,
      originalFileUrl,
      thumbnailFileUrl,
      sourcePdfUrl,
      pageNumber,
      discipline,
      sortOrder,
      calibrationScale: null,
      calibrationUnit: null,
      isFloorPlan: true,
      pageTitle: null,
      imageWidth,
      imageHeight,
      aiExtractionStatus: 'idle',
      aiExtractionError: null,
    });

    createdSheets.push(mapSheet(sheetDoc));
    sortOrder += 1;
  }

  if (createdSheets.length === 0) {
    throw new Error('Failed to convert any PDF pages to images');
  }

  return { sheets: createdSheets, pageCount };
}

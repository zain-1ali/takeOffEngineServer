import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { Types } from 'mongoose';
import { BlueprintSheet, type Sheet } from '../models/BlueprintSheet';
import { mapSheet } from '../utils/mapSheet';
import { writeSheetThumbnail } from './thumbnails';
import { enqueueAiExtraction } from '../jobs/processAiExtraction';

/** Directory for persisted page PNGs: backend/uploads */
export const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads');

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

/**
 * Convert each PDF page to a PNG + thumbnail, persist under
 * uploads/{projectId}/{sheetId}.png, and create one BlueprintSheet per page.
 */
export async function convertPdfToSheets(
  projectId: string,
  pdfFilePath: string,
  originalFileName: string,
  options?: { discipline?: string },
): Promise<ConvertPdfResult> {
  const pdfBytes = await fs.readFile(pdfFilePath);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();

  if (pageCount < 1) {
    throw new Error('PDF has no pages');
  }

  const { pdf } = await import('pdf-to-img');
  const document = await pdf(pdfFilePath, { scale: PDF_RENDER_SCALE });

  const projectUploadsDir = path.join(UPLOADS_ROOT, projectId);
  await fs.mkdir(projectUploadsDir, { recursive: true });

  const baseName = path.parse(originalFileName).name || 'Sheet';
  const projectObjectId = new Types.ObjectId(projectId);
  const createdSheets: Sheet[] = [];
  const discipline =
    typeof options?.discipline === 'string' && options.discipline.trim()
      ? options.discipline.trim()
      : 'Other';

  let sortOrder = await nextSortOrder(projectId);
  let pageNumber = 0;

  for await (const imageBuffer of document) {
    pageNumber += 1;
    if (pageNumber > pageCount) break;

    const sheetId = new Types.ObjectId();
    const sheetIdStr = sheetId.toString();
    const fileName = `${sheetIdStr}.png`;
    const absolutePath = path.join(projectUploadsDir, fileName);
    const originalFileUrl = `/uploads/${projectId}/${fileName}`;
    const pagePdfPath = path.join(projectUploadsDir, `${sheetIdStr}.page.pdf`);

    await fs.writeFile(absolutePath, imageBuffer);

    // Single-page PDF for OpenRouter file analysis (data-only extraction).
    try {
      const singlePagePdf = await PDFDocument.create();
      const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [
        pageNumber - 1,
      ]);
      singlePagePdf.addPage(copiedPage);
      const pageBytes = await singlePagePdf.save();
      await fs.writeFile(pagePdfPath, pageBytes);
    } catch (error: unknown) {
      console.error(
        `Failed to write single-page PDF for sheet ${sheetIdStr}:`,
        error,
      );
    }

    let imageWidth: number | null = null;
    let imageHeight: number | null = null;
    try {
      const meta = await sharp(absolutePath).metadata();
      imageWidth = meta.width ?? null;
      imageHeight = meta.height ?? null;
    } catch (error: unknown) {
      console.error('Failed to read page image dimensions:', error);
    }

    let thumbnailFileUrl: string | null = null;
    try {
      thumbnailFileUrl = await writeSheetThumbnail(
        absolutePath,
        projectId,
        sheetIdStr,
      );
    } catch (error: unknown) {
      console.error('Thumbnail generation failed:', error);
    }

    const sheetDoc = await BlueprintSheet.create({
      _id: sheetId,
      projectId: projectObjectId,
      name: `${baseName} - Page ${pageNumber}`,
      originalFileUrl,
      thumbnailFileUrl,
      pageNumber,
      discipline,
      sortOrder,
      calibrationScale: null,
      calibrationUnit: null,
      isFloorPlan: null,
      pageTitle: null,
      imageWidth,
      imageHeight,
      aiExtractionStatus: 'pending',
      aiExtractionError: null,
    });

    enqueueAiExtraction({
      sheetId: sheetIdStr,
      projectId,
      pagePdfPath,
      pageNumber,
    });

    createdSheets.push(mapSheet(sheetDoc));
    sortOrder += 1;
  }

  if (createdSheets.length === 0) {
    throw new Error('Failed to convert any PDF pages to images');
  }

  return { sheets: createdSheets, pageCount };
}

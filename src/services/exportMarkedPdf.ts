import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { Types } from 'mongoose';
import { LayerModel } from '../models/Layer';
import {
  BlueprintSheet,
  type BlueprintSheetDocument,
} from '../models/BlueprintSheet';
import { TakeoffItemModel } from '../models/TakeoffItem';
import { MarkupObjectModel } from '../models/MarkupObject';
import { UPLOADS_ROOT } from './pdfConversion';
import {
  buildExportOverlaySvg,
  type ExportMarkup,
  type ExportTakeoff,
  type LayerVisibilityFilter,
} from '../utils/exportOverlaySvg';
import { buildLegendEntries } from '../utils/legendEntries';
import {
  buildLayerColorMap,
  getColorForLayerId,
} from '../utils/itemLayerColor';

/** Cap long edge so huge blueprints stay memory-safe in PDF export. */
const MAX_EXPORT_EDGE = 4500;

export interface ExportVisibilityQuery {
  visibleLayerIds?: string[] | null;
  uncategorizedVisible?: boolean;
}

function resolveImageAbsolutePath(sheet: BlueprintSheetDocument): string {
  const url = sheet.originalFileUrl || '';
  // Expected: /uploads/{projectId}/{sheetId}.png
  const relative = url.replace(/^\/uploads\//, '');
  return path.join(UPLOADS_ROOT, relative);
}

function toFilter(query: ExportVisibilityQuery): LayerVisibilityFilter {
  const uncategorizedVisible = query.uncategorizedVisible !== false;
  if (query.visibleLayerIds == null) {
    return { visibleLayerIds: null, uncategorizedVisible };
  }
  return {
    visibleLayerIds: new Set(query.visibleLayerIds),
    uncategorizedVisible,
  };
}

async function loadSheetMarkupData(
  sheetId: string,
  layerColors: Map<string, string>,
): Promise<{
  takeoffs: ExportTakeoff[];
  markups: ExportMarkup[];
}> {
  const [takeoffDocs, markupDocs] = await Promise.all([
    TakeoffItemModel.find({ sheetId }).sort({ createdAt: 1 }).exec(),
    MarkupObjectModel.find({ sheetId }).sort({ createdAt: 1 }).exec(),
  ]);

  const takeoffs: ExportTakeoff[] = takeoffDocs
    .filter((doc) => Array.isArray(doc.points) && doc.points.length > 0)
    .map((doc) => ({
      type: doc.type as ExportTakeoff['type'],
      points: (doc.points ?? []).map((point) => ({
        x: point.x,
        y: point.y,
      })),
      color: getColorForLayerId(
        doc.layerId ? doc.layerId.toString() : null,
        layerColors,
      ),
      label: doc.label ?? null,
      calculatedValue: doc.calculatedValue,
      unit: doc.unit,
      layerId: doc.layerId ? doc.layerId.toString() : null,
    }));

  const markups: ExportMarkup[] = markupDocs.map((doc) => ({
    type: doc.type,
    data: (doc.data ?? {}) as Record<string, unknown>,
    color: getColorForLayerId(
      doc.layerId ? doc.layerId.toString() : null,
      layerColors,
    ),
    strokeWidth: doc.strokeWidth,
    textContent: doc.textContent ?? null,
    layerId: doc.layerId ? doc.layerId.toString() : null,
  }));

  return { takeoffs, markups };
}

/**
 * Rasterize sheet image + visible takeoff/markup overlays to a PNG buffer.
 */
export async function renderSheetMarkedPng(
  sheet: BlueprintSheetDocument,
  visibility: ExportVisibilityQuery,
): Promise<{ png: Buffer; width: number; height: number }> {
  const absolutePath = resolveImageAbsolutePath(sheet);
  await fs.access(absolutePath);

  const base = sharp(absolutePath);
  const meta = await base.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read sheet image dimensions');
  }

  let width = meta.width;
  let height = meta.height;
  const longEdge = Math.max(width, height);
  let pipeline = base;

  if (longEdge > MAX_EXPORT_EDGE) {
    const scale = MAX_EXPORT_EDGE / longEdge;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    pipeline = sharp(absolutePath).resize(width, height, { fit: 'fill' });
  }

  const layerDocs = await LayerModel.find({ projectId: sheet.projectId })
    .sort({ sortOrder: 1 })
    .exec();
  const layerColors = buildLayerColorMap(
    layerDocs.map((layer) => ({
      id: layer._id.toString(),
      color: layer.color,
    })),
  );

  const { takeoffs, markups } = await loadSheetMarkupData(
    sheet._id.toString(),
    layerColors,
  );
  const filter = toFilter(visibility);

  // Match on-screen legend: only layers used on this sheet that are currently visible.
  const legendEntries = buildLegendEntries({
    layers: layerDocs.map((layer) => ({
      id: layer._id.toString(),
      name: layer.name,
      color: layer.color,
      // When the client passes an explicit visible set, treat membership as visibility.
      visible:
        filter.visibleLayerIds == null
          ? layer.visible
          : filter.visibleLayerIds.has(layer._id.toString()),
      sortOrder: layer.sortOrder,
    })),
    objects: [...takeoffs, ...markups],
    uncategorizedVisible: filter.uncategorizedVisible,
    onlyVisible: true,
  }).map((entry) => ({ name: entry.name, color: entry.color }));

  // Scale geometry if we resized the base image.
  const scaleX = width / meta.width;
  const scaleY = height / meta.height;
  const scaledTakeoffs =
    scaleX === 1 && scaleY === 1
      ? takeoffs
      : takeoffs.map((item) => ({
          ...item,
          points: item.points.map((point) => ({
            x: point.x * scaleX,
            y: point.y * scaleY,
          })),
        }));

  const scaledMarkups =
    scaleX === 1 && scaleY === 1
      ? markups
      : markups.map((markup) => ({
          ...markup,
          strokeWidth: markup.strokeWidth * scaleX,
          data: scaleMarkupData(markup.data, scaleX, scaleY),
        }));

  const svg = buildExportOverlaySvg({
    width,
    height,
    takeoffs: scaledTakeoffs,
    markups: scaledMarkups,
    filter,
    legendEntries,
  });

  const png = await pipeline
    .composite([
      {
        input: Buffer.from(svg),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  return { png, width, height };
}

function scaleMarkupData(
  data: Record<string, unknown>,
  scaleX: number,
  scaleY: number,
): Record<string, unknown> {
  if (Array.isArray(data.points)) {
    return {
      ...data,
      points: (data.points as ExportTakeoff['points']).map((point) => ({
        x: point.x * scaleX,
        y: point.y * scaleY,
      })),
    };
  }

  const numericKeys = [
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'width',
    'height',
    'cx',
    'cy',
    'radiusX',
    'radiusY',
  ] as const;

  const next: Record<string, unknown> = { ...data };
  for (const key of numericKeys) {
    if (typeof data[key] === 'number') {
      const axisScale =
        key === 'height' ||
        key === 'radiusY' ||
        key === 'y' ||
        key === 'y1' ||
        key === 'y2' ||
        key === 'cy'
          ? scaleY
          : scaleX;
      next[key] = (data[key] as number) * axisScale;
    }
  }
  return next;
}

/** Build a single-page PDF for one sheet. */
export async function exportSheetMarkedPdf(
  sheetId: string,
  visibility: ExportVisibilityQuery,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (!Types.ObjectId.isValid(sheetId)) {
    throw new Error('Invalid sheetId');
  }

  const sheet = await BlueprintSheet.findById(sheetId).exec();
  if (!sheet) {
    throw new Error('Sheet not found');
  }

  const { png, width, height } = await renderSheetMarkedPng(sheet, visibility);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([width, height]);
  const image = await pdfDoc.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width, height });

  const bytes = await pdfDoc.save();
  const safeName = (sheet.name || 'sheet')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return {
    bytes,
    fileName: `${safeName || 'sheet'}-marked-up.pdf`,
  };
}

/** Build a multi-page PDF for every sheet in a project. */
export async function exportProjectMarkedPdf(
  projectId: string,
  visibility: ExportVisibilityQuery,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (!Types.ObjectId.isValid(projectId)) {
    throw new Error('Invalid projectId');
  }

  const sheets = await BlueprintSheet.find({ projectId })
    .sort({ sortOrder: 1, pageNumber: 1 })
    .exec();

  if (sheets.length === 0) {
    throw new Error('Project has no sheets to export');
  }

  const pdfDoc = await PDFDocument.create();

  for (const sheet of sheets) {
    const { png, width, height } = await renderSheetMarkedPng(
      sheet,
      visibility,
    );
    const page = pdfDoc.addPage([width, height]);
    const image = await pdfDoc.embedPng(png);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }

  const bytes = await pdfDoc.save();
  return {
    bytes,
    fileName: `project-${projectId}-marked-up.pdf`,
  };
}

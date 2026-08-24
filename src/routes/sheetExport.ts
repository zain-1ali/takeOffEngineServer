import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { findOwnedSheet } from '../utils/sheetOwnership';
import { TakeoffItemModel } from '../models/TakeoffItem';
import { exportSheetMarkedPdf } from '../services/exportMarkedPdf';
import {
  buildTakeoffCsv,
  csvFilenameForProject,
  type TakeoffCsvRow,
} from '../utils/csvExport';

const sheetExportRouter = Router({ mergeParams: true });

function paramId(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function parseVisibility(query: Request['query']): {
  visibleLayerIds: string[] | null;
  uncategorizedVisible: boolean;
} {
  const rawIds = query.visibleLayerIds;
  let visibleLayerIds: string[] | null = null;

  if (typeof rawIds === 'string') {
    visibleLayerIds = rawIds
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  } else if (Array.isArray(rawIds)) {
    visibleLayerIds = rawIds
      .flatMap((value) => String(value).split(','))
      .map((id) => id.trim())
      .filter(Boolean);
  }

  const uncategorizedRaw = query.uncategorizedVisible;
  const uncategorizedVisible =
    uncategorizedRaw === undefined
      ? true
      : String(uncategorizedRaw).toLowerCase() !== 'false';

  return { visibleLayerIds, uncategorizedVisible };
}

/**
 * GET /api/sheets/:sheetId/export/pdf
 * Query: visibleLayerIds=id1,id2 & uncategorizedVisible=true|false
 */
sheetExportRouter.get('/pdf', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const sheetId = paramId(req.params.sheetId);
  if (!sheetId || !Types.ObjectId.isValid(sheetId)) {
    res.status(400).json({ error: 'Invalid sheetId' });
    return;
  }

  const owned = await findOwnedSheet(sheetId, userId);
  if (!owned) {
    res.status(404).json({ error: 'Sheet not found' });
    return;
  }

  try {
    const visibility = parseVisibility(req.query);
    const { bytes, fileName } = await exportSheetMarkedPdf(sheetId, visibility);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    res.status(200).send(Buffer.from(bytes));
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to export PDF';
    console.error('Sheet marked PDF export failed:', error);
    if (message === 'Sheet not found') {
      res.status(404).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/sheets/:sheetId/export/csv
 * Quantity Takeoff Table for one sheet: Sheet Name, Type, Label, Value, Unit.
 */
sheetExportRouter.get('/csv', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const sheetId = paramId(req.params.sheetId);
  if (!sheetId || !Types.ObjectId.isValid(sheetId)) {
    res.status(400).json({ error: 'Invalid sheetId' });
    return;
  }

  const owned = await findOwnedSheet(sheetId, userId);
  if (!owned) {
    res.status(404).json({ error: 'Sheet not found' });
    return;
  }

  try {
    const items = await TakeoffItemModel.find({ sheetId: owned._id })
      .sort({ createdAt: 1 })
      .exec();
    const rows: TakeoffCsvRow[] = items.map((item) => ({
      sheetName: owned.name,
      type: item.type,
      label: item.label ?? '',
      value: item.calculatedValue,
      unit: item.unit,
    }));
    const csv = buildTakeoffCsv(rows);
    const filename = csvFilenameForProject(owned.name);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(`\uFEFF${csv}`);
  } catch (error: unknown) {
    console.error('Sheet takeoff CSV export failed:', error);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

export default sheetExportRouter;

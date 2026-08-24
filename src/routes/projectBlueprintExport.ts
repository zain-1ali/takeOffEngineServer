import { Router, type Request, type Response } from 'express';
import { BlueprintSheet } from '../models/BlueprintSheet';
import { TakeoffItemModel } from '../models/TakeoffItem';
import { exportProjectMarkedPdf } from '../services/exportMarkedPdf';
import {
  buildTakeoffCsv,
  csvFilenameForProject,
  type TakeoffCsvRow,
} from '../utils/csvExport';

const router = Router({ mergeParams: true });

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
 * GET /api/projects/:projectId/export/csv
 * Flat Quantity Takeoff Table: Sheet Name, Type, Label, Value, Unit.
 */
router.get('/csv', async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const projectId = project._id;

  try {
    const sheets = await BlueprintSheet.find({ projectId })
      .sort({ sortOrder: 1, pageNumber: 1 })
      .exec();
    const sheetIds = sheets.map((sheet) => sheet._id);
    const sheetNameById = new Map(
      sheets.map((sheet) => [sheet._id.toString(), sheet.name]),
    );

    const items =
      sheetIds.length === 0
        ? []
        : await TakeoffItemModel.find({ sheetId: { $in: sheetIds } })
            .sort({ createdAt: 1 })
            .exec();

    const rows: TakeoffCsvRow[] = items.map((item) => ({
      sheetName: sheetNameById.get(item.sheetId.toString()) ?? 'Unknown sheet',
      type: item.type,
      label: item.label ?? '',
      value: item.calculatedValue,
      unit: item.unit,
    }));

    const csv = buildTakeoffCsv(rows);
    const filename = csvFilenameForProject(project.name);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(`\uFEFF${csv}`);
  } catch (error: unknown) {
    console.error('Project takeoff CSV export failed:', error);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

/**
 * GET /api/projects/:projectId/export/marked-pdf
 * Merges all sheets into one multi-page marked-up PDF.
 */
router.get('/marked-pdf', async (req: Request, res: Response): Promise<void> => {
  const project = req.project!;
  const projectId = project._id.toString();

  try {
    const visibility = parseVisibility(req.query);
    const { bytes } = await exportProjectMarkedPdf(projectId, visibility);

    const safeProject = project.name
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeProject || 'project'}-marked-up.pdf"`,
    );
    res.status(200).send(Buffer.from(bytes));
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to export PDF';
    console.error('Project marked PDF export failed:', error);
    if (message === 'Project has no sheets to export') {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
});

export default router;

import { Router, type Request, type Response } from 'express';
import { Types, type HydratedDocument } from 'mongoose';
import {
  AiSuggestionModel,
  type AiSuggestionDocument,
} from '../models/AiSuggestion';
import { TakeoffItemModel } from '../models/TakeoffItem';
import { findOwnedSheet } from '../utils/sheetOwnership';
import { mapAiSuggestion } from '../utils/mapAiSuggestion';
import { mapTakeoffItem } from '../utils/mapTakeoffItem';
import { toImperialTakeoffQuantities } from '../utils/aiUnitConversion';

const aiSuggestionActionsRouter = Router();

const AI_TAKEOFF_COLOR = '#0e7490';

function paramId(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function asOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asRequiredFiniteNumber(value: unknown): number | null {
  const n = asOptionalNumber(value);
  if (n == null || !Number.isFinite(n)) {
    return null;
  }
  return n;
}

async function loadOwnedSuggestion(
  req: Request,
  res: Response,
): Promise<
  | {
      suggestion: HydratedDocument<AiSuggestionDocument>;
    }
  | null
> {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const id = paramId(req.params.id);
  if (!id || !Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid suggestion id' });
    return null;
  }

  const suggestion = await AiSuggestionModel.findById(id).exec();
  if (!suggestion) {
    res.status(404).json({ error: 'AI suggestion not found' });
    return null;
  }

  const sheet = await findOwnedSheet(suggestion.sheetId.toString(), userId);
  if (!sheet) {
    res.status(404).json({ error: 'AI suggestion not found' });
    return null;
  }

  return { suggestion };
}

/**
 * POST /api/ai-suggestions/:id/accept
 * Body: { confirmedX, confirmedY, label?, dimensionA?, ... }
 * Requires human-confirmed image pixel coordinates before creating takeoff.
 * Location is NEVER taken from AI approxX/approxY.
 */
aiSuggestionActionsRouter.post(
  '/:id/accept',
  async (req: Request, res: Response): Promise<void> => {
    const loaded = await loadOwnedSuggestion(req, res);
    if (!loaded) return;
    const { suggestion } = loaded;

    try {
      if (suggestion.status === 'ACCEPTED') {
        res.status(400).json({ error: 'Suggestion already accepted' });
        return;
      }
      if (suggestion.status === 'REJECTED') {
        res.status(400).json({ error: 'Suggestion was rejected' });
        return;
      }

      const labelOverride =
        typeof req.body?.label === 'string' && req.body.label.trim()
          ? req.body.label.trim()
          : null;
      const dimensionAOverride = asOptionalNumber(req.body?.dimensionA);
      const dimensionBOverride = asOptionalNumber(req.body?.dimensionB);
      const areaOverride = asOptionalNumber(req.body?.calculatedArea);
      const perimeterOverride = asOptionalNumber(req.body?.calculatedPerimeter);
      const confirmedX = asRequiredFiniteNumber(req.body?.confirmedX);
      const confirmedY = asRequiredFiniteNumber(req.body?.confirmedY);

      if (confirmedX == null || confirmedY == null) {
        res.status(400).json({
          error:
            'confirmedX and confirmedY (blueprint click location) are required to accept',
        });
        return;
      }

      const dimensionA: number | null =
        dimensionAOverride !== undefined
          ? dimensionAOverride
          : (suggestion.dimensionA ?? null);
      const dimensionB: number | null =
        dimensionBOverride !== undefined
          ? dimensionBOverride
          : (suggestion.dimensionB ?? null);
      const calculatedArea: number | null =
        areaOverride !== undefined
          ? areaOverride
          : (suggestion.calculatedArea ?? null);
      const calculatedPerimeter: number | null =
        perimeterOverride !== undefined
          ? perimeterOverride
          : (suggestion.calculatedPerimeter ?? null);

      if (calculatedArea == null || !Number.isFinite(calculatedArea)) {
        res.status(400).json({
          error: 'Suggestion has no calculatedArea to accept',
        });
        return;
      }

      const imperial = toImperialTakeoffQuantities({
        dimensionUnit: suggestion.dimensionUnit ?? 'm',
        area: calculatedArea,
        perimeter: calculatedPerimeter,
        dimensionA,
        dimensionB,
      });

      const takeoff = await TakeoffItemModel.create({
        sheetId: suggestion.sheetId,
        type: 'AREA',
        points: null,
        calculatedValue: imperial.areaSqFt,
        perimeter: imperial.perimeterFt,
        unit: imperial.unit,
        label: labelOverride ?? suggestion.label,
        color: AI_TAKEOFF_COLOR,
        source: 'AI_SUGGESTED',
        layerId: null,
        conditionId: null,
        confirmedX,
        confirmedY,
      });

      if (labelOverride) {
        suggestion.label = labelOverride;
      }
      suggestion.dimensionA = dimensionA;
      suggestion.dimensionB = dimensionB;
      suggestion.calculatedArea = calculatedArea;
      suggestion.calculatedPerimeter = calculatedPerimeter;
      suggestion.confirmedX = confirmedX;
      suggestion.confirmedY = confirmedY;
      suggestion.status = 'ACCEPTED';
      suggestion.takeoffItemId = takeoff._id;
      await suggestion.save();

      res.status(201).json({
        suggestion: mapAiSuggestion(suggestion),
        item: mapTakeoffItem(takeoff),
      });
    } catch (error: unknown) {
      console.error('Accept AI suggestion failed:', error);
      res.status(500).json({ error: 'Failed to accept AI suggestion' });
    }
  },
);

/**
 * POST /api/ai-suggestions/:id/reject
 * Marks PENDING → REJECTED; keeps the row for audit.
 */
aiSuggestionActionsRouter.post(
  '/:id/reject',
  async (req: Request, res: Response): Promise<void> => {
    const loaded = await loadOwnedSuggestion(req, res);
    if (!loaded) return;
    const { suggestion } = loaded;

    try {
      if (suggestion.status === 'ACCEPTED') {
        res.status(400).json({
          error: 'Accepted suggestions cannot be rejected',
        });
        return;
      }

      suggestion.status = 'REJECTED';
      await suggestion.save();

      res.status(200).json({ suggestion: mapAiSuggestion(suggestion) });
    } catch (error: unknown) {
      console.error('Reject AI suggestion failed:', error);
      res.status(500).json({ error: 'Failed to reject AI suggestion' });
    }
  },
);

/**
 * POST /api/ai-suggestions/:id/restore
 * REJECTED → PENDING (undo accidental reject).
 */
aiSuggestionActionsRouter.post(
  '/:id/restore',
  async (req: Request, res: Response): Promise<void> => {
    const loaded = await loadOwnedSuggestion(req, res);
    if (!loaded) return;
    const { suggestion } = loaded;

    try {
      if (suggestion.status !== 'REJECTED') {
        res.status(400).json({
          error: 'Only rejected suggestions can be restored to pending',
        });
        return;
      }

      suggestion.status = 'PENDING';
      await suggestion.save();

      res.status(200).json({ suggestion: mapAiSuggestion(suggestion) });
    } catch (error: unknown) {
      console.error('Restore AI suggestion failed:', error);
      res.status(500).json({ error: 'Failed to restore AI suggestion' });
    }
  },
);

export default aiSuggestionActionsRouter;

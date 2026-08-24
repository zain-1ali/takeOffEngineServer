import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import {
  AI_SUGGESTION_STATUSES,
  AiSuggestionModel,
  type AiSuggestionStatus,
} from '../models/AiSuggestion';
import { findOwnedSheet } from '../utils/sheetOwnership';
import { mapAiSuggestion } from '../utils/mapAiSuggestion';

const aiSuggestionsRouter = Router({ mergeParams: true });

function paramId(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function isStatus(value: unknown): value is AiSuggestionStatus {
  return (
    typeof value === 'string' &&
    (AI_SUGGESTION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * GET /api/sheets/:sheetId/ai-suggestions
 * Query: status=PENDING|ACCEPTED|REJECTED (optional — omit for all)
 */
aiSuggestionsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
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

  const sheet = await findOwnedSheet(sheetId, userId);
  if (!sheet) {
    res.status(404).json({ error: 'Sheet not found' });
    return;
  }

  try {
    const filter: {
      sheetId: string;
      status?: AiSuggestionStatus;
    } = { sheetId };

    const statusQuery = req.query.status;
    if (statusQuery !== undefined) {
      if (!isStatus(statusQuery)) {
        res.status(400).json({
          error: `status must be one of: ${AI_SUGGESTION_STATUSES.join(', ')}`,
        });
        return;
      }
      filter.status = statusQuery;
    }

    const docs = await AiSuggestionModel.find(filter)
      .sort({ createdAt: 1 })
      .exec();

    res.status(200).json(docs.map(mapAiSuggestion));
  } catch (error: unknown) {
    console.error('List AI suggestions failed:', error);
    res.status(500).json({ error: 'Failed to list AI suggestions' });
  }
});

export default aiSuggestionsRouter;

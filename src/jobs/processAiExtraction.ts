import { Types } from 'mongoose';
import {
  AiSuggestionModel,
  type AiSuggestionConfidence,
} from '../models/AiSuggestion';
import { BlueprintSheet } from '../models/BlueprintSheet';
import {
  extractRoomsFromPage,
  normalizeLabelPoint,
  sanitizeRoomDimensions,
} from '../services/aiExtraction';
import {
  enqueueBackgroundJob,
  withRetryOnce,
} from '../services/aiExtractionQueue';

export interface AiExtractionJobData {
  sheetId: string;
  projectId: string;
  /** Public upload URL of the single-page PDF (`/uploads/{projectId}/{sheetId}.page.pdf`). */
  pagePdfUrl: string;
  pageNumber: number;
}

/**
 * Run page analysis for one sheet and persist AiSuggestion rows (data-only).
 */
export async function processAiExtraction(
  data: AiExtractionJobData,
): Promise<void> {
  const { sheetId, pagePdfUrl, pageNumber } = data;

  if (!Types.ObjectId.isValid(sheetId)) {
    throw new Error(`Invalid sheetId: ${sheetId}`);
  }

  const sheet = await BlueprintSheet.findById(sheetId).exec();
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetId}`);
  }

  await BlueprintSheet.updateOne(
    { _id: sheetId },
    {
      $set: {
        aiExtractionStatus: 'processing',
        aiExtractionError: null,
      },
    },
  ).exec();

  try {
    const result = await extractRoomsFromPage(pagePdfUrl, pageNumber);

    await BlueprintSheet.updateOne(
      { _id: sheetId },
      {
        $set: {
          isFloorPlan: result.is_floor_plan,
          pageTitle: result.page_title || null,
          aiExtractionStatus: 'completed',
          aiExtractionError: null,
        },
      },
    ).exec();

    await AiSuggestionModel.deleteMany({ sheetId }).exec();

    if (result.is_floor_plan && result.rooms.length > 0) {
      await AiSuggestionModel.insertMany(
        result.rooms.map((room) => {
          const sanitized = sanitizeRoomDimensions(room);
          const confidence: AiSuggestionConfidence = sanitized.confidence;
          const { approxX, approxY } = normalizeLabelPoint(
            room.label_x,
            room.label_y,
          );
          return {
            sheetId: new Types.ObjectId(sheetId),
            label: room.room_name,
            dimensionA: sanitized.dimensionA,
            dimensionB: sanitized.dimensionB,
            dimensionUnit: sanitized.dimensionUnit,
            dimensionsRaw: room.dimensions,
            calculatedArea: sanitized.calculatedArea,
            calculatedPerimeter: sanitized.calculatedPerimeter,
            confidence,
            approxX,
            approxY,
            polygon: [],
            status: 'PENDING' as const,
          };
        }),
      );
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'AI extraction failed';
    console.error(`[aiExtraction job] sheet ${sheetId} failed:`, message);
    await BlueprintSheet.updateOne(
      { _id: sheetId },
      {
        $set: {
          aiExtractionStatus: 'failed',
          aiExtractionError: message,
        },
      },
    ).exec();
    throw error;
  }
}

/** Enqueue AI extraction on the in-memory queue (retry once). */
export function enqueueAiExtraction(data: AiExtractionJobData): void {
  enqueueBackgroundJob(async () => {
    await withRetryOnce(
      () => processAiExtraction(data),
      `ai-extraction sheet=${data.sheetId}`,
    );
  }, `ai-extraction sheet=${data.sheetId}`);
}

import type {
  AiSuggestion,
  AiSuggestionDocument,
} from '../models/AiSuggestion';

/** Map a Mongoose AiSuggestion document to the API-facing shape. */
export function mapAiSuggestion(doc: AiSuggestionDocument): AiSuggestion {
  return {
    id: doc._id.toString(),
    sheetId: doc.sheetId.toString(),
    label: doc.label,
    dimensionA: doc.dimensionA ?? null,
    dimensionB: doc.dimensionB ?? null,
    dimensionUnit: doc.dimensionUnit ?? 'm',
    dimensionsRaw: doc.dimensionsRaw ?? null,
    calculatedArea: doc.calculatedArea ?? null,
    calculatedPerimeter: doc.calculatedPerimeter ?? null,
    confidence: doc.confidence,
    status: doc.status,
    takeoffItemId: doc.takeoffItemId ? doc.takeoffItemId.toString() : null,
    approxX: doc.approxX ?? null,
    approxY: doc.approxY ?? null,
    confirmedX: doc.confirmedX ?? null,
    confirmedY: doc.confirmedY ?? null,
    promotedInstanceId: doc.promotedInstanceId
      ? doc.promotedInstanceId.toString()
      : null,
  };
}

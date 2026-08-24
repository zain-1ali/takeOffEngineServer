import type { BlueprintSheetDocument, Sheet } from '../models/BlueprintSheet';

/** Map a BlueprintSheet document to the API-facing Sheet shape. */
export function mapSheet(doc: BlueprintSheetDocument): Sheet {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    name: doc.name,
    originalFileUrl: doc.originalFileUrl,
    thumbnailFileUrl: doc.thumbnailFileUrl ?? null,
    pageNumber: doc.pageNumber,
    discipline: doc.discipline || 'Other',
    sortOrder: doc.sortOrder ?? 0,
    calibrationScale: doc.calibrationScale ?? null,
    calibrationUnit: doc.calibrationUnit ?? null,
    isFloorPlan: doc.isFloorPlan ?? null,
    pageTitle: doc.pageTitle ?? null,
    imageWidth: doc.imageWidth ?? null,
    imageHeight: doc.imageHeight ?? null,
    aiExtractionStatus: doc.aiExtractionStatus ?? 'idle',
    aiExtractionError: doc.aiExtractionError ?? null,
  };
}

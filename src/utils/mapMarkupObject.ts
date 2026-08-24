import type {
  MarkupObject,
  MarkupObjectDocument,
  MarkupType,
} from '../models/MarkupObject';

export function mapMarkupObject(doc: MarkupObjectDocument): MarkupObject {
  return {
    id: doc._id.toString(),
    sheetId: doc.sheetId.toString(),
    type: doc.type as MarkupType,
    data: (doc.data ?? {}) as MarkupObject['data'],
    color: doc.color,
    strokeWidth: doc.strokeWidth,
    textContent: doc.textContent ?? null,
    layerId: doc.layerId ? doc.layerId.toString() : null,
  };
}

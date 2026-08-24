import type { Layer, LayerDocument } from '../models/Layer';

export function mapLayer(doc: LayerDocument): Layer {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    name: doc.name,
    color: doc.color,
    visible: doc.visible,
    sortOrder: doc.sortOrder,
  };
}

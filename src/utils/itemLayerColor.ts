/** Neutral fallback when an item has no layer (ByLayer unassigned). */
export const UNASSIGNED_ITEM_COLOR = '#94a3b8';

export interface LayerColorRow {
  id: string;
  color: string;
}

export function buildLayerColorMap(
  layers: LayerColorRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const layer of layers) {
    if (typeof layer.color === 'string' && layer.color.trim()) {
      map.set(layer.id, layer.color.trim());
    }
  }
  return map;
}

/** Resolve render/export color from layer assignment (ignores stored item.color). */
export function getColorForLayerId(
  layerId: string | null | undefined,
  layerColors: Map<string, string>,
): string {
  if (layerId == null) {
    return UNASSIGNED_ITEM_COLOR;
  }
  return layerColors.get(layerId) ?? UNASSIGNED_ITEM_COLOR;
}

export const UNCATEGORIZED_LEGEND_ID = '__uncategorized__';
export const UNCATEGORIZED_LEGEND_COLOR = '#94a3b8';

export interface LegendLayerInput {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  sortOrder: number;
}

export interface LegendObjectRef {
  layerId: string | null | undefined;
}

export interface LegendEntry {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  sortOrder: number;
}

/**
 * Build legend rows from layers that are actually used by objects on a sheet.
 */
export function buildLegendEntries(input: {
  layers: LegendLayerInput[];
  objects: LegendObjectRef[];
  uncategorizedVisible?: boolean;
  /** When true, drop hidden layers entirely (PDF export). */
  onlyVisible?: boolean;
}): LegendEntry[] {
  const uncategorizedVisible = input.uncategorizedVisible !== false;
  const usedIds = new Set<string>();
  let usesUncategorized = false;

  for (const object of input.objects) {
    if (object.layerId == null) {
      usesUncategorized = true;
    } else {
      usedIds.add(object.layerId);
    }
  }

  const entries: LegendEntry[] = [];

  if (usesUncategorized) {
    if (!input.onlyVisible || uncategorizedVisible) {
      entries.push({
        id: UNCATEGORIZED_LEGEND_ID,
        name: 'Uncategorized',
        color: UNCATEGORIZED_LEGEND_COLOR,
        visible: uncategorizedVisible,
        sortOrder: -1,
      });
    }
  }

  const sorted = [...input.layers].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );

  for (const layer of sorted) {
    if (!usedIds.has(layer.id)) {
      continue;
    }
    if (input.onlyVisible && !layer.visible) {
      continue;
    }
    entries.push({
      id: layer.id,
      name: layer.name,
      color: layer.color,
      visible: layer.visible,
      sortOrder: layer.sortOrder,
    });
  }

  return entries;
}

/** Expand #RGB → #RRGGBB for Excel ARGB. */
export function hexToArgb(hex: string): string {
  const raw = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const expanded = raw
      .split('')
      .map((ch) => ch + ch)
      .join('');
    return `FF${expanded.toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `FF${raw.toUpperCase()}`;
  }
  return 'FF94A3B8';
}

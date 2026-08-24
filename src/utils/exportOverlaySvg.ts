/** Image-space point. */
export interface ExportPoint {
  x: number;
  y: number;
}

export interface ExportTakeoff {
  type: 'LINEAR' | 'AREA' | 'COUNT';
  points: ExportPoint[];
  color: string;
  label: string | null;
  calculatedValue: number;
  unit: string;
  layerId: string | null;
}

export interface ExportMarkup {
  type: string;
  data: Record<string, unknown>;
  color: string;
  strokeWidth: number;
  textContent: string | null;
  layerId: string | null;
}

export interface LayerVisibilityFilter {
  /** If null, all layer IDs are treated as visible. */
  visibleLayerIds: Set<string> | null;
  uncategorizedVisible: boolean;
}

export function isExportObjectVisible(
  layerId: string | null | undefined,
  filter: LayerVisibilityFilter,
): boolean {
  if (layerId == null) {
    return filter.uncategorizedVisible;
  }
  if (filter.visibleLayerIds == null) {
    return true;
  }
  return filter.visibleLayerIds.has(layerId);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatMeasuredValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toPrecision(6).replace(/\.?0+$/, '');
}

function takeoffLabelText(item: ExportTakeoff): string {
  const name = item.label?.trim() || item.type;
  return `${name} — ${formatMeasuredValue(item.calculatedValue)} ${item.unit}`;
}

function centroid(points: ExportPoint[]): ExportPoint {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function midpoint(a: ExportPoint, b: ExportPoint): ExportPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function pointsToPolyline(points: ExportPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function labelGroup(
  x: number,
  y: number,
  text: string,
  _color: string,
  fontSize: number,
): string {
  const safe = escapeXml(text);
  const padX = 4;
  const padY = 3;
  const approxWidth = Math.max(40, safe.length * fontSize * 0.55);
  const height = fontSize + padY * 2;
  return [
    `<g>`,
    `<rect x="${x}" y="${y - fontSize - padY}" width="${approxWidth + padX * 2}" height="${height}" fill="#0c1b2a" fill-opacity="0.78" rx="2" />`,
    `<text x="${x + padX}" y="${y - padY - 2}" fill="#f5f7fa" font-size="${fontSize}" font-family="Arial, Helvetica, sans-serif" font-weight="700">${safe}</text>`,
    `</g>`,
  ].join('');
}

function renderTakeoff(
  item: ExportTakeoff,
  strokeScale: number,
  fontSize: number,
): string {
  const color = escapeXml(item.color || '#22c55e');
  const stroke = Math.max(2, strokeScale);
  const label = takeoffLabelText(item);
  const parts: string[] = [];

  if (item.type === 'LINEAR' && item.points.length >= 2) {
    parts.push(
      `<polyline points="${pointsToPolyline(item.points)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" />`,
    );
    const mid = midpoint(item.points[0], item.points[item.points.length - 1]);
    parts.push(labelGroup(mid.x + 6, mid.y - 6, label, color, fontSize));
  } else if (item.type === 'AREA' && item.points.length >= 3) {
    parts.push(
      `<polygon points="${pointsToPolyline(item.points)}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round" />`,
    );
    const c = centroid(item.points);
    parts.push(labelGroup(c.x, c.y, label, color, fontSize));
  } else if (item.type === 'COUNT') {
    let index = 0;
    for (const point of item.points) {
      index += 1;
      const r = Math.max(8, stroke * 3);
      parts.push(
        `<circle cx="${point.x}" cy="${point.y}" r="${r}" fill="${color}" stroke="#0c1b2a" stroke-width="1.5" />`,
      );
      parts.push(
        `<text x="${point.x}" y="${point.y + fontSize * 0.35}" text-anchor="middle" fill="#0c1b2a" font-size="${fontSize}" font-family="Arial, Helvetica, sans-serif" font-weight="700">${index}</text>`,
      );
    }
    if (item.points[0]) {
      parts.push(
        labelGroup(
          item.points[0].x + 12,
          item.points[0].y - 10,
          label,
          color,
          fontSize,
        ),
      );
    }
  }

  return parts.join('\n');
}

function renderMarkup(
  markup: ExportMarkup,
  strokeScale: number,
  fontSize: number,
): string {
  const color = escapeXml(markup.color || '#e29a12');
  const stroke = Math.max(
    1,
    Number.isFinite(markup.strokeWidth) ? markup.strokeWidth : strokeScale,
  );
  const data = markup.data ?? {};

  if (markup.type === 'FREEHAND') {
    const points = Array.isArray(data.points)
      ? (data.points as ExportPoint[])
      : [];
    if (points.length < 2) {
      return '';
    }
    return `<polyline points="${pointsToPolyline(points)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" />`;
  }

  if (markup.type === 'POLYGON') {
    const points = Array.isArray(data.points)
      ? (data.points as ExportPoint[])
      : [];
    if (points.length < 3) {
      return '';
    }
    return `<polygon points="${pointsToPolyline(points)}" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round" />`;
  }

  if (markup.type === 'LINE') {
    const { x1, y1, x2, y2 } = data as {
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
    };
    if ([x1, y1, x2, y2].some((v) => typeof v !== 'number')) {
      return '';
    }
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" />`;
  }

  if (markup.type === 'RECTANGLE') {
    const { x, y, width, height } = data as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    };
    if ([x, y, width, height].some((v) => typeof v !== 'number')) {
      return '';
    }
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="${color}" stroke-width="${stroke}" />`;
  }

  if (markup.type === 'ELLIPSE') {
    const { cx, cy, radiusX, radiusY } = data as {
      cx?: number;
      cy?: number;
      radiusX?: number;
      radiusY?: number;
    };
    if ([cx, cy, radiusX, radiusY].some((v) => typeof v !== 'number')) {
      return '';
    }
    return `<ellipse cx="${cx}" cy="${cy}" rx="${radiusX}" ry="${radiusY}" fill="none" stroke="${color}" stroke-width="${stroke}" />`;
  }

  if (markup.type === 'TEXT') {
    const { x, y } = data as { x?: number; y?: number };
    const text = markup.textContent?.trim() ?? '';
    if (typeof x !== 'number' || typeof y !== 'number' || !text) {
      return '';
    }
    return labelGroup(x, y, text, color, fontSize);
  }

  return '';
}

export interface ExportLegendEntry {
  name: string;
  color: string;
}

function renderLegendBox(
  width: number,
  height: number,
  entries: ExportLegendEntry[],
): string {
  if (entries.length === 0) {
    return '';
  }

  const pad = Math.max(10, Math.round(width / 180));
  const rowH = Math.max(18, Math.round(height / 55));
  const titleH = Math.max(22, Math.round(rowH * 1.15));
  const swatch = Math.max(12, Math.round(rowH * 0.7));
  const fontSize = Math.max(11, Math.round(rowH * 0.62));
  const titleSize = Math.max(12, Math.round(fontSize * 1.1));
  const boxW = Math.min(
    Math.round(width * 0.32),
    Math.max(160, Math.round(width * 0.22)),
  );
  const boxH = pad * 2 + titleH + entries.length * rowH + pad;
  const boxX = width - boxW - pad * 1.5;
  const boxY = height - boxH - pad * 1.5;

  const rows: string[] = [];
  rows.push(
    `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" fill="#faf8f3" fill-opacity="0.96" stroke="#0c1b2a" stroke-width="${Math.max(2, width / 900)}" />`,
  );
  rows.push(
    `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${titleH + pad * 0.4}" fill="#0c1b2a" />`,
  );
  rows.push(
    `<text x="${boxX + pad}" y="${boxY + pad + titleSize * 0.85}" fill="#faf8f3" font-size="${titleSize}" font-family="Arial, Helvetica, sans-serif" font-weight="700">LEGEND — Color key</text>`,
  );

  entries.forEach((entry, index) => {
    const y = boxY + pad + titleH + index * rowH;
    const color = escapeXml(entry.color || '#94a3b8');
    const name = escapeXml(entry.name);
    rows.push(
      `<rect x="${boxX + pad}" y="${y + (rowH - swatch) / 2}" width="${swatch}" height="${swatch}" fill="${color}" stroke="#0c1b2a" stroke-width="1" />`,
    );
    rows.push(
      `<text x="${boxX + pad + swatch + 8}" y="${y + rowH * 0.72}" fill="#0c1b2a" font-size="${fontSize}" font-family="Arial, Helvetica, sans-serif" font-weight="600">${name}</text>`,
    );
  });

  return `<g id="legend">${rows.join('\n')}</g>`;
}

/**
 * Build a transparent SVG overlay matching the sheet image pixel size.
 */
export function buildExportOverlaySvg(options: {
  width: number;
  height: number;
  takeoffs: ExportTakeoff[];
  markups: ExportMarkup[];
  filter: LayerVisibilityFilter;
  legendEntries?: ExportLegendEntry[];
}): string {
  const { width, height, takeoffs, markups, filter, legendEntries = [] } =
    options;
  const strokeScale = Math.max(2, width / 800);
  const fontSize = Math.max(12, Math.round(width / 90));

  const shapes: string[] = [];

  for (const item of takeoffs) {
    if (!isExportObjectVisible(item.layerId, filter)) {
      continue;
    }
    shapes.push(renderTakeoff(item, strokeScale, fontSize));
  }

  for (const markup of markups) {
    if (!isExportObjectVisible(markup.layerId, filter)) {
      continue;
    }
    shapes.push(renderMarkup(markup, strokeScale, fontSize));
  }

  shapes.push(renderLegendBox(width, height, legendEntries));

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...shapes.filter(Boolean),
    `</svg>`,
  ].join('\n');
}

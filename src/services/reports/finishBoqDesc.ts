/**
 * Finish BOQ description templates — same role as ELEMENT_META concreteDesc /
 * formworkDesc / rebarDesc for structural elements. Spec-dropdown keys map to
 * trade-standard wording (starting templates; refine with client feedback).
 */
import type { FinishKind } from '../../engines/finishes';

/** Screed bed thickness from project materials (m) → whole millimetres. */
export function screedThicknessMm(screedThicknessM: number | undefined | null): number {
  const m = Number(screedThicknessM);
  if (!Number.isFinite(m) || m <= 0) return 50;
  return Math.round(m * 1000);
}

/** Floor screed line when measured separately (screed + tiling split). */
export function floorScreedBoqDesc(screedThicknessM?: number | null): string {
  const mm = screedThicknessMm(screedThicknessM);
  return `Cement and sand screed to floor, ${mm}mm thick, to receive tiling`;
}

/** Floor tiling line when measured separately. */
export function floorTilesBoqDesc(spec: string): string {
  const s = (spec || '').toLowerCase();
  if (/porcelain/i.test(s)) {
    return 'Porcelain floor tiles, bedded and pointed in cement mortar';
  }
  // Default ceramic (incl. "Cement screed + ceramic tiles")
  return 'Ceramic floor tiles, bedded and pointed in cement mortar';
}

/** Single-line floor finish BOQ (no screed/tiles split). */
export function floorAreaBoqDesc(spec: string, screedThicknessM?: number | null): string {
  const s = (spec || '').trim();
  const mm = screedThicknessMm(screedThicknessM);
  const key = s.toLowerCase();

  if (/granolithic/i.test(key)) {
    return `Granolithic screed to floor, ${mm}mm thick, trowelled smooth`;
  }
  if (/terrazzo/i.test(key)) {
    return 'Terrazzo floor finish, including screed bed, ground and polished';
  }
  if (/vinyl/i.test(key)) {
    return `Vinyl sheet flooring on cement and sand screed, ${mm}mm thick screed bed`;
  }
  if (/screed/i.test(key) && /tile/i.test(key)) {
    // Fallback if split path not taken
    return floorScreedBoqDesc(screedThicknessM);
  }
  if (/screed/i.test(key)) {
    return `Cement and sand screed to floor, ${mm}mm thick`;
  }
  if (s) return s;
  return 'Floor finish';
}

export function wallAreaBoqDesc(spec: string): string {
  const s = (spec || '').trim();
  const key = s.toLowerCase();

  if (/ceramic/i.test(key) && /tile/i.test(key)) {
    return 'Ceramic wall tiles, bedded and pointed in cement mortar';
  }
  if (/fair-?face/i.test(key) || (/paint only/i.test(key) && !/plaster/i.test(key))) {
    return 'Emulsion paint to fair-face walls, including preparation';
  }
  if (/gypsum/i.test(key)) {
    return 'Gypsum plaster to walls, including emulsion paint finish';
  }
  if (/cement\/?\s*sand|plaster/i.test(key) && /emulsion|paint/i.test(key)) {
    return 'Cement and sand plaster to walls, including emulsion paint finish';
  }
  if (/plaster/i.test(key)) {
    return 'Plaster to walls, including emulsion paint finish';
  }
  if (s) return s;
  return 'Wall finish';
}

export function ceilingAreaBoqDesc(spec: string): string {
  const s = (spec || '').trim();
  const key = s.toLowerCase();

  if (/suspended|mineral tile|grid/i.test(key)) {
    return 'Suspended ceiling grid with mineral fibre tiles, including hangers and perimeter trim';
  }
  if (/gypsum board|plasterboard/i.test(key)) {
    return 'Gypsum board ceiling, skimmed and emulsion painted';
  }
  if (/pvc/i.test(key)) {
    return 'PVC panel ceiling lining, including suspension and trim';
  }
  if (/plaster/i.test(key) && /paint|emulsion/i.test(key)) {
    return 'Plaster to soffits, including emulsion paint finish';
  }
  if (/plaster/i.test(key)) {
    return 'Plaster to soffits';
  }
  if (s) return s;
  return 'Ceiling finish';
}

/**
 * Resolve BOQ description for a finish line.
 * @param part - 'screed' | 'tiles' for multi-material floor split; 'area' otherwise
 */
export function finishBoqDesc(
  kind: FinishKind,
  spec: string,
  opts: {
    part?: 'screed' | 'tiles' | 'area';
    screedThicknessM?: number | null;
  } = {},
): string {
  const part = opts.part || 'area';
  if (kind === 'FLOOR') {
    if (part === 'screed') return floorScreedBoqDesc(opts.screedThicknessM);
    if (part === 'tiles') return floorTilesBoqDesc(spec);
    return floorAreaBoqDesc(spec, opts.screedThicknessM);
  }
  if (kind === 'WALL') return wallAreaBoqDesc(spec);
  return ceilingAreaBoqDesc(spec);
}

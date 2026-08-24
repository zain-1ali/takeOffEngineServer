/**
 * Normalize one side of a dimensions pair.
 * Commas are thousands separators ("3,765" → 3765), never decimals.
 */
export function parseDimensionToken(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  // "3,765" / "12,345,678" — strip thousand commas
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  // Mixed forms like "3,765.5" (thousand commas + decimal point)
  if (trimmed.includes(',') && /^\d[\d,]*(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Parse AI dimensions strings like "3765x2851", "3,765 x 2,851", or "3.4×4.2". */
export function parseDimensionPair(
  dimensions: string,
): { a: number | null; b: number | null } {
  const match =
    /([\d,.]+)\s*[x×X]\s*([\d,.]+)/.exec(dimensions.trim()) ??
    /([\d,.]+)\s+([\d,.]+)/.exec(dimensions.trim());
  if (!match) {
    return { a: null, b: null };
  }
  return {
    a: parseDimensionToken(match[1]),
    b: parseDimensionToken(match[2]),
  };
}

/** Suspiciously small for construction dims printed in mm. */
const SUSPICIOUS_MM_MAX = 50;

export interface SanitizedRoomDimensions {
  dimensionA: number | null;
  dimensionB: number | null;
  calculatedArea: number;
  calculatedPerimeter: number;
  dimensionUnit: string;
  confidence: 'high' | 'medium' | 'low';
  warned: boolean;
}

/**
 * Defensive sanitize before persist:
 * - Strip comma thousands separators when parsing dimensions
 * - Recompute area/perimeter from corrected A×B when possible
 * - If values look tiny for mm AND the raw text had a comma, flag low confidence
 */
export function sanitizeRoomDimensions(room: {
  dimensions: string;
  calculated_area: number;
  perimeter: number;
}): SanitizedRoomDimensions {
  const raw = room.dimensions ?? '';
  const hadComma = raw.includes(',');
  const dims = parseDimensionPair(raw);
  const dimensionA = dims.a;
  const dimensionB = dims.b;
  let warned = false;
  let confidence: 'high' | 'medium' | 'low' = 'medium';

  const looksTiny =
    (dimensionA != null && dimensionA > 0 && dimensionA < SUSPICIOUS_MM_MAX) ||
    (dimensionB != null && dimensionB > 0 && dimensionB < SUSPICIOUS_MM_MAX);

  if (looksTiny && hadComma) {
    warned = true;
    confidence = 'low';
    console.warn(
      '[aiExtraction] Suspiciously small dimension with comma in raw text — possible thousands-separator misread:',
      {
        dimensions: raw,
        dimensionA,
        dimensionB,
      },
    );
  }

  // Prefer geometry from corrected linear dims when both sides are present.
  let calculatedArea = room.calculated_area;
  let calculatedPerimeter = room.perimeter;
  if (
    dimensionA != null &&
    dimensionB != null &&
    dimensionA > 0 &&
    dimensionB > 0
  ) {
    calculatedArea = dimensionA * dimensionB;
    calculatedPerimeter = 2 * (dimensionA + dimensionB);
  }

  // Whole-number room dims in the thousands are almost always mm on these plans.
  const looksLikeMm =
    (dimensionA != null && dimensionA >= 100) ||
    (dimensionB != null && dimensionB >= 100);

  return {
    dimensionA,
    dimensionB,
    calculatedArea,
    calculatedPerimeter,
    dimensionUnit: looksLikeMm ? 'mm' : 'm',
    confidence,
    warned,
  };
}

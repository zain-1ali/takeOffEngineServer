/** AI extraction returns metric lengths/areas (m / m² or mm / mm²). */

export const METERS_TO_FEET = 3.280839895;
export const SQ_METERS_TO_SQ_FEET = METERS_TO_FEET * METERS_TO_FEET;
export const MM_TO_FEET = METERS_TO_FEET / 1000;
export const SQ_MM_TO_SQ_FEET = MM_TO_FEET * MM_TO_FEET;

export function metersToFeet(meters: number): number {
  return meters * METERS_TO_FEET;
}

export function sqMetersToSqFeet(sqMeters: number): number {
  return sqMeters * SQ_METERS_TO_SQ_FEET;
}

export function mmToFeet(mm: number): number {
  return mm * MM_TO_FEET;
}

export function sqMmToSqFeet(sqMm: number): number {
  return sqMm * SQ_MM_TO_SQ_FEET;
}

function isMmUnit(unit: string): boolean {
  const u = unit.trim().toLowerCase();
  return u === "mm" || u === "millimeter" || u === "millimeters" || u === "mm²" || u === "mm2";
}

function isMeterUnit(unit: string): boolean {
  const u = unit.trim().toLowerCase();
  return (
    u === "" ||
    u === "m" ||
    u === "meter" ||
    u === "meters" ||
    u === "m²" ||
    u === "m2" ||
    u === "sq m"
  );
}

/**
 * Convert AI linear/area values into feet / sq ft for storage on takeoff items.
 * Supports meters and millimeters; imperial-looking units pass through.
 */
export function toImperialTakeoffQuantities(input: {
  dimensionUnit: string;
  area: number;
  perimeter: number | null;
  dimensionA: number | null;
  dimensionB: number | null;
}): {
  areaSqFt: number;
  perimeterFt: number | null;
  dimensionAFt: number | null;
  dimensionBFt: number | null;
  unit: string;
} {
  if (isMmUnit(input.dimensionUnit)) {
    return {
      areaSqFt: sqMmToSqFeet(input.area),
      perimeterFt:
        input.perimeter == null ? null : mmToFeet(input.perimeter),
      dimensionAFt:
        input.dimensionA == null ? null : mmToFeet(input.dimensionA),
      dimensionBFt:
        input.dimensionB == null ? null : mmToFeet(input.dimensionB),
      unit: "sq ft",
    };
  }

  if (!isMeterUnit(input.dimensionUnit)) {
    return {
      areaSqFt: input.area,
      perimeterFt: input.perimeter,
      dimensionAFt: input.dimensionA,
      dimensionBFt: input.dimensionB,
      unit: "sq ft",
    };
  }

  return {
    areaSqFt: sqMetersToSqFeet(input.area),
    perimeterFt:
      input.perimeter == null ? null : metersToFeet(input.perimeter),
    dimensionAFt:
      input.dimensionA == null ? null : metersToFeet(input.dimensionA),
    dimensionBFt:
      input.dimensionB == null ? null : metersToFeet(input.dimensionB),
    unit: "sq ft",
  };
}

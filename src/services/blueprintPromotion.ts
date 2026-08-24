import type { IProject } from '../models/Project';

export type PromotionMeasurementType = 'AREA' | 'LINEAR';

export interface BlueprintPromotionOption {
  elementKey: string;
  label: string;
  measurementType: PromotionMeasurementType;
  mappedField: string;
}

type PromotionDefinition = BlueprintPromotionOption & {
  markPrefix: string;
  shape: string;
  geometry: (valueMetric: number, label: string) => Record<string, unknown>;
  spec?: string | null;
  location?: string | null;
  structural?: boolean;
  reinforcement?: Record<string, unknown> | null;
};

const AREA_DEFINITIONS: PromotionDefinition[] = [
  {
    elementKey: 'FLOOR_FINISH',
    label: 'Floor Finish',
    measurementType: 'AREA',
    mappedField: 'areaOverride',
    markPrefix: 'FF',
    shape: 'AREA',
    geometry: (areaOverride, label) => ({
      roomLabel: label,
      roomLength: 5,
      roomWidth: 4,
      openingArea: 0,
      areaOverride,
    }),
    spec: 'Cement screed + ceramic tiles',
  },
  {
    elementKey: 'WALL_FINISH',
    label: 'Wall Finish',
    measurementType: 'AREA',
    mappedField: 'areaOverride',
    markPrefix: 'WF',
    shape: 'AREA',
    geometry: (areaOverride, label) => ({
      roomLabel: label,
      wallLength: 12,
      wallHeight: 3,
      openingArea: 0,
      areaOverride,
    }),
    spec: 'Cement/sand plaster + emulsion paint',
    location: 'Interior',
  },
  {
    elementKey: 'CEILING_FINISH',
    label: 'Ceiling Finish',
    measurementType: 'AREA',
    mappedField: 'areaOverride',
    markPrefix: 'CF',
    shape: 'AREA',
    geometry: (areaOverride, label) => ({
      roomLabel: label,
      roomLength: 5,
      roomWidth: 4,
      openingArea: 0,
      areaOverride,
    }),
    spec: 'Plaster + emulsion paint',
  },
  {
    elementKey: 'MASONRY',
    label: 'Masonry / Infill Walls',
    measurementType: 'AREA',
    mappedField: 'areaOverride',
    markPrefix: 'MW',
    shape: 'LINEAR',
    geometry: (areaOverride, label) => ({
      roomLabel: label,
      wallLength: 8,
      wallHeight: 3,
      thickness: 0.2,
      openingArea: 0,
      areaOverride,
    }),
    spec: 'Concrete block 200mm',
    location: 'Interior',
  },
];

const LINEAR_DEFINITIONS: PromotionDefinition[] = [
  {
    elementKey: 'WALLS',
    label: 'RC Walls',
    measurementType: 'LINEAR',
    mappedField: 'length',
    markPrefix: 'W',
    shape: 'LINEAR',
    geometry: (length) => ({ length, thickness: 0.25, height: 3 }),
    location: 'Interior',
    structural: true,
    reinforcement: {
      cover: 40,
      vertBars: [{ diameterMm: 12, spacingMm: 200 }],
      horizBars: [{ diameterMm: 12, spacingMm: 250 }],
      bothFaces: true,
    },
  },
  {
    elementKey: 'MASONRY',
    label: 'Masonry / Infill Walls',
    measurementType: 'LINEAR',
    mappedField: 'wallLength',
    markPrefix: 'MW',
    shape: 'LINEAR',
    geometry: (wallLength) => ({
      wallLength,
      wallHeight: 3,
      thickness: 0.2,
      openingArea: 0,
    }),
    spec: 'Concrete block 200mm',
    location: 'Interior',
  },
  {
    elementKey: 'BEAMS',
    label: 'Beams',
    measurementType: 'LINEAR',
    mappedField: 'spanLength',
    markPrefix: 'B',
    shape: 'RECTANGULAR',
    geometry: (spanLength) => ({ spanLength, width: 0.3, depth: 0.5 }),
    structural: true,
    reinforcement: {
      cover: 40,
      topBars: [{ diameterMm: 16, barCount: 2 }],
      bottomBars: [{ diameterMm: 20, barCount: 3 }],
      linkDia: 8,
      linkSpacing: 200,
    },
  },
  {
    elementKey: 'STRIP_FOOTING',
    label: 'Strip Foundation',
    measurementType: 'LINEAR',
    mappedField: 'length',
    markPrefix: 'SF',
    shape: 'FLAT',
    geometry: (length) => ({ length, width: 0.6, height: 0.3 }),
    structural: true,
    reinforcement: {
      cover: 50,
      mainBars: [{ diameterMm: 12, spacingMm: 150 }],
      distBars: [{ diameterMm: 12, spacingMm: 250 }],
    },
  },
  {
    elementKey: 'STONE_STRIP',
    label: 'Stone Strip Foundation',
    measurementType: 'LINEAR',
    mappedField: 'length',
    markPrefix: 'STF',
    shape: 'RECTANGULAR',
    geometry: (length) => ({
      length,
      width: 0.6,
      height: 0.6,
      hasBlinding: true,
    }),
  },
  {
    elementKey: 'PILES',
    label: 'Piles',
    measurementType: 'LINEAR',
    mappedField: 'pileLength',
    markPrefix: 'P',
    shape: 'CIRCULAR_BORED',
    geometry: (pileLength) => ({ pileLength, diameter: 0.6 }),
    structural: true,
    reinforcement: {
      cover: 50,
      longBarCount: 8,
      longBarDia: 16,
      linkDia: 8,
      linkSpacing: 200,
    },
  },
  {
    elementKey: 'EARTHWORKS',
    label: 'Earthworks — Linear Trench',
    measurementType: 'LINEAR',
    mappedField: 'length',
    markPrefix: 'EW',
    shape: 'LINEAR_TRENCH',
    geometry: (length) => ({ length, trenchWidth: 0.6, depth: 1.5 }),
  },
  {
    elementKey: 'LINTELS',
    label: 'Lintels',
    measurementType: 'LINEAR',
    mappedField: 'length',
    markPrefix: 'LN',
    shape: 'PRECAST',
    geometry: (length) => ({
      clearSpan: Math.max(0, length - 0.3),
      bearingEach: 0.15,
      length,
      width: 0.2,
      depth: 0.15,
    }),
    structural: true,
  },
  {
    elementKey: 'SKIRTING',
    label: 'Skirting / Baseboards',
    measurementType: 'LINEAR',
    mappedField: 'perimeter',
    markPrefix: 'SK',
    shape: 'RUN',
    geometry: (perimeter, label) => ({
      roomLabel: label,
      roomLength: 5,
      roomWidth: 4,
      perimeter,
      doorDeductionLm: 0,
      cornerCount: 4,
    }),
    spec: 'Timber skirting',
  },
  {
    elementKey: 'DUCTS',
    label: 'Air Distribution Ducts',
    measurementType: 'LINEAR',
    mappedField: 'length',
    markPrefix: 'DU',
    shape: 'RUN',
    geometry: (length) => ({
      system: 'Supply',
      section: 'Rectangular',
      width: 0.4,
      height: 0.3,
      diameter: 0.3,
      length,
      jointSpacing: 1.2,
    }),
    spec: 'Galvanised steel duct',
  },
  {
    elementKey: 'PIPES',
    label: 'Pipes & Plumbing',
    measurementType: 'LINEAR',
    mappedField: 'length',
    markPrefix: 'PP',
    shape: 'RUN',
    geometry: (length) => ({
      system: 'Cold water',
      material: 'uPVC',
      diameterMm: 50,
      length,
      insulated: 'Yes',
      fittingsNos: 0,
    }),
    spec: 'uPVC',
  },
  {
    elementKey: 'ELECTRICAL',
    label: 'Conduits & Cable Trays',
    measurementType: 'LINEAR',
    mappedField: 'length',
    markPrefix: 'EL',
    shape: 'CONDUIT',
    geometry: (length) => ({ sizeMm: 25, length }),
    spec: 'PVC conduit',
  },
];

const DEFINITIONS = [...AREA_DEFINITIONS, ...LINEAR_DEFINITIONS];

export function promotionOptions(
  measurementType: PromotionMeasurementType,
): BlueprintPromotionOption[] {
  return DEFINITIONS.filter(
    (definition) => definition.measurementType === measurementType,
  ).map(({ elementKey, label, measurementType: type, mappedField }) => ({
    elementKey,
    label,
    measurementType: type,
    mappedField,
  }));
}

export function promotionDefinition(
  elementKey: string,
  measurementType: PromotionMeasurementType,
): PromotionDefinition | null {
  return (
    DEFINITIONS.find(
      (definition) =>
        definition.elementKey === elementKey &&
        definition.measurementType === measurementType,
    ) ?? null
  );
}

export function measurementValueToMetric(
  value: number,
  unit: string,
  measurementType: PromotionMeasurementType,
): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Measurement value must be a positive number');
  }
  const normalized = unit.trim().toLowerCase().replace(/\s+/g, ' ');

  if (measurementType === 'AREA') {
    if (['m²', 'm2', 'sq m', 'sqm'].includes(normalized)) return value;
    if (['ft²', 'ft2', 'sq ft', 'sqft'].includes(normalized)) {
      return value * 0.09290304;
    }
    if (['in²', 'in2', 'sq in', 'sqin'].includes(normalized)) {
      return value * 0.00064516;
    }
    throw new Error(`Unsupported area unit: ${unit}`);
  }

  if (['m', 'meter', 'meters'].includes(normalized)) return value;
  if (['ft', 'foot', 'feet'].includes(normalized)) return value * 0.3048;
  if (['in', 'inch', 'inches'].includes(normalized)) return value * 0.0254;
  throw new Error(`Unsupported length unit: ${unit}`);
}

export function buildPromotedInstancePayload(input: {
  definition: PromotionDefinition;
  metricValue: number;
  label: string;
  project: IProject;
}): {
  shape: string;
  geometry: Record<string, unknown>;
  concreteGrade: string | null;
  reinforcement: Record<string, unknown> | null;
  spec: string | null;
  location: string | null;
  markPrefix: string;
} {
  const { definition, metricValue, label, project } = input;
  return {
    shape: definition.shape,
    geometry: definition.geometry(metricValue, label),
    concreteGrade: definition.structural
      ? project.materials?.defaultConcreteGrade || 'C25/30'
      : null,
    reinforcement: definition.reinforcement ?? null,
    spec: definition.spec ?? null,
    location: definition.location ?? null,
    markPrefix: definition.markPrefix,
  };
}

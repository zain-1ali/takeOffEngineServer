/** Shared engine types */

export type RebarGroup = {
  diameterMm: number;
  weightKg: number;
  role: string;
};

export type BarSet = {
  diameterMm: number;
  barCount: number;
  weightKg: number;
};

export type ConcreteResult = {
  netVolumeM3: number;
  formworkAreaM2: number;
  breakdown: Record<string, number>;
};

export type StructuralCalcResult = {
  perUnit: {
    concrete: ConcreteResult;
    rebar: {
      groups: RebarGroup[];
      totalWeightKg: number;
      densityKgPerM3: number;
      [key: string]: unknown;
    };
  };
  count: number;
  totalVolumeM3: number;
  /** Soffit + vertical (unchanged total for BOQ formwork area). */
  totalFormworkM2: number;
  /** Horizontal / sloping soffit — soffit prop allowance. */
  totalSoffitFormworkM2: number;
  /** Side/edge/vertical faces — bracing allowance. */
  totalVerticalFormworkM2: number;
  totalRebarKg: number;
};

/** Project materials knobs read by masonry / finishes (mirrors state.materials). */
export type MaterialsConfig = {
  stoneMortarFraction?: number;
  blindingThickness?: number;
  screedThickness?: number;
  plasterThickness?: number;
  paintCoats?: number;
  tileWastage?: number;
  earthworkBulkingFactor?: number;
};

export const DEFAULT_MATERIALS: Required<MaterialsConfig> = {
  stoneMortarFraction: 0.3,
  blindingThickness: 0.05,
  screedThickness: 0.05,
  plasterThickness: 0.015,
  paintCoats: 2,
  tileWastage: 0.1,
  earthworkBulkingFactor: 0.25,
};

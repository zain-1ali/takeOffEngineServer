import mongoose, { Document, Schema, Types } from 'mongoose';
import type { ConcreteMix, FinishWetMix, MortarMix } from '../defaults/mixDefaults';
import {
  DEFAULT_GRID,
  DEFAULT_MATERIALS,
  DEFAULT_RATE_LIB,
} from '../defaults/projectDefaults';
import { DEFAULT_CASCADE_PERCENTS } from '../services/costPlan/cascade';
import { DEFAULT_REPORT_THEME } from '../services/costPlan/reportThemes';

export type AxisLine = { label: string; spacing: number };

export type ProjectMaterials = {
  concreteClasses: string[];
  defaultConcreteGrade: string;
  stoneMortarRatio: string;
  stoneMortarFraction: number;
  blindingThickness: number;
  screedThickness: number;
  plasterThickness: number;
  paintCoats: number;
  tileWastage: number;
  earthworkBulkingFactor: number;
  /** Draft kg/m² allowances — BOM uses applied_* until revision bump. */
  verticalBracingRate: number;
  soffitPropRate: number;
  appliedVerticalBracingRate: number;
  appliedSoffitPropRate: number;
  concreteMixes: Record<string, ConcreteMix>;
  appliedConcreteMixes: Record<string, ConcreteMix>;
  mortarMix: MortarMix;
  appliedMortarMix: MortarMix;
  screedMix: FinishWetMix;
  appliedScreedMix: FinishWetMix;
  plasterMix: FinishWetMix;
  appliedPlasterMix: FinishWetMix;
  appliedStoneMortarRatio: string;
  appliedStoneMortarFraction: number;
};

export type CurrencyConversionLogEntry = {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rateUsed: number;
  rateDate: string;
  timestamp: Date;
  triggeredBy: string;
};

export interface IProject extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  number: string;
  client: string;
  contractor: string;
  consultant: string;
  location: string;
  currency: string;
  /** Canonical: `metric` | `imperial` (legacy free-text still accepted via parseUnitSystem). */
  units: string;
  preparedBy: string;
  revision: string;
  date: string;
  /** Gross Floor Area (m²) for Cost Plan Rate/m². Null = omit the column. */
  gfaM2: number | null;
  /** Cost Plan cascade — percentage points (6 = 6%). */
  designAllowancePercent: number;
  overheadPercent: number;
  profitPercent: number;
  inflationPercent: number;
  /** Cost Plan / bill PDF color theme id. */
  reportTheme: string;
  materials: ProjectMaterials;
  rateLib: typeof DEFAULT_RATE_LIB;
  useRateAnalysis: boolean;
  grid: { xAxes: AxisLine[]; yAxes: AxisLine[] };
  currencyConversionLog: CurrencyConversionLogEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const axisSchema = new Schema(
  {
    label: { type: String, required: true },
    spacing: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const mortarMixSchema = new Schema(
  {
    cementBagsPerM3: { type: Number, required: true },
    sandM3PerM3: { type: Number, required: true },
  },
  { _id: false },
);

const finishWetMixSchema = new Schema(
  {
    cementKgPerM3: { type: Number, required: true },
    sandM3PerM3: { type: Number, required: true },
  },
  { _id: false },
);

const materialsSchema = new Schema(
  {
    concreteClasses: { type: [String], default: DEFAULT_MATERIALS.concreteClasses },
    defaultConcreteGrade: { type: String, default: DEFAULT_MATERIALS.defaultConcreteGrade },
    stoneMortarRatio: { type: String, default: DEFAULT_MATERIALS.stoneMortarRatio },
    stoneMortarFraction: { type: Number, default: DEFAULT_MATERIALS.stoneMortarFraction },
    blindingThickness: { type: Number, default: DEFAULT_MATERIALS.blindingThickness },
    screedThickness: { type: Number, default: DEFAULT_MATERIALS.screedThickness },
    plasterThickness: { type: Number, default: DEFAULT_MATERIALS.plasterThickness },
    paintCoats: { type: Number, default: DEFAULT_MATERIALS.paintCoats },
    tileWastage: { type: Number, default: DEFAULT_MATERIALS.tileWastage },
    earthworkBulkingFactor: {
      type: Number,
      default: DEFAULT_MATERIALS.earthworkBulkingFactor,
      min: 0,
    },
    verticalBracingRate: {
      type: Number,
      default: DEFAULT_MATERIALS.verticalBracingRate,
      min: 0,
    },
    soffitPropRate: {
      type: Number,
      default: DEFAULT_MATERIALS.soffitPropRate,
      min: 0,
    },
    appliedVerticalBracingRate: {
      type: Number,
      default: DEFAULT_MATERIALS.appliedVerticalBracingRate,
      min: 0,
    },
    appliedSoffitPropRate: {
      type: Number,
      default: DEFAULT_MATERIALS.appliedSoffitPropRate,
      min: 0,
    },
    concreteMixes: { type: Schema.Types.Mixed, default: undefined },
    appliedConcreteMixes: { type: Schema.Types.Mixed, default: undefined },
    mortarMix: { type: mortarMixSchema, default: undefined },
    appliedMortarMix: { type: mortarMixSchema, default: undefined },
    screedMix: { type: finishWetMixSchema, default: undefined },
    appliedScreedMix: { type: finishWetMixSchema, default: undefined },
    plasterMix: { type: finishWetMixSchema, default: undefined },
    appliedPlasterMix: { type: finishWetMixSchema, default: undefined },
    appliedStoneMortarRatio: {
      type: String,
      default: DEFAULT_MATERIALS.appliedStoneMortarRatio,
    },
    appliedStoneMortarFraction: {
      type: Number,
      default: DEFAULT_MATERIALS.appliedStoneMortarFraction,
    },
  },
  { _id: false },
);

const projectSchema = new Schema<IProject>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    number: { type: String, default: 'PRJ-001' },
    client: { type: String, default: '' },
    contractor: { type: String, default: '' },
    consultant: { type: String, default: '' },
    location: { type: String, default: '' },
    currency: { type: String, default: 'USD' },
    units: { type: String, default: 'metric' },
    preparedBy: { type: String, default: '' },
    revision: { type: String, default: 'A' },
    date: { type: String, default: () => new Date().toISOString().slice(0, 10) },
    gfaM2: { type: Number, default: null, min: 0 },
    designAllowancePercent: {
      type: Number,
      default: DEFAULT_CASCADE_PERCENTS.designAllowancePercent,
      min: 0,
    },
    overheadPercent: {
      type: Number,
      default: DEFAULT_CASCADE_PERCENTS.overheadPercent,
      min: 0,
    },
    profitPercent: {
      type: Number,
      default: DEFAULT_CASCADE_PERCENTS.profitPercent,
      min: 0,
    },
    inflationPercent: {
      type: Number,
      default: DEFAULT_CASCADE_PERCENTS.inflationPercent,
      min: 0,
    },
    reportTheme: { type: String, default: DEFAULT_REPORT_THEME },
    materials: {
      type: materialsSchema,
      default: () => JSON.parse(JSON.stringify(DEFAULT_MATERIALS)),
    },
    rateLib: {
      type: Schema.Types.Mixed,
      default: () => JSON.parse(JSON.stringify(DEFAULT_RATE_LIB)),
    },
    useRateAnalysis: { type: Boolean, default: true },
    grid: {
      xAxes: { type: [axisSchema], default: () => DEFAULT_GRID.xAxes.map((a) => ({ ...a })) },
      yAxes: { type: [axisSchema], default: () => DEFAULT_GRID.yAxes.map((a) => ({ ...a })) },
    },
    currencyConversionLog: {
      type: [
        {
          id: { type: String, required: true },
          fromCurrency: { type: String, required: true },
          toCurrency: { type: String, required: true },
          rateUsed: { type: Number, required: true },
          rateDate: { type: String, required: true },
          timestamp: { type: Date, required: true },
          triggeredBy: { type: String, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const Project = mongoose.model<IProject>('Project', projectSchema);

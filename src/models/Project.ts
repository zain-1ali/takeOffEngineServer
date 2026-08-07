import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  DEFAULT_GRID,
  DEFAULT_MATERIALS,
  DEFAULT_RATE_LIB,
} from '../defaults/projectDefaults';

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
};

export interface IProject extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  number: string;
  client: string;
  contractor: string;
  location: string;
  currency: string;
  units: string;
  preparedBy: string;
  revision: string;
  date: string;
  materials: ProjectMaterials;
  rateLib: typeof DEFAULT_RATE_LIB;
  useRateAnalysis: boolean;
  grid: { xAxes: AxisLine[]; yAxes: AxisLine[] };
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
    location: { type: String, default: '' },
    currency: { type: String, default: 'USD' },
    units: { type: String, default: 'Metric (m, m³)' },
    preparedBy: { type: String, default: '' },
    revision: { type: String, default: 'A' },
    date: { type: String, default: () => new Date().toISOString().slice(0, 10) },
    materials: { type: materialsSchema, default: () => ({ ...DEFAULT_MATERIALS }) },
    rateLib: {
      type: Schema.Types.Mixed,
      default: () => JSON.parse(JSON.stringify(DEFAULT_RATE_LIB)),
    },
    useRateAnalysis: { type: Boolean, default: true },
    grid: {
      xAxes: { type: [axisSchema], default: () => DEFAULT_GRID.xAxes.map((a) => ({ ...a })) },
      yAxes: { type: [axisSchema], default: () => DEFAULT_GRID.yAxes.map((a) => ({ ...a })) },
    },
  },
  { timestamps: true },
);

export const Project = mongoose.model<IProject>('Project', projectSchema);

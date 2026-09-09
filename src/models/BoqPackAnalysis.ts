import mongoose, { Document, Schema, Types } from 'mongoose';

export type BoqPackAnalysisStatus = 'APPLIED' | 'STALE' | 'INVALID';

export type IBoqPackAnalysisLine = {
  _id: Types.ObjectId;
  resourceId?: Types.ObjectId | null;
  sourceCode: string;
  quantity: number;
  remarks: string;
  sortOrder: number;
};

export type IBoqPackAnalysisComputed = {
  material: number;
  labour: number;
  plant: number;
  subcontract: number;
  baseResourceCost: number;
  wasteAllowance: number;
  directResourceCost: number;
  transport: number;
  sundries: number;
  primeCost: number;
  overhead: number;
  profit: number;
  compositeRate: number;
  calculatedAt: Date;
};

export interface IBoqPackAnalysis extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  packId: Types.ObjectId;
  itemId?: Types.ObjectId | null;
  rateId?: Types.ObjectId | null;
  lineKey: string;
  moduleNo: number;
  ref: string;
  description: string;
  unit: string;
  lines: IBoqPackAnalysisLine[];
  allowances: {
    transportPctMaterials: number;
    sundriesPctLabourPlantSubcontract: number;
    overheadPct: number;
    profitPct: number;
  };
  computed: IBoqPackAnalysisComputed;
  revision: number;
  appliedRevision: number;
  status: BoqPackAnalysisStatus;
  sourceSheet: string;
  sourceRow: number;
}

const lineSchema = new Schema(
  {
    resourceId: { type: Schema.Types.ObjectId, ref: 'BoqPackResource', default: null },
    sourceCode: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 0 },
    remarks: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: true },
);

const computedSchema = new Schema(
  {
    material: { type: Number, default: 0 },
    labour: { type: Number, default: 0 },
    plant: { type: Number, default: 0 },
    subcontract: { type: Number, default: 0 },
    baseResourceCost: { type: Number, default: 0 },
    wasteAllowance: { type: Number, default: 0 },
    directResourceCost: { type: Number, default: 0 },
    transport: { type: Number, default: 0 },
    sundries: { type: Number, default: 0 },
    primeCost: { type: Number, default: 0 },
    overhead: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
    compositeRate: { type: Number, default: 0 },
    calculatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const schema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    packId: {
      type: Schema.Types.ObjectId,
      ref: 'BoqPack',
      required: true,
      index: true,
    },
    itemId: { type: Schema.Types.ObjectId, ref: 'BoqPackItem', default: null },
    rateId: { type: Schema.Types.ObjectId, ref: 'BoqPackRate', default: null },
    lineKey: { type: String, required: true, trim: true },
    moduleNo: { type: Number, required: true },
    ref: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    unit: { type: String, default: '' },
    lines: { type: [lineSchema], default: [] },
    allowances: {
      transportPctMaterials: { type: Number, default: 0 },
      sundriesPctLabourPlantSubcontract: { type: Number, default: 0 },
      overheadPct: { type: Number, default: 0 },
      profitPct: { type: Number, default: 0 },
    },
    computed: { type: computedSchema, default: () => ({}) },
    revision: { type: Number, default: 1 },
    appliedRevision: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['APPLIED', 'STALE', 'INVALID'],
      default: 'STALE',
    },
    sourceSheet: { type: String, default: 'RATE ANALYSIS' },
    sourceRow: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ packId: 1, lineKey: 1 }, { unique: true });
schema.index({ packId: 1, 'lines.resourceId': 1 });

export const BoqPackAnalysis = mongoose.model('BoqPackAnalysis', schema);

import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IBoqPackRate extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  packId: Types.ObjectId;
  itemId?: Types.ObjectId | null;
  lineKey: string;
  labour: number;
  material: number;
  plant: number;
  subcontract: number;
  wastePct: number;
  ohpPct: number;
  directCost: number;
  compositeRate: number;
  currency: string;
  sourceSheet: string;
  sourceRow: number;
  rateSource: 'SCHEDULE' | 'ANALYSIS';
  analysisRevision: number;
  transport: number;
  sundries: number;
  overheadAmt: number;
  profitAmt: number;
}

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
    lineKey: { type: String, required: true, trim: true },
    labour: { type: Number, default: 0 },
    material: { type: Number, default: 0 },
    plant: { type: Number, default: 0 },
    subcontract: { type: Number, default: 0 },
    wastePct: { type: Number, default: 0 },
    ohpPct: { type: Number, default: 0 },
    directCost: { type: Number, default: 0 },
    compositeRate: { type: Number, required: true, default: 0 },
    currency: { type: String, default: 'USD' },
    sourceSheet: { type: String, default: 'Rates Schedule' },
    sourceRow: { type: Number, default: 0 },
    rateSource: {
      type: String,
      enum: ['SCHEDULE', 'ANALYSIS'],
      default: 'SCHEDULE',
    },
    analysisRevision: { type: Number, default: 0 },
    transport: { type: Number, default: 0 },
    sundries: { type: Number, default: 0 },
    overheadAmt: { type: Number, default: 0 },
    profitAmt: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ packId: 1, lineKey: 1 }, { unique: true });

export const BoqPackRate = mongoose.model('BoqPackRate', schema);

import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IBoqPackItem extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  packId: Types.ObjectId;
  moduleNo: number;
  ref: string;
  lineKey: string;
  elementKey: string;
  elementRef: string;
  description: string;
  unit: string;
  applicableLevelRaw: string;
  formulaText: string;
  quantityBasis: 'independent' | 'derived' | 'conditional';
  sourceSheet: string;
  sourceRow: number;
  sortOrder: number;
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
    moduleNo: { type: Number, required: true },
    ref: { type: String, required: true, trim: true },
    lineKey: { type: String, required: true, trim: true },
    elementKey: { type: String, required: true, trim: true, index: true },
    elementRef: { type: String, default: '' },
    description: { type: String, required: true, trim: true },
    unit: { type: String, required: true, trim: true },
    applicableLevelRaw: { type: String, default: '' },
    formulaText: { type: String, default: '' },
    quantityBasis: {
      type: String,
      enum: ['independent', 'derived', 'conditional'],
      default: 'independent',
    },
    sourceSheet: { type: String, default: '' },
    sourceRow: { type: Number, default: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ packId: 1, moduleNo: 1, ref: 1 }, { unique: true });
schema.index({ packId: 1, lineKey: 1 }, { unique: true });

export const BoqPackItem = mongoose.model('BoqPackItem', schema);

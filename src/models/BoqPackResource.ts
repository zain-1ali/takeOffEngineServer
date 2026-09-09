import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IBoqPackResource extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  packId: Types.ObjectId;
  code: string;
  category: string;
  description: string;
  unit: string;
  unitRate: number;
  wastePct: number;
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
    code: { type: String, required: true, trim: true },
    category: { type: String, default: 'OTHER' },
    description: { type: String, default: '' },
    unit: { type: String, default: '' },
    unitRate: { type: Number, default: 0 },
    wastePct: { type: Number, default: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ packId: 1, code: 1 }, { unique: true });

export const BoqPackResource = mongoose.model('BoqPackResource', schema);

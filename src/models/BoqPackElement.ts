import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IBoqPackElement extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  packId: Types.ObjectId;
  moduleNo: number;
  elementRef: string;
  label: string;
  normalizedLabel: string;
  elementKey: string;
  bindingKind: 'ENGINE' | 'CATALOGUE';
  engineKey?: string;
  scope: 'PROJECT' | 'FLOOR';
  applicableLevelsRaw: string[];
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
    elementRef: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    normalizedLabel: { type: String, default: '' },
    elementKey: { type: String, required: true, trim: true, index: true },
    bindingKind: {
      type: String,
      enum: ['ENGINE', 'CATALOGUE'],
      required: true,
    },
    engineKey: { type: String, default: '' },
    scope: { type: String, enum: ['PROJECT', 'FLOOR'], required: true },
    applicableLevelsRaw: { type: [String], default: [] },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ packId: 1, moduleNo: 1, elementRef: 1, label: 1 });

export const BoqPackElement = mongoose.model('BoqPackElement', schema);

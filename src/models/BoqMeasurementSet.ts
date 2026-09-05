import mongoose, { Document, Schema, Types } from 'mongoose';
import type { TakeoffLine } from '../services/boqTakeoff/measurement';

export interface IBoqMeasurementSet extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  floorId: string;
  name: string;
  lines: TakeoffLine[];
  createdAt: Date;
  updatedAt: Date;
}

const boqMeasurementSetSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    floorId: { type: String, required: true, trim: true, index: true },
    name: { type: String, default: '', trim: true },
    lines: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

boqMeasurementSetSchema.index({ projectId: 1, floorId: 1 });

export const BoqMeasurementSet = mongoose.model(
  'BoqMeasurementSet',
  boqMeasurementSetSchema,
);

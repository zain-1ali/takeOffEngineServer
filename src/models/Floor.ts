import mongoose, { Document, Schema, Types } from 'mongoose';
import { FLOOR_LEVEL_TYPES } from '../lib/levelCompatibility';

export interface IFloor extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  floorId: string;
  label: string;
  elevation: number;
  height: number;
  sortOrder: number;
  /** One or more level types (Foundation, Below-Grade, Above-Grade, Roof). */
  levelTypes?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const floorSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    floorId: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    elevation: { type: Number, required: true, default: 0 },
    height: { type: Number, required: true, default: 3 },
    sortOrder: { type: Number, required: true, default: 0 },
    levelTypes: {
      type: [{ type: String, enum: [...FLOOR_LEVEL_TYPES] }],
      default: undefined,
    },
  },
  { timestamps: true },
);

floorSchema.index({ projectId: 1, floorId: 1 }, { unique: true });

export const Floor = mongoose.model('Floor', floorSchema) as unknown as mongoose.Model<IFloor>;

import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IFloor extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  floorId: string;
  label: string;
  elevation: number;
  height: number;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const floorSchema = new Schema<IFloor>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    floorId: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    elevation: { type: Number, required: true, default: 0 },
    height: { type: Number, required: true, default: 3 },
    sortOrder: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

floorSchema.index({ projectId: 1, floorId: 1 }, { unique: true });

export const Floor = mongoose.model<IFloor>('Floor', floorSchema);

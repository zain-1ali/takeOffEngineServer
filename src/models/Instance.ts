import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IInstance extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  floorId: string;
  elementKey: string;
  shape: string;
  mark: string;
  count: number;
  geometry: Record<string, unknown>;
  concreteGrade: string | null;
  reinforcement: Record<string, unknown> | null;
  spec: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const instanceSchema = new Schema<IInstance>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    floorId: { type: String, required: true, trim: true, index: true },
    elementKey: { type: String, required: true, trim: true, index: true },
    shape: { type: String, required: true },
    mark: { type: String, required: true, trim: true },
    count: { type: Number, required: true, default: 1, min: 1 },
    geometry: { type: Schema.Types.Mixed, default: {} },
    concreteGrade: { type: String, default: null },
    reinforcement: { type: Schema.Types.Mixed, default: null },
    spec: { type: String, default: null },
  },
  { timestamps: true },
);

instanceSchema.index({ projectId: 1, floorId: 1, elementKey: 1 });

export const Instance = mongoose.model<IInstance>('Instance', instanceSchema);

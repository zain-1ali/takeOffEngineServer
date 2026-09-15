import mongoose, { Document, Schema, Types } from 'mongoose';

export type TakeoffInputMethod =
  | 'auto'
  | 'count'
  | 'length'
  | 'area'
  | 'volume'
  | 'weight'
  | 'time'
  | 'percent'
  | 'direct';

export type TakeoffLineInput = {
  enabled?: boolean;
  method?: TakeoffInputMethod;
  quantity?: number;
  count?: number;
  length?: number;
  width?: number;
  height?: number;
  depth?: number;
  factor?: number;
  wastePct?: number;
  percentage?: number;
  sourceLineKey?: string;
};

export interface ITakeoffInputSet extends Document {
  projectId: Types.ObjectId;
  floorId: string;
  elementKey: string;
  shared: Record<string, unknown>;
  lineInputs: Record<string, TakeoffLineInput>;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    floorId: { type: String, required: true, trim: true, index: true },
    elementKey: { type: String, required: true, trim: true, index: true },
    shared: { type: Schema.Types.Mixed, default: {} },
    lineInputs: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

schema.index(
  { projectId: 1, floorId: 1, elementKey: 1 },
  { unique: true },
);

export const TakeoffInputSet = mongoose.model<ITakeoffInputSet>(
  'TakeoffInputSet',
  schema,
);

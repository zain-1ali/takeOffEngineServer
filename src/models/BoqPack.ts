import mongoose, { Document, Schema, Types } from 'mongoose';

export type BoqPackStatus = 'STAGING' | 'ACTIVE' | 'SUPERSEDED' | 'FAILED';

export interface IBoqPack extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  version: number;
  status: BoqPackStatus;
  profile: string;
  source: {
    fileName: string;
    sha256: string;
    uploadedBy?: Types.ObjectId | null;
    uploadedAt: Date;
    parserVersion: string;
  };
  pricing: {
    currency: string;
    location?: string;
    taxInclusive: boolean;
  };
  modules: Array<{
    moduleNo: number;
    moduleKey: string;
    title: string;
    discipline: string;
    sourceSheet: string;
    sortOrder: number;
    elementCount: number;
    itemCount: number;
  }>;
  counts: {
    modules: number;
    elements: number;
    items: number;
    rates: number;
    resources: number;
    analyses: number;
  };
  validation: {
    warnings: string[];
    errors: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const moduleEmbedSchema = new Schema(
  {
    moduleNo: { type: Number, required: true },
    moduleKey: { type: String, required: true },
    title: { type: String, required: true },
    discipline: { type: String, default: '' },
    sourceSheet: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    elementCount: { type: Number, default: 0 },
    itemCount: { type: Number, default: 0 },
  },
  { _id: false },
);

const boqPackSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    version: { type: Number, required: true },
    status: {
      type: String,
      enum: ['STAGING', 'ACTIVE', 'SUPERSEDED', 'FAILED'],
      required: true,
      index: true,
    },
    profile: { type: String, required: true },
    source: {
      fileName: { type: String, required: true },
      sha256: { type: String, required: true },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      uploadedAt: { type: Date, required: true },
      parserVersion: { type: String, required: true },
    },
    pricing: {
      currency: { type: String, default: 'USD' },
      location: { type: String, default: '' },
      taxInclusive: { type: Boolean, default: false },
    },
    modules: { type: [moduleEmbedSchema], default: [] },
    counts: {
      modules: { type: Number, default: 0 },
      elements: { type: Number, default: 0 },
      items: { type: Number, default: 0 },
      rates: { type: Number, default: 0 },
      resources: { type: Number, default: 0 },
      analyses: { type: Number, default: 0 },
    },
    validation: {
      warnings: { type: [String], default: [] },
      errors: { type: [String], default: [] },
    },
  },
  { timestamps: true },
);

boqPackSchema.index({ projectId: 1, version: 1 }, { unique: true });
boqPackSchema.index(
  { projectId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);

export const BoqPack = mongoose.model('BoqPack', boqPackSchema);

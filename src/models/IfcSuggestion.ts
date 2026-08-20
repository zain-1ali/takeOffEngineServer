import mongoose, { Document, Schema, Types } from 'mongoose';

export type IfcSuggestionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type IfcSuggestionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type IfcSuggestionEntityType = 'IfcWall' | 'IfcSlab';

/** Editable payload used to create an Instance on Accept. */
export type IfcMappedInstanceData = {
  elementKey: 'WALLS' | 'SLABS' | null;
  shape: string | null;
  mark: string | null;
  geometry: Record<string, number> | null;
};

export interface IIfcSuggestion extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  jobId: Types.ObjectId;
  sourceGlobalId: string;
  expressId: number;
  entityType: IfcSuggestionEntityType;
  name: string | null;
  mappedInstanceData: IfcMappedInstanceData | null;
  confidence: IfcSuggestionConfidence;
  confidenceNotes: string[];
  /** Step 1 skipped / no mapper / incomplete map — needs manual modeling. */
  needsManualModeling: boolean;
  skipReason: string | null;
  status: IfcSuggestionStatus;
  acceptedInstanceId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const mappedDataSchema = new Schema(
  {
    elementKey: {
      type: String,
      enum: ['WALLS', 'SLABS', null],
      default: null,
    },
    shape: { type: String, default: null },
    mark: { type: String, default: null },
    geometry: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const ifcSuggestionSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    jobId: {
      type: Schema.Types.ObjectId,
      ref: 'IfcImportJob',
      required: true,
      index: true,
    },
    sourceGlobalId: { type: String, required: true, trim: true },
    expressId: { type: Number, required: true },
    entityType: {
      type: String,
      enum: ['IfcWall', 'IfcSlab'],
      required: true,
      index: true,
    },
    name: { type: String, default: null },
    mappedInstanceData: { type: mappedDataSchema, default: null },
    confidence: {
      type: String,
      enum: ['HIGH', 'MEDIUM', 'LOW'],
      required: true,
      index: true,
    },
    confidenceNotes: { type: [String], default: [] },
    needsManualModeling: { type: Boolean, default: false, index: true },
    skipReason: { type: String, default: null },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    acceptedInstanceId: {
      type: Schema.Types.ObjectId,
      ref: 'Instance',
      default: null,
    },
  },
  { timestamps: true },
);

ifcSuggestionSchema.index({ projectId: 1, jobId: 1, status: 1 });
ifcSuggestionSchema.index({ jobId: 1, entityType: 1, confidence: 1 });

export const IfcSuggestion = mongoose.model(
  'IfcSuggestion',
  ifcSuggestionSchema,
) as unknown as mongoose.Model<IIfcSuggestion>;

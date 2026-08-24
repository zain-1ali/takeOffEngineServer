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
  /**
   * UniFormat location context (Walls / Slabs / Doors / Wall finishes).
   * Null for elements with a fixed UniFormat mapping.
   */
  location: string | null;
  /** Provenance: manual schedule add, IFC import, or blueprint promotion. */
  source:
    | 'MANUAL'
    | 'IFC_IMPORT'
    | 'BLUEPRINT_TRACE'
    | 'BLUEPRINT_AI_SUGGESTION'
    | null;
  /** IFC GlobalId when source is IFC_IMPORT — used to prevent duplicate imports. */
  sourceGlobalId: string | null;
  /** Source measurement for blueprint promotion (also set for accepted AI rooms). */
  sourceTakeoffItemId: Types.ObjectId | null;
  /** Accepted AI room suggestion that produced this instance. */
  sourceAiSuggestionId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const instanceSchema = new Schema(
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
    location: { type: String, default: null, trim: true },
    source: {
      type: String,
      enum: [
        'MANUAL',
        'IFC_IMPORT',
        'BLUEPRINT_TRACE',
        'BLUEPRINT_AI_SUGGESTION',
        null,
      ],
      default: null,
    },
    sourceGlobalId: { type: String, default: null, trim: true },
    sourceTakeoffItemId: {
      type: Schema.Types.ObjectId,
      ref: 'TakeoffItem',
      default: null,
    },
    sourceAiSuggestionId: {
      type: Schema.Types.ObjectId,
      ref: 'AiSuggestion',
      default: null,
    },
  },
  { timestamps: true },
);

instanceSchema.index({ projectId: 1, floorId: 1, elementKey: 1 });
/** One IFC GlobalId per project when set (sparse — manual instances omit it). */
instanceSchema.index(
  { projectId: 1, sourceGlobalId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sourceGlobalId: { $type: 'string', $gt: '' },
    },
  },
);
/** A blueprint measurement can create at most one element instance. */
instanceSchema.index(
  { projectId: 1, sourceTakeoffItemId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sourceTakeoffItemId: { $type: 'objectId' },
    },
  },
);
/** An accepted AI room can create at most one element instance. */
instanceSchema.index(
  { projectId: 1, sourceAiSuggestionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sourceAiSuggestionId: { $type: 'objectId' },
    },
  },
);

export const Instance = mongoose.model(
  'Instance',
  instanceSchema,
) as unknown as mongoose.Model<IInstance>;

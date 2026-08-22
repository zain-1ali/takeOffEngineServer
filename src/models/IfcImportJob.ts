import mongoose, { Document, Schema, Types } from 'mongoose';
import type {
  IfcFloorMatchStatus,
  IfcSuggestionStorey,
} from './IfcSuggestion';

export type IfcSuggestionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type IfcImportJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'COMMITTED';
export type IfcWallConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type IfcWallSuggestionGeometry = {
  length?: number;
  radius?: number;
  arcAngleDeg?: number;
  thickness: number;
  height: number;
};

export type IfcWallSuggestionRow = {
  id: string;
  sourceGlobalId: string;
  expressId: number;
  elementKey: 'WALLS';
  name: string | null;
  floorId: string | null;
  sourceStorey: IfcSuggestionStorey | null;
  floorMatchStatus: IfcFloorMatchStatus;
  floorMatchNote: string;
  /** Optional user mark override; auto-assigned on commit if empty. */
  mark: string | null;
  shape: 'LINEAR' | 'CURVED' | null;
  geometry: IfcWallSuggestionGeometry | null;
  confidence: IfcWallConfidence;
  confidenceNotes: string[];
  needsManualReview: boolean;
  status: IfcSuggestionStatus;
};

export interface IIfcImportJob extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  fileName: string;
  status: IfcImportJobStatus;
  error?: string | null;
  summary: {
    walls: number;
    slabs: number;
    geometryOk: number;
    skipped: number;
  };
  suggestions: IfcWallSuggestionRow[];
  committedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const geometrySchema = new Schema(
  {
    length: { type: Number },
    radius: { type: Number },
    arcAngleDeg: { type: Number },
    thickness: { type: Number },
    height: { type: Number },
  },
  { _id: false },
);

const sourceStoreySchema = new Schema(
  {
    expressId: { type: Number, required: true },
    globalId: { type: String, default: null },
    name: { type: String, default: null },
    elevationM: { type: Number, default: null },
  },
  { _id: false },
);

const suggestionSchema = new Schema(
  {
    id: { type: String, required: true },
    sourceGlobalId: { type: String, required: true },
    expressId: { type: Number, required: true },
    elementKey: { type: String, enum: ['WALLS'], required: true },
    name: { type: String, default: null },
    floorId: { type: String, default: null },
    sourceStorey: { type: sourceStoreySchema, default: null },
    floorMatchStatus: {
      type: String,
      enum: [
        'MATCHED_NAME',
        'MATCHED_ELEVATION',
        'AMBIGUOUS',
        'UNMATCHED',
        'NO_STOREY',
        'MANUAL',
      ],
      default: 'NO_STOREY',
    },
    floorMatchNote: { type: String, default: '' },
    mark: { type: String, default: null },
    shape: {
      type: String,
      enum: ['LINEAR', 'CURVED', null],
      default: null,
    },
    geometry: { type: geometrySchema, default: null },
    confidence: {
      type: String,
      enum: ['HIGH', 'MEDIUM', 'LOW'],
      required: true,
    },
    confidenceNotes: { type: [String], default: [] },
    needsManualReview: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
      default: 'PENDING',
    },
  },
  { _id: false },
);

const ifcImportJobSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    fileName: { type: String, required: true },
    status: {
      type: String,
      enum: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'COMMITTED'],
      default: 'QUEUED',
      index: true,
    },
    error: { type: String, default: null },
    summary: {
      walls: { type: Number, default: 0 },
      slabs: { type: Number, default: 0 },
      geometryOk: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
    suggestions: { type: [suggestionSchema], default: [] },
    committedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const IfcImportJob = mongoose.model(
  'IfcImportJob',
  ifcImportJobSchema,
) as unknown as mongoose.Model<IIfcImportJob>;

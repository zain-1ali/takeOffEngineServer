import mongoose, { Document, Schema, Types } from 'mongoose';

export type RateSuggestionCategory = 'materials' | 'labour' | 'equipment';
export type RateSuggestionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type RatePdfJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'COMMITTED';

export type RatePdfSuggestion = {
  id: string;
  category: RateSuggestionCategory;
  name: string;
  unit: string;
  unitCost: number;
  confidence: number;
  status: RateSuggestionStatus;
};

export interface IRatePdfImportJob extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  fileName: string;
  status: RatePdfJobStatus;
  error?: string | null;
  suggestions: RatePdfSuggestion[];
  committedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const suggestionSchema = new Schema(
  {
    id: { type: String, required: true },
    category: {
      type: String,
      enum: ['materials', 'labour', 'equipment'],
      required: true,
    },
    name: { type: String, required: true },
    unit: { type: String, required: true },
    unitCost: { type: Number, required: true },
    confidence: { type: Number, default: 0.5 },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'REJECTED'],
      default: 'PENDING',
    },
  },
  { _id: false },
);

const ratePdfImportJobSchema = new Schema<IRatePdfImportJob>(
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
    suggestions: { type: [suggestionSchema], default: [] },
    committedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const RatePdfImportJob = mongoose.model<IRatePdfImportJob>(
  'RatePdfImportJob',
  ratePdfImportJobSchema,
);

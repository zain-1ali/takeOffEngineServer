import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

export const AI_SUGGESTION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
] as const;
export type AiSuggestionStatus = (typeof AI_SUGGESTION_STATUSES)[number];

export const AI_SUGGESTION_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type AiSuggestionConfidence =
  (typeof AI_SUGGESTION_CONFIDENCES)[number];

const aiSuggestionSchema = new Schema(
  {
    sheetId: {
      type: Schema.Types.ObjectId,
      ref: 'BlueprintSheet',
      required: true,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    dimensionA: {
      type: Number,
      default: null,
    },
    dimensionB: {
      type: Number,
      default: null,
    },
    /**
     * Unit for dimensionA/B and linear perimeter as returned/assumed from AI
     * (typically "m" or "mm"). Display layer converts for the project units.
     */
    dimensionUnit: {
      type: String,
      required: true,
      trim: true,
      default: 'm',
    },
    /** Raw dimensions string from AI (e.g. "3765x2851"), optional audit field. */
    dimensionsRaw: {
      type: String,
      default: null,
      trim: true,
    },
    calculatedArea: {
      type: Number,
      default: null,
    },
    calculatedPerimeter: {
      type: Number,
      default: null,
    },
    confidence: {
      type: String,
      enum: AI_SUGGESTION_CONFIDENCES,
      required: true,
      default: 'medium',
    },
    /**
     * Legacy polygon field — unused (data-only extraction). Kept so existing
     * Mongo documents remain readable without a migration.
     */
    polygon: {
      type: [
        new Schema(
          {
            x: { type: Number, required: true },
            y: { type: Number, required: true },
          },
          { _id: false },
        ),
      ],
      required: false,
      default: [],
    },
    status: {
      type: String,
      enum: AI_SUGGESTION_STATUSES,
      required: true,
      default: 'PENDING',
      index: true,
    },
    takeoffItemId: {
      type: Schema.Types.ObjectId,
      ref: 'TakeoffItem',
      default: null,
    },
    /** Normalized center of the room label text (0–1000 vs image width/height). */
    approxX: {
      type: Number,
      default: null,
    },
    approxY: {
      type: Number,
      default: null,
    },
    /** Human-confirmed pin location in source-image pixel space (set on Accept). */
    confirmedX: {
      type: Number,
      default: null,
    },
    confirmedY: {
      type: Number,
      default: null,
    },
    /** Normal element instance created from this accepted room, if promoted. */
    promotedInstanceId: {
      type: Schema.Types.ObjectId,
      ref: 'Instance',
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

aiSuggestionSchema.index({ sheetId: 1, status: 1 });

export type AiSuggestionDocument = InferSchemaType<typeof aiSuggestionSchema> & {
  _id: Types.ObjectId;
};

/** API-facing AiSuggestion shape (no polygon). */
export interface AiSuggestion {
  id: string;
  sheetId: string;
  label: string;
  dimensionA: number | null;
  dimensionB: number | null;
  dimensionUnit: string;
  dimensionsRaw: string | null;
  calculatedArea: number | null;
  calculatedPerimeter: number | null;
  confidence: AiSuggestionConfidence;
  status: AiSuggestionStatus;
  takeoffItemId: string | null;
  approxX: number | null;
  approxY: number | null;
  confirmedX: number | null;
  confirmedY: number | null;
  promotedInstanceId: string | null;
}

export const AiSuggestionModel = mongoose.model(
  'AiSuggestion',
  aiSuggestionSchema,
);

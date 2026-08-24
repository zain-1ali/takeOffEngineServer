import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

export const MARKUP_TYPES = [
  'FREEHAND',
  'LINE',
  'RECTANGLE',
  'ELLIPSE',
  'POLYGON',
  'TEXT',
] as const;

export type MarkupType = (typeof MARKUP_TYPES)[number];

/**
 * Geometry payload in source-image pixel space.
 * Shape varies by MarkupType (see frontend markupGeometry.ts).
 * Markup is visual-only — it never stores a calculated quantity.
 */
export type MarkupData = Record<string, unknown>;

const markupObjectSchema = new Schema(
  {
    sheetId: {
      type: Schema.Types.ObjectId,
      ref: 'BlueprintSheet',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: MARKUP_TYPES,
      required: true,
    },
    /** Image-space geometry JSON (points, line ends, rect, ellipse center, etc.). */
    data: {
      type: Schema.Types.Mixed,
      required: true,
    },
    color: {
      type: String,
      required: true,
      trim: true,
    },
    strokeWidth: {
      type: Number,
      required: true,
      min: 0.5,
    },
    textContent: {
      type: String,
      default: null,
    },
    /** Nullable — null means UI "Uncategorized" (no DB layer row). */
    layerId: {
      type: Schema.Types.ObjectId,
      ref: 'Layer',
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

export type MarkupObjectDocument = InferSchemaType<typeof markupObjectSchema> & {
  _id: Types.ObjectId;
};

/** API-facing MarkupObject shape — no calculatedValue / unit. */
export interface MarkupObject {
  id: string;
  sheetId: string;
  type: MarkupType;
  data: MarkupData;
  color: string;
  strokeWidth: number;
  textContent: string | null;
  layerId: string | null;
}

export const MarkupObjectModel = mongoose.model(
  'MarkupObject',
  markupObjectSchema,
);

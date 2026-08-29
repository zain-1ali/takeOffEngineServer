import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

/**
 * Blueprint page raster (one PDF page → one PNG).
 * API shape matches AI Estimator's Sheet contract (`originalFileUrl` is the
 * page image URL the viewer loads).
 */
export type CalibrationScale = number | null;
export type CalibrationUnit = string | null;

export const AI_EXTRACTION_STATUSES = [
  'idle',
  'pending',
  'processing',
  'completed',
  'failed',
] as const;
export type AiExtractionStatus = (typeof AI_EXTRACTION_STATUSES)[number];

const blueprintSheetSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    /** Project floor id (e.g. FDN, L01) — one drawing PDF per floor. */
    floorId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    /**
     * User-facing drawing title (defaults to uploaded PDF filename stem).
     * Shared across pages of the same floor PDF.
     */
    title: {
      type: String,
      default: null,
      trim: true,
    },
    /** Public URL of the page PNG (`/uploads/{projectId}/{id}.png`). */
    originalFileUrl: {
      type: String,
      required: true,
    },
    thumbnailFileUrl: {
      type: String,
      default: null,
    },
    /** Original multi-page PDF (`/uploads/{projectId}/source/{id}.pdf`). */
    sourcePdfUrl: {
      type: String,
      default: null,
    },
    pageNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    discipline: {
      type: String,
      required: true,
      trim: true,
      default: 'Other',
      index: true,
    },
    sortOrder: {
      type: Number,
      required: true,
      default: 0,
      index: true,
    },
    /** Real-world units per image pixel; null until calibrated. */
    calibrationScale: {
      type: Number,
      default: null,
    },
    calibrationUnit: {
      type: String,
      default: null,
    },
    isFloorPlan: {
      type: Boolean,
      default: null,
    },
    pageTitle: {
      type: String,
      default: null,
      trim: true,
    },
    imageWidth: {
      type: Number,
      default: null,
      min: 1,
    },
    imageHeight: {
      type: Number,
      default: null,
      min: 1,
    },
    aiExtractionStatus: {
      type: String,
      enum: AI_EXTRACTION_STATUSES,
      required: true,
      default: 'idle',
      index: true,
    },
    aiExtractionError: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

blueprintSheetSchema.index({ projectId: 1, sortOrder: 1 });
blueprintSheetSchema.index({ projectId: 1, floorId: 1, sortOrder: 1 });

export type BlueprintSheetDocument = InferSchemaType<
  typeof blueprintSheetSchema
> & {
  _id: Types.ObjectId;
};

/** API-facing Sheet shape (id instead of Mongo `_id`). */
export interface Sheet {
  id: string;
  projectId: string;
  floorId: string | null;
  name: string;
  /** Drawing title; null on legacy rows until set. */
  title: string | null;
  originalFileUrl: string;
  thumbnailFileUrl: string | null;
  sourcePdfUrl: string | null;
  pageNumber: number;
  discipline: string;
  sortOrder: number;
  calibrationScale: CalibrationScale;
  calibrationUnit: CalibrationUnit;
  isFloorPlan: boolean | null;
  pageTitle: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  aiExtractionStatus: AiExtractionStatus;
  aiExtractionError: string | null;
}

export const BlueprintSheet = mongoose.model(
  'BlueprintSheet',
  blueprintSheetSchema,
);

import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

export const TAKEOFF_TYPES = ['LINEAR', 'AREA', 'COUNT'] as const;
export type TakeoffType = (typeof TAKEOFF_TYPES)[number];

export const TAKEOFF_SOURCES = ['MANUAL', 'AI_SUGGESTED'] as const;
export type TakeoffSource = (typeof TAKEOFF_SOURCES)[number];

/** Image-coordinate vertex stored on a takeoff item. */
export interface TakeoffPoint {
  x: number;
  y: number;
}

const takeoffPointSchema = new Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
  },
  { _id: false },
);

const takeoffItemSchema = new Schema(
  {
    sheetId: {
      type: Schema.Types.ObjectId,
      ref: 'BlueprintSheet',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: TAKEOFF_TYPES,
      required: true,
    },
    /**
     * Vertices in source-image pixel space (not screen space).
     * Null/empty for AI_SUGGESTED items that have quantities but no traced shape.
     */
    points: {
      type: [takeoffPointSchema],
      required: false,
      default: null,
      validate: {
        validator: (points: TakeoffPoint[] | null | undefined) =>
          points == null ||
          (Array.isArray(points) &&
            (points.length === 0 ||
              points.every(
                (point) =>
                  typeof point?.x === 'number' && typeof point?.y === 'number',
              ))),
        message: 'points must be null or an array of {x,y}',
      },
    },
    /** Real-world length, area, or count (IEEE-754 double). */
    calculatedValue: {
      type: Number,
      required: true,
    },
    /**
     * Optional perimeter (real-world). Used for AI-suggested rooms where
     * area/perimeter come from dimension math, not polygon shoelace.
     */
    perimeter: {
      type: Number,
      default: null,
    },
    unit: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      default: null,
      trim: true,
    },
    color: {
      type: String,
      required: true,
      trim: true,
    },
    /** How the measurement was created. */
    source: {
      type: String,
      enum: TAKEOFF_SOURCES,
      required: true,
      default: 'MANUAL',
      index: true,
    },
    /** Nullable — null means UI "Uncategorized" (no DB layer row). */
    layerId: {
      type: Schema.Types.ObjectId,
      ref: 'Layer',
      default: null,
      index: true,
    },
    /** Nullable — kept for API compatibility; pricing stays on Cost Plan. */
    conditionId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    /** Human-confirmed AI room pin (image pixel space); no traced polygon. */
    confirmedX: {
      type: Number,
      default: null,
    },
    confirmedY: {
      type: Number,
      default: null,
    },
    /** Normal element instance created from this measurement, if promoted. */
    promotedInstanceId: {
      type: Schema.Types.ObjectId,
      ref: 'Instance',
      default: null,
    },
  },
  { timestamps: true },
);

export type TakeoffItemDocument = InferSchemaType<typeof takeoffItemSchema> & {
  _id: Types.ObjectId;
};

/** API-facing TakeoffItem shape. */
export interface TakeoffItem {
  id: string;
  sheetId: string;
  type: TakeoffType;
  /** Null when AI-accepted with no traced geometry. */
  points: TakeoffPoint[] | null;
  calculatedValue: number;
  perimeter: number | null;
  unit: string;
  label: string | null;
  color: string;
  source: TakeoffSource;
  layerId: string | null;
  conditionId: string | null;
  confirmedX: number | null;
  confirmedY: number | null;
  promotedInstanceId: string | null;
}

export const TakeoffItemModel = mongoose.model(
  'TakeoffItem',
  takeoffItemSchema,
);

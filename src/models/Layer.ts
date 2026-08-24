import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const layerSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    /** Hex color for the layer swatch, e.g. #22c55e */
    color: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (value: string) => HEX_COLOR.test(value),
        message: 'color must be a hex string like #RGB or #RRGGBB',
      },
    },
    visible: {
      type: Boolean,
      required: true,
      default: true,
    },
    sortOrder: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

layerSchema.index({ projectId: 1, sortOrder: 1 });

export type LayerDocument = InferSchemaType<typeof layerSchema> & {
  _id: Types.ObjectId;
};

/** API-facing Layer shape. */
export interface Layer {
  id: string;
  projectId: string;
  name: string;
  color: string;
  visible: boolean;
  sortOrder: number;
}

export const LayerModel = mongoose.model('Layer', layerSchema);

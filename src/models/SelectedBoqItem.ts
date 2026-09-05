import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * User-selected catalogue BOQ lines for an element on a floor.
 * Qty starts at 0; schedule / PDF measure fills quantities later.
 */

export type SelectedBoqQuantityBasis =
  | 'independent'
  | 'derived'
  | 'conditional';

export interface ISelectedBoqItem extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  floorId: string;
  elementKey: string;
  catalogueRef: string;
  description: string;
  unit: string;
  formulaText?: string;
  quantityBasis?: SelectedBoqQuantityBasis;
  nrm2Ref?: string;
  workCategory?: string;
  applicableLevels?: string[];
  /** Filled later from schedule / measure; 0 after Add to BOQ. */
  quantity: number;
  wastePct: number;
  takeoffKind: '' | 'dim' | 'bbs';
  measurementSetId?: Types.ObjectId | null;
  takeoffLineCount: number;
  bbsBars?: unknown[];
  bbsTotalKg?: number;
  createdAt: Date;
  updatedAt: Date;
}

const selectedBoqItemSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    floorId: { type: String, required: true, trim: true, index: true },
    elementKey: { type: String, required: true, trim: true, index: true },
    catalogueRef: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    unit: { type: String, required: true, trim: true, default: 'nr' },
    formulaText: { type: String, default: '' },
    quantityBasis: {
      type: String,
      enum: ['independent', 'derived', 'conditional'],
      default: 'independent',
    },
    nrm2Ref: { type: String, default: '' },
    workCategory: { type: String, default: '' },
    applicableLevels: { type: [String], default: [] },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    wastePct: { type: Number, default: 0 },
    takeoffKind: {
      type: String,
      enum: ['', 'dim', 'bbs'],
      default: '',
    },
    measurementSetId: {
      type: Schema.Types.ObjectId,
      ref: 'BoqMeasurementSet',
      default: null,
    },
    takeoffLineCount: { type: Number, default: 0 },
    bbsBars: { type: [Schema.Types.Mixed], default: undefined },
    bbsTotalKg: { type: Number, default: undefined },
  },
  { timestamps: true },
);

selectedBoqItemSchema.index(
  { projectId: 1, floorId: 1, elementKey: 1, catalogueRef: 1 },
  { unique: true },
);

export const SelectedBoqItem = mongoose.model(
  'SelectedBoqItem',
  selectedBoqItemSchema,
);

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
  /** Extra line typed by the user — not from the catalogue. */
  isManual: boolean;
  packId?: Types.ObjectId | null;
  packItemId?: Types.ObjectId | null;
  lineKey?: string;
  moduleNo?: number;
  scope?: 'PROJECT' | 'FLOOR' | '';
  quantityMode?: 'TYPED' | 'TAKEOFF' | '';
  reconciliationStatus?: 'ACTIVE' | 'NEEDS_REVIEW' | 'ORPHANED' | '';
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
    isManual: { type: Boolean, default: false },
    packId: { type: Schema.Types.ObjectId, ref: 'BoqPack', default: null },
    packItemId: { type: Schema.Types.ObjectId, ref: 'BoqPackItem', default: null },
    lineKey: { type: String, default: '', trim: true, index: true },
    moduleNo: { type: Number, default: undefined },
    scope: {
      type: String,
      enum: ['PROJECT', 'FLOOR', ''],
      default: '',
    },
    quantityMode: {
      type: String,
      enum: ['TYPED', 'TAKEOFF', ''],
      default: '',
    },
    reconciliationStatus: {
      type: String,
      enum: ['ACTIVE', 'NEEDS_REVIEW', 'ORPHANED', ''],
      default: 'ACTIVE',
    },
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

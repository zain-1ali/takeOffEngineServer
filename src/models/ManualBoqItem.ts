import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Ad-hoc BOQ lines — NOT parametric elements and not in ELEMENT_ENGINES.
 * Linked CostItem rates are revision-gated via applied* snapshots (same
 * policy as appliedConcreteMixes / materialsForBom).
 */

export type ManualBoqLinkKind = 'none' | 'analysis' | 'resource';
export type ManualBoqLabourMode = 'none' | 'outputRate' | 'fromLinkedRate';
export type ManualBoqResourceGroup = 'materials' | 'labour' | 'equipment';

export type AppliedBomUnitLine = {
  ref: string;
  desc: string;
  unit: string;
  /** Material quantity per 1 BOQ unit. */
  qtyPerUnit: number;
  rate: number;
};

export type AppliedLabUnitLine = {
  trade: string;
  desc: string;
  /** Man-days per 1 BOQ unit (from analysis labour coeff). */
  manDaysPerUnit: number;
  dayRate: number;
};

export interface IManualBoqItem extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  /** null = project-wide */
  floorId?: string | null;
  description: string;
  unit: string;
  quantity: number;

  linkKind: ManualBoqLinkKind;
  analysisCode?: string | null;
  resourceGroup?: ManualBoqResourceGroup | null;
  resourceCode?: string | null;

  labourMode: ManualBoqLabourMode;
  outputPerDay?: number | null;
  gangDescription?: string | null;

  appliedUnitRate?: number | null;
  appliedBomUnitLines: AppliedBomUnitLine[];
  appliedLabUnitLines: AppliedLabUnitLine[];
  appliedAtRevision?: string | null;

  /** Optional UniFormat II code for Cost Plan grouping (e.g. A1010). */
  uniformatCode?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const bomUnitLineSchema = new Schema(
  {
    ref: { type: String, required: true },
    desc: { type: String, required: true },
    unit: { type: String, required: true },
    qtyPerUnit: { type: Number, required: true },
    rate: { type: Number, required: true },
  },
  { _id: false },
);

const labUnitLineSchema = new Schema(
  {
    trade: { type: String, required: true },
    desc: { type: String, required: true },
    manDaysPerUnit: { type: Number, required: true },
    dayRate: { type: Number, required: true },
  },
  { _id: false },
);

const manualBoqItemSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    floorId: { type: String, default: null, trim: true, index: true },
    description: { type: String, required: true, trim: true },
    unit: { type: String, required: true, trim: true, default: 'nr' },
    quantity: { type: Number, required: true, min: 0, default: 0 },

    linkKind: {
      type: String,
      enum: ['none', 'analysis', 'resource'],
      default: 'none',
    },
    analysisCode: { type: String, default: null },
    resourceGroup: {
      type: String,
      enum: ['materials', 'labour', 'equipment'],
      default: null,
    },
    resourceCode: { type: String, default: null },

    labourMode: {
      type: String,
      enum: ['none', 'outputRate', 'fromLinkedRate'],
      default: 'none',
    },
    outputPerDay: { type: Number, default: null },
    gangDescription: { type: String, default: null },

    appliedUnitRate: { type: Number, default: null },
    appliedBomUnitLines: { type: [bomUnitLineSchema], default: [] },
    appliedLabUnitLines: { type: [labUnitLineSchema], default: [] },
    appliedAtRevision: { type: String, default: null },
    uniformatCode: { type: String, default: null, trim: true },
  },
  { timestamps: true },
);

manualBoqItemSchema.index({ projectId: 1, floorId: 1 });

// Untyped model() — Babel 8 under Jest mishandles Schema/Model generics.
export const ManualBoqItem = mongoose.model(
  'ManualBoqItem',
  manualBoqItemSchema,
);

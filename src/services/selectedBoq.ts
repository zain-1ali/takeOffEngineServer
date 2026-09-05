import type { ISelectedBoqItem } from '../models/SelectedBoqItem';

export type PublicSelectedBoqItem = {
  id: string;
  projectId: string;
  floorId: string;
  elementKey: string;
  catalogueRef: string;
  description: string;
  unit: string;
  formulaText: string;
  quantityBasis: 'independent' | 'derived' | 'conditional' | '';
  nrm2Ref: string;
  workCategory: string;
  applicableLevels: string[];
  quantity: number;
  wastePct: number;
  takeoffKind: '' | 'dim' | 'bbs';
  measurementSetId: string | null;
  takeoffLineCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Lean shape passed into report builders (no Mongo fields). */
export type SelectedBoqReportItem = {
  id: string;
  floorId: string;
  elementKey: string;
  catalogueRef: string;
  description: string;
  unit: string;
  formulaText?: string;
  quantityBasis?: 'independent' | 'derived' | 'conditional';
  nrm2Ref?: string;
  workCategory?: string;
  applicableLevels?: string[];
  quantity: number;
  wastePct?: number;
  takeoffKind?: '' | 'dim' | 'bbs';
  measurementSetId?: string | null;
  takeoffLineCount?: number;
};

export function publicSelectedBoqItem(doc: ISelectedBoqItem): PublicSelectedBoqItem {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    floorId: doc.floorId,
    elementKey: doc.elementKey,
    catalogueRef: doc.catalogueRef,
    description: doc.description,
    unit: doc.unit,
    formulaText: doc.formulaText || '',
    quantityBasis: (doc.quantityBasis as PublicSelectedBoqItem['quantityBasis']) || '',
    nrm2Ref: doc.nrm2Ref || '',
    workCategory: doc.workCategory || '',
    applicableLevels: doc.applicableLevels || [],
    quantity: Number(doc.quantity) || 0,
    wastePct: Number(doc.wastePct) || 0,
    takeoffKind: doc.takeoffKind || '',
    measurementSetId: doc.measurementSetId
      ? doc.measurementSetId.toString()
      : null,
    takeoffLineCount: Number(doc.takeoffLineCount) || 0,
    createdAt: doc.createdAt?.toISOString?.() || '',
    updatedAt: doc.updatedAt?.toISOString?.() || '',
  };
}

export function toSelectedBoqReportItem(doc: ISelectedBoqItem): SelectedBoqReportItem {
  return {
    id: doc._id.toString(),
    floorId: doc.floorId,
    elementKey: doc.elementKey,
    catalogueRef: doc.catalogueRef,
    description: doc.description,
    unit: doc.unit,
    formulaText: doc.formulaText || undefined,
    quantityBasis: doc.quantityBasis || undefined,
    nrm2Ref: doc.nrm2Ref || undefined,
    workCategory: doc.workCategory || undefined,
    applicableLevels: doc.applicableLevels?.length
      ? [...doc.applicableLevels]
      : undefined,
    quantity: Number(doc.quantity) || 0,
    wastePct: Number(doc.wastePct) || 0,
    takeoffKind: doc.takeoffKind || '',
    measurementSetId: doc.measurementSetId
      ? doc.measurementSetId.toString()
      : null,
    takeoffLineCount: Number(doc.takeoffLineCount) || 0,
  };
}

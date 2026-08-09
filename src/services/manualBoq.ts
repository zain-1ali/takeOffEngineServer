/**
 * Manual BOQ persistence helpers (Mongoose) + re-exports of pure pricing.
 */
import type { RateLib } from '../engines/rateAnalysis';
import { ManualBoqItem, type IManualBoqItem } from '../models/ManualBoqItem';
import {
  buildManualReportContribution,
  resolveManualRateSnapshot,
  type ManualBoqInput,
  type ManualBoqReportItem,
} from './manualBoqPricing';

export {
  buildManualReportContribution,
  resolveManualRateSnapshot,
  type ManualBoqInput,
  type ManualRateSnapshot,
  type ManualReportContribution,
} from './manualBoqPricing';

export function toManualBoqReportItem(doc: IManualBoqItem): ManualBoqReportItem {
  return {
    description: doc.description,
    unit: doc.unit,
    quantity: doc.quantity,
    labourMode: doc.labourMode,
    outputPerDay: doc.outputPerDay ?? null,
    gangDescription: doc.gangDescription ?? null,
    appliedUnitRate: doc.appliedUnitRate ?? null,
    appliedBomUnitLines: [...(doc.appliedBomUnitLines || [])],
    appliedLabUnitLines: [...(doc.appliedLabUnitLines || [])],
  };
}

export function publicManualBoqItem(doc: IManualBoqItem) {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    floorId: doc.floorId ?? null,
    description: doc.description,
    unit: doc.unit,
    quantity: doc.quantity,
    linkKind: doc.linkKind,
    analysisCode: doc.analysisCode,
    resourceGroup: doc.resourceGroup,
    resourceCode: doc.resourceCode,
    labourMode: doc.labourMode,
    outputPerDay: doc.outputPerDay,
    gangDescription: doc.gangDescription,
    appliedUnitRate: doc.appliedUnitRate,
    appliedBomUnitLines: [...(doc.appliedBomUnitLines || [])],
    appliedLabUnitLines: [...(doc.appliedLabUnitLines || [])],
    appliedAtRevision: doc.appliedAtRevision,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Re-snapshot every ManualBoqItem for a project from live rateLib (revision bump). */
export async function applyManualBoqRatesForRevision(
  projectId: string,
  rateLib: RateLib,
  revision: string,
): Promise<number> {
  const items = await ManualBoqItem.find({ projectId });
  let n = 0;
  for (const item of items) {
    const snap = resolveManualRateSnapshot(
      {
        linkKind: item.linkKind,
        analysisCode: item.analysisCode,
        resourceGroup: item.resourceGroup,
        resourceCode: item.resourceCode,
        labourMode: item.labourMode,
      },
      rateLib,
      revision,
    );
    item.appliedUnitRate = snap.appliedUnitRate;
    item.appliedBomUnitLines = snap.appliedBomUnitLines as any;
    item.appliedLabUnitLines = snap.appliedLabUnitLines as any;
    item.appliedAtRevision = snap.appliedAtRevision;
    await item.save();
    n++;
  }
  return n;
}

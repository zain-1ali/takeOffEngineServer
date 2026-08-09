/** Structured report types (JSON instead of HTML strings). */

/** Where a report line came from — modelled elements vs ad-hoc Manual BOQ. */
export type ReportSource = 'MODELLED' | 'MANUAL';

export type ReportLine = {
  kind: 'group' | 'item' | 'total';
  ref?: string;
  description: string;
  qty?: number;
  unit?: string;
  rate?: number | null;
  amount?: number | null;
  isRebar?: boolean;
  dec?: number;
  source?: ReportSource;
};

export type LabourActivity = {
  ref: string;
  activity: string;
  qty: number;
  unit: string;
  outputRate: string;
  gang: string;
  days: number;
  source?: ReportSource;
};

export type TradeSummary = {
  trade: string;
  manDays: number;
  dayRate: number;
  cost: number;
  source?: ReportSource;
};

export type ElementReportBundle = {
  elementKey: string;
  num: number;
  suffix: string;
  label: string;
  kind: 'structural' | 'masonry' | 'finish' | 'earthworks';
  units: number;
  boq: ReportLine[];
  bom: ReportLine[];
  labour: { activities: LabourActivity[]; trades: TradeSummary[]; totalManDays: number; totalCost: number };
  summary: Record<string, number>;
  cost: { boq: number; bom: number; labour: number };
};

export type ProjectReportsPayload = {
  scope: 'floor' | 'project';
  floorId: string | null;
  currency: string;
  /** Display unit system applied to geometric quantities in this payload. */
  unitSystem?: 'metric' | 'imperial';
  summary: {
    totalConcrete: number;
    totalFormwork: number;
    totalSteel: number;
    totalUnits: number;
    pricedTotal: number;
    elementCount: number;
  };
  /** Consolidated tables across scope */
  boq: ReportLine[];
  bom: ReportLine[];
  labour: { activities: LabourActivity[]; trades: TradeSummary[]; totalManDays: number; totalCost: number };
  /** Per-element bundles (for element tabs / drill-down) */
  byElement: ElementReportBundle[];
};

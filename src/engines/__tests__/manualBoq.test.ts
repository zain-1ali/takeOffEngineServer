import {
  buildManualReportContribution,
  resolveManualRateSnapshot,
} from '../../services/manualBoqPricing';
import type { RateLib } from '../rateAnalysis';
import type { ManualBoqReportItem } from '../../services/manualBoqPricing';

const rateLib: RateLib = {
  materials: [
    { code: 'CEM', desc: 'Cement', unit: 'bag', rate: 10, wastage: 0 },
    { code: 'SND', desc: 'Sand', unit: 'm³', rate: 20 },
  ],
  labour: [
    { code: 'MAS', desc: 'Mason', unit: 'day', rate: 50 },
    { code: 'LAB', desc: 'Labourer', unit: 'day', rate: 25 },
  ],
  equipment: [],
  methods: [],
  analyses: {
    concrete: {
      label: 'Concrete',
      unit: 'm³',
      method: 'M-CONC',
      ohp: 0,
      materials: [
        { ref: 'CEM', coeff: 2 },
        { ref: 'SND', coeff: 0.5 },
      ],
      labour: [
        { ref: 'MAS', coeff: 0.2 },
        { ref: 'LAB', coeff: 0.8 },
      ],
    },
  },
};

describe('manualBoq revision-gated pricing', () => {
  it('snapshots unit rate from analysis at apply time', () => {
    const snap = resolveManualRateSnapshot(
      {
        linkKind: 'analysis',
        analysisCode: 'concrete',
        labourMode: 'fromLinkedRate',
      },
      rateLib,
      'A',
    );
    // 2*10 + 0.5*20 + 0.2*50 + 0.8*25 = 60
    expect(snap.appliedUnitRate).toBe(60);
    expect(snap.appliedBomUnitLines).toHaveLength(2);
    expect(snap.appliedLabUnitLines).toHaveLength(2);
    expect(snap.appliedAtRevision).toBe('A');
  });

  it('reports use applied rate, not a later live rate change', () => {
    const snap = resolveManualRateSnapshot(
      { linkKind: 'analysis', analysisCode: 'concrete', labourMode: 'none' },
      rateLib,
      'A',
    );
    const item: ManualBoqReportItem = {
      description: 'Extra blinding',
      unit: 'm³',
      quantity: 10,
      labourMode: 'none',
      outputPerDay: null,
      gangDescription: null,
      appliedUnitRate: snap.appliedUnitRate,
      appliedBomUnitLines: snap.appliedBomUnitLines,
      appliedLabUnitLines: [],
    };

    const before = buildManualReportContribution([item]);
    expect(before.pricedTotal).toBe(600);
    expect(before.boq.find((l) => l.kind === 'item')?.source).toBe('MANUAL');

    const liveLib = JSON.parse(JSON.stringify(rateLib)) as RateLib;
    liveLib.materials[0].rate = 100;
    const liveSnap = resolveManualRateSnapshot(
      { linkKind: 'analysis', analysisCode: 'concrete', labourMode: 'none' },
      liveLib,
      'A',
    );
    expect(liveSnap.appliedUnitRate).toBeGreaterThan(snap.appliedUnitRate!);

    const after = buildManualReportContribution([item]);
    expect(after.pricedTotal).toBe(600);
  });

  it('generates labour from output rate path', () => {
    const item: ManualBoqReportItem = {
      description: 'Hand excavation',
      unit: 'm³',
      quantity: 10,
      labourMode: 'outputRate',
      outputPerDay: 5,
      gangDescription: '1 Labourer',
      appliedUnitRate: 12,
      appliedBomUnitLines: [],
      appliedLabUnitLines: [],
    };

    const c = buildManualReportContribution([item]);
    expect(c.labour.activities).toHaveLength(1);
    expect(c.labour.activities[0].days).toBe(2);
    expect(c.labour.activities[0].source).toBe('MANUAL');
    expect(c.bom).toHaveLength(0);
  });

  it('generates labour + BOM from linked analysis path', () => {
    const snap = resolveManualRateSnapshot(
      {
        linkKind: 'analysis',
        analysisCode: 'concrete',
        labourMode: 'fromLinkedRate',
      },
      rateLib,
      'B',
    );
    const item: ManualBoqReportItem = {
      description: 'Patch concrete',
      unit: 'm³',
      quantity: 5,
      labourMode: 'fromLinkedRate',
      outputPerDay: null,
      gangDescription: null,
      appliedUnitRate: snap.appliedUnitRate,
      appliedBomUnitLines: snap.appliedBomUnitLines,
      appliedLabUnitLines: snap.appliedLabUnitLines,
    };

    const c = buildManualReportContribution([item]);
    expect(c.bom.some((l) => l.kind === 'item')).toBe(true);
    expect(c.labour.activities.length).toBeGreaterThan(0);
    expect(c.labour.trades.some((t) => t.trade === 'Mason')).toBe(true);
  });
});

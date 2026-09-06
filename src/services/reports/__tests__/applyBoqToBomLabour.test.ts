import { DEFAULT_MATERIALS, DEFAULT_RATE_LIB } from '../../../defaults/projectDefaults';
import { applyBoqQuantitiesToBomLabour } from '../applyBoqToBomLabour';
import { makeRateAccessors } from '../pricing';
import type { ElementReportBundle } from '../types';

const rates = makeRateAccessors(DEFAULT_RATE_LIB, undefined, false);

function padShell(): ElementReportBundle {
  return {
    elementKey: 'PAD_FOOTING',
    num: 1,
    suffix: '',
    label: 'Pad Foundation',
    kind: 'structural',
    units: 0,
    boq: [],
    bom: [],
    labour: { activities: [], trades: [], totalManDays: 0, totalCost: 0 },
    summary: {},
    cost: { boq: 0, bom: 0, labour: 0 },
  };
}

describe('applyBoqQuantitiesToBomLabour', () => {
  it('rebuilds pad footing BOM and labour from takeoff qty', () => {
    const bundle = {
      ...padShell(),
      boq: [
        {
          kind: 'item' as const,
          ref: '1.07',
          description: 'Concrete',
          qty: 10,
          unit: 'm³',
          selectedBoqId: 'sel1',
          source: 'CATALOGUE' as const,
        },
        {
          kind: 'item' as const,
          ref: '1.08',
          description: 'Formwork',
          qty: 24,
          unit: 'm²',
          selectedBoqId: 'sel2',
          source: 'CATALOGUE' as const,
        },
        {
          kind: 'item' as const,
          ref: '1.06',
          description: 'Rebar',
          qty: 0.8,
          unit: 't',
          selectedBoqId: 'sel3',
          source: 'CATALOGUE' as const,
        },
      ],
    };

    const [out] = applyBoqQuantitiesToBomLabour([bundle], {
      materials: DEFAULT_MATERIALS,
      rates,
    });

    expect(out.summary.concrete).toBe(10);
    expect(out.summary.formwork).toBe(24);
    expect(out.summary.steel).toBe(800);

    const cement = out.bom.find((l) => l.kind === 'item' && /Cement/.test(l.description));
    expect(cement?.qty).toBeGreaterThan(0);
    expect(out.labour.activities.some((a) => /Concrete/.test(a.activity))).toBe(true);
    expect(out.labour.activities.some((a) => /Formwork/.test(a.activity))).toBe(true);
    expect(out.labour.totalManDays).toBeGreaterThan(0);
    expect(out.cost.bom).toBeGreaterThan(0);
  });

  it('leaves schedule BOM when BOQ qtys are still zero', () => {
    const bundle = {
      ...padShell(),
      bom: [
        {
          kind: 'item' as const,
          description: 'Schedule cement',
          qty: 3,
          unit: 'bags',
        },
      ],
      labour: {
        activities: [
          {
            ref: 'L1',
            activity: 'Schedule pour',
            qty: 2,
            unit: 'm³',
            outputRate: '',
            gang: '',
            days: 1,
          },
        ],
        trades: [],
        totalManDays: 1,
        totalCost: 10,
      },
      boq: [
        {
          kind: 'item' as const,
          ref: '1.07',
          description: 'Concrete',
          qty: 0,
          unit: 'm³',
          selectedBoqId: 'sel1',
        },
      ],
    };

    const [out] = applyBoqQuantitiesToBomLabour([bundle], {
      materials: DEFAULT_MATERIALS,
      rates,
    });
    expect(out.bom[0].description).toBe('Schedule cement');
    expect(out.labour.activities[0].activity).toBe('Schedule pour');
  });
});

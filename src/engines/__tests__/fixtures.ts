/**
 * Minimal rate-lib slice matching AgileQS-Takeoff.html defaults,
 * used by rateAnalysis tests.
 */
import type { RateLib } from '../rateAnalysis';

export const SAMPLE_RATE_LIB: RateLib = {
  materials: [
    { code: 'CEM', desc: 'Cement (50kg bag)', unit: 'bag', rate: 9.5, wastage: 0.05 },
    { code: 'SND', desc: 'Sand (fine aggregate)', unit: 'm³', rate: 22, wastage: 0.1 },
    { code: 'AGG', desc: 'Coarse aggregate', unit: 'm³', rate: 28, wastage: 0.1 },
    { code: 'WAT', desc: 'Water', unit: 'L', rate: 0.002, wastage: 0 },
    { code: 'STL', desc: 'Reinforcement bar', unit: 'kg', rate: 1.15, wastage: 0.03 },
    { code: 'WIR', desc: 'Tie wire', unit: 'kg', rate: 2.2, wastage: 0.05 },
  ],
  labour: [
    { code: 'MAS', desc: 'Mason', unit: 'day', rate: 22 },
    { code: 'SFX', desc: 'Steel fixer', unit: 'day', rate: 25 },
    { code: 'LAB', desc: 'Labourer', unit: 'day', rate: 12 },
  ],
  equipment: [
    { code: 'MIX', desc: 'Concrete mixer (400L)', unit: 'day', rate: 45 },
    { code: 'POK', desc: 'Poker vibrator', unit: 'day', rate: 20 },
    { code: 'BBC', desc: 'Bar cutter/bender', unit: 'day', rate: 30 },
  ],
  methods: [
    {
      code: 'M-CONC',
      title: 'In-situ concrete',
      standard: 'BS EN 13670 / BS 8500',
      statement: 'Batch and mix…',
    },
    {
      code: 'M-REBAR',
      title: 'Steel reinforcement',
      standard: 'BS 8666 / BS 4449',
      statement: 'Cut and bend…',
    },
  ],
  analyses: {
    concrete: {
      label: 'Reinforced concrete',
      unit: 'm³',
      method: 'M-CONC',
      ohp: 0.15,
      materials: [
        { ref: 'CEM', coeff: 6.4 },
        { ref: 'SND', coeff: 0.45 },
        { ref: 'AGG', coeff: 0.85 },
        { ref: 'WAT', coeff: 170 },
      ],
      labour: [
        { ref: 'MAS', coeff: 0.2 },
        { ref: 'LAB', coeff: 0.8 },
      ],
      equipment: [
        { ref: 'MIX', coeff: 0.2 },
        { ref: 'POK', coeff: 0.15 },
      ],
    },
    rebar: {
      label: 'Reinforcement',
      unit: 'tonne',
      method: 'M-REBAR',
      ohp: 0.15,
      materials: [
        { ref: 'STL', coeff: 1000 },
        { ref: 'WIR', coeff: 10 },
      ],
      labour: [
        { ref: 'SFX', coeff: 5 },
        { ref: 'LAB', coeff: 5 },
      ],
      equipment: [{ ref: 'BBC', coeff: 0.5 }],
    },
  },
};

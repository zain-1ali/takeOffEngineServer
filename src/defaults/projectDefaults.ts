/** Factory defaults matching AgileQS-Takeoff.html state / FACTORY */

import {
  buildMixTable,
  DEFAULT_MORTAR_MIX,
} from './mixDefaults';

const DEFAULT_CONCRETE_CLASSES = [
  'C15/20',
  'C20/25',
  'C25/30',
  'C30/37',
  'C32/40',
  'C35/45',
];

const defaultMixes = buildMixTable(DEFAULT_CONCRETE_CLASSES);

export const DEFAULT_MATERIALS = {
  concreteClasses: [...DEFAULT_CONCRETE_CLASSES],
  defaultConcreteGrade: 'C25/30',
  stoneMortarRatio: '1:4',
  stoneMortarFraction: 0.3,
  blindingThickness: 0.05,
  screedThickness: 0.05,
  plasterThickness: 0.015,
  paintCoats: 2,
  tileWastage: 0.1,
  earthworkBulkingFactor: 0.25,
  /**
   * Indicative formwork support allowances (kg per m² of applicable formwork).
   * Draft in Project Settings; BOM uses applied_* until revision bump.
   * Defaults are industry-typical placeholders — adjust per project.
   */
  verticalBracingRate: 5,
  soffitPropRate: 12,
  appliedVerticalBracingRate: 5,
  appliedSoffitPropRate: 12,
  /** Draft mixes (Project Settings). Applied to BOM only after revision bump. */
  concreteMixes: JSON.parse(JSON.stringify(defaultMixes)) as typeof defaultMixes,
  appliedConcreteMixes: JSON.parse(JSON.stringify(defaultMixes)) as typeof defaultMixes,
  mortarMix: { ...DEFAULT_MORTAR_MIX },
  appliedMortarMix: { ...DEFAULT_MORTAR_MIX },
  appliedStoneMortarRatio: '1:4',
  appliedStoneMortarFraction: 0.3,
};

export const DEFAULT_GRID = {
  xAxes: [
    { label: 'A', spacing: 0 },
    { label: 'B', spacing: 6 },
    { label: 'C', spacing: 6 },
    { label: 'D', spacing: 7.5 },
  ],
  yAxes: [
    { label: '1', spacing: 0 },
    { label: '2', spacing: 5 },
    { label: '3', spacing: 5 },
    { label: '4', spacing: 6 },
  ],
};

export const DEFAULT_FLOORS = [
  { floorId: 'FDN', label: 'Foundation Level', elevation: -1.5, height: 1.5, sortOrder: 0 },
  { floorId: 'GF', label: 'Ground Floor', elevation: 0, height: 3.5, sortOrder: 1 },
  { floorId: 'L01', label: 'Level 01', elevation: 3.5, height: 3.2, sortOrder: 2 },
];

/** Pricing rate book defaults from AgileQS-Takeoff.html state.pricing */
export const DEFAULT_PRICING = {
  boq: {
    concrete: 145,
    formwork: 32,
    rebar: 1450,
    stoneMasonry: 55,
    blinding: 110,
    floorFinish: 28,
    wallFinish: 18,
    ceilingFinish: 22,
    excavation: 12,
    disposal: 8,
  } as Record<string, number>,
  materials: {
    cementBag: 9.5,
    sand: 22,
    aggregate: 28,
    water: 0.002,
    plywoodSheet: 18,
    formworkBracingKg: 1.8,
    formworkSoffitPropKg: 2.0,
    rebarKg: 1.15,
    tieWire: 2.2,
    stone: 26,
    paint: 6.5,
    tiles: 14,
    tileAdhesive: 0.6,
  } as Record<string, number>,
  labour: {
    'Concretor/Mason': 22,
    Mason: 22,
    Carpenter: 24,
    'Steel Fixer': 25,
    'Plant Operator': 30,
    Plasterer: 22,
    'Tiler/Screeder': 23,
    Labourer: 12,
  } as Record<string, number>,
};

export const DEFAULT_RATE_LIB = {
  materials: [
    { code: 'CEM', desc: 'Cement (50kg bag)', unit: 'bag', rate: 9.5, wastage: 0.05 },
    { code: 'SND', desc: 'Sand (fine aggregate)', unit: 'm³', rate: 22, wastage: 0.1 },
    { code: 'AGG', desc: 'Coarse aggregate', unit: 'm³', rate: 28, wastage: 0.1 },
    { code: 'WAT', desc: 'Water', unit: 'L', rate: 0.002, wastage: 0 },
    { code: 'PLY', desc: 'Plywood formwork sheet', unit: 'sheet', rate: 18, wastage: 0.1 },
    { code: 'TMB', desc: 'Timber bearers/props', unit: 'm', rate: 2.5, wastage: 0.1 },
    {
      code: 'BRCG',
      desc: 'Formwork bracing timber/props/stakes (indicative)',
      unit: 'kg',
      rate: 1.8,
      wastage: 0.05,
    },
    {
      code: 'SPROP',
      desc: 'Soffit falsework / props (indicative)',
      unit: 'kg',
      rate: 2.0,
      wastage: 0.05,
    },
    { code: 'STL', desc: 'Reinforcement bar', unit: 'kg', rate: 1.15, wastage: 0.03 },
    { code: 'WIR', desc: 'Tie wire', unit: 'kg', rate: 2.2, wastage: 0.05 },
    { code: 'STN', desc: 'Building stone (rubble)', unit: 'm³', rate: 26, wastage: 0.05 },
    { code: 'PNT', desc: 'Emulsion paint', unit: 'L', rate: 6.5, wastage: 0.05 },
    { code: 'TIL', desc: 'Tiles', unit: 'm²', rate: 14, wastage: 0.1 },
    { code: 'ADH', desc: 'Tile adhesive', unit: 'kg', rate: 0.6, wastage: 0.05 },
  ],
  labour: [
    { code: 'MAS', desc: 'Mason', unit: 'day', rate: 22 },
    { code: 'CARP', desc: 'Carpenter', unit: 'day', rate: 24 },
    { code: 'SFX', desc: 'Steel fixer', unit: 'day', rate: 25 },
    { code: 'PLAS', desc: 'Plasterer', unit: 'day', rate: 22 },
    { code: 'TILR', desc: 'Tiler', unit: 'day', rate: 23 },
    { code: 'LAB', desc: 'Labourer', unit: 'day', rate: 12 },
  ],
  equipment: [
    { code: 'MIX', desc: 'Concrete mixer (400L)', unit: 'day', rate: 45 },
    { code: 'POK', desc: 'Poker vibrator', unit: 'day', rate: 20 },
    { code: 'BBC', desc: 'Bar cutter/bender', unit: 'day', rate: 30 },
    { code: 'HST', desc: 'Material hoist', unit: 'day', rate: 60 },
    { code: 'HTL', desc: 'Hand tools & sundries', unit: 'item', rate: 5 },
  ],
  methods: [
    {
      code: 'M-CONC',
      title: 'In-situ concrete',
      standard: 'BS EN 13670 / BS 8500',
      statement:
        'Batch and mix concrete to the specified grade; transport and place within the workability time; compact with poker vibrators; finish and cure. Take and test cubes per lot.',
    },
    {
      code: 'M-FORM',
      title: 'Formwork & falsework',
      standard: 'BS 5975',
      statement:
        'Erect formwork and falsework to line and level; apply release agent; support to design loads; strike only after the minimum curing period.',
    },
    {
      code: 'M-REBAR',
      title: 'Steel reinforcement',
      standard: 'BS 8666 / BS 4449',
      statement:
        'Cut and bend bars to the schedule; fix with spacers to maintain cover; tie at intersections; inspect before concreting.',
    },
    {
      code: 'M-STONE',
      title: 'Stone masonry',
      standard: 'BS EN 1996 (Eurocode 6)',
      statement:
        'Lay dressed/rubble stone fully bedded and jointed in cement mortar, in courses, to the specified thickness and profile on a prepared blinding.',
    },
    {
      code: 'M-FIN-FL',
      title: 'Floor finishes',
      standard: 'BS 8204',
      statement:
        'Lay cement/sand screed to falls and cure; fix tiles with adhesive and grout, or trowel granolithic to a smooth even surface.',
    },
    {
      code: 'M-FIN-WL',
      title: 'Wall finishes',
      standard: 'BS EN 13914 / BS 5385',
      statement:
        'Apply cement/sand or gypsum plaster in coats to a true face and cure; then decorate or fix wall tiles as specified.',
    },
    {
      code: 'M-FIN-CL',
      title: 'Ceiling finishes',
      standard: 'BS EN 13914',
      statement:
        'Apply/skim plaster or install a suspended ceiling grid and tiles to level; then decorate as specified.',
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
    formwork: {
      label: 'Formwork',
      unit: 'm²',
      method: 'M-FORM',
      ohp: 0.15,
      materials: [
        { ref: 'PLY', coeff: 0.35 },
        { ref: 'TMB', coeff: 2.0 },
      ],
      labour: [
        { ref: 'CARP', coeff: 0.2 },
        { ref: 'LAB', coeff: 0.2 },
      ],
      equipment: [{ ref: 'HTL', coeff: 0.05 }],
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
    stoneMasonry: {
      label: 'Stone masonry',
      unit: 'm³',
      method: 'M-STONE',
      ohp: 0.15,
      materials: [
        { ref: 'STN', coeff: 1.0 },
        { ref: 'CEM', coeff: 2.16 },
        { ref: 'SND', coeff: 0.3 },
      ],
      labour: [
        { ref: 'MAS', coeff: 0.67 },
        { ref: 'LAB', coeff: 1.33 },
      ],
      equipment: [{ ref: 'HTL', coeff: 0.1 }],
    },
    blinding: {
      label: 'Lean concrete blinding',
      unit: 'm³',
      method: 'M-CONC',
      ohp: 0.15,
      materials: [
        { ref: 'CEM', coeff: 4.4 },
        { ref: 'SND', coeff: 0.52 },
        { ref: 'AGG', coeff: 0.9 },
        { ref: 'WAT', coeff: 185 },
      ],
      labour: [
        { ref: 'MAS', coeff: 0.15 },
        { ref: 'LAB', coeff: 0.6 },
      ],
      equipment: [{ ref: 'MIX', coeff: 0.15 }],
    },
    floorFinish: {
      label: 'Floor finish',
      unit: 'm²',
      method: 'M-FIN-FL',
      ohp: 0.15,
      materials: [
        { ref: 'CEM', coeff: 0.5 },
        { ref: 'SND', coeff: 0.05 },
        { ref: 'TIL', coeff: 1.1 },
        { ref: 'ADH', coeff: 4 },
      ],
      labour: [
        { ref: 'TILR', coeff: 0.05 },
        { ref: 'LAB', coeff: 0.05 },
      ],
      equipment: [{ ref: 'HTL', coeff: 0.01 }],
    },
    wallFinish: {
      label: 'Wall finish',
      unit: 'm²',
      method: 'M-FIN-WL',
      ohp: 0.15,
      materials: [
        { ref: 'CEM', coeff: 0.3 },
        { ref: 'SND', coeff: 0.03 },
        { ref: 'PNT', coeff: 0.2 },
      ],
      labour: [
        { ref: 'PLAS', coeff: 0.067 },
        { ref: 'LAB', coeff: 0.067 },
      ],
      equipment: [{ ref: 'HTL', coeff: 0.01 }],
    },
    ceilingFinish: {
      label: 'Ceiling finish',
      unit: 'm²',
      method: 'M-FIN-CL',
      ohp: 0.15,
      materials: [
        { ref: 'CEM', coeff: 0.2 },
        { ref: 'SND', coeff: 0.02 },
        { ref: 'PNT', coeff: 0.2 },
      ],
      labour: [
        { ref: 'PLAS', coeff: 0.083 },
        { ref: 'LAB', coeff: 0.083 },
      ],
      equipment: [{ ref: 'HTL', coeff: 0.01 }],
    },
  },
};

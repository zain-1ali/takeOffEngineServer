/** Element metadata for reports (mirrors AgileQS-Takeoff.html element tree + boq descriptors). */

export type ElementKind = 'structural' | 'masonry' | 'finish' | 'earthworks';

export type ElementMeta = {
  key: string;
  num: number;
  suffix: string;
  label: string;
  kind: ElementKind;
  concreteDesc?: (grade: string) => string;
  formworkDesc?: string;
  rebarDesc?: (dia: number) => string;
};

export const ELEMENT_META: Record<string, ElementMeta> = {
  PAD_FOOTING: {
    key: 'PAD_FOOTING',
    num: 1,
    suffix: '',
    label: 'Pad Foundation',
    kind: 'structural',
    concreteDesc: (g) =>
      `Reinforced in-situ concrete, grade ${g}, in isolated pad foundations; poured against earth/blinding`,
    formworkDesc: 'Formwork to sides of pad foundations; including striking',
    rebarDesc: (d) => `High-yield reinforcement bars, dia. ${d} mm, cut, bent and fixed in pad foundations`,
  },
  STRIP_FOOTING: {
    key: 'STRIP_FOOTING',
    num: 2,
    suffix: '',
    label: 'Strip Foundation (RC)',
    kind: 'structural',
    concreteDesc: (g) =>
      `Reinforced in-situ concrete, grade ${g}, in strip foundations; poured against earth/blinding`,
    formworkDesc: 'Formwork to sides of strip foundations; including striking',
    rebarDesc: (d) => `High-yield reinforcement bars, dia. ${d} mm, cut, bent and fixed in strip foundations`,
  },
  RAFT: {
    key: 'RAFT',
    num: 3,
    suffix: '',
    label: 'Raft Foundation',
    kind: 'structural',
    concreteDesc: (g) =>
      `Reinforced in-situ concrete, grade ${g}, in raft foundations; including thickened edges where applicable`,
    formworkDesc: 'Formwork to perimeter edges of raft foundations; including downstands and striking',
    rebarDesc: (d) =>
      `High-yield reinforcement bars, dia. ${d} mm, cut and fixed in raft foundations`,
  },
  PILE_CAP: {
    key: 'PILE_CAP',
    num: 4,
    suffix: '',
    label: 'Pile Cap',
    kind: 'structural',
    concreteDesc: (g) =>
      `Reinforced in-situ concrete, grade ${g}, in pile caps; poured against blinding`,
    formworkDesc: 'Formwork to sides of pile caps; including striking',
    rebarDesc: (d) =>
      `High-yield reinforcement bars, dia. ${d} mm, cut, bent and fixed in pile caps`,
  },
  PILES: {
    key: 'PILES',
    num: 5,
    suffix: '',
    label: 'Piles',
    kind: 'structural',
    concreteDesc: (g) =>
      `Reinforced concrete, grade ${g}, in bored or driven piles; measured by pile volume`,
    formworkDesc: 'No separately measured formwork to piles',
    rebarDesc: (d) =>
      d === 0
        ? 'Structural steel H-section piles; supply, pitch and drive'
        : `High-yield reinforcement bars, dia. ${d} mm, cut, bent and fixed in pile cages including links`,
  },
  EARTHWORKS: {
    key: 'EARTHWORKS',
    num: 6,
    suffix: '',
    label: 'Earthworks',
    kind: 'earthworks',
  },
  COLUMNS: {
    key: 'COLUMNS',
    num: 7,
    suffix: '',
    label: 'Columns',
    kind: 'structural',
    concreteDesc: (g) =>
      `Reinforced in-situ concrete, grade ${g}, in columns; all section shapes`,
    formworkDesc: 'Formwork to sides of columns; including striking',
    rebarDesc: (d) =>
      `High-yield reinforcement bars, dia. ${d} mm, cut, bent and fixed in columns`,
  },
  STONE_STRIP: {
    key: 'STONE_STRIP',
    num: 2,
    suffix: 'a',
    label: 'Stone Strip Foundation',
    kind: 'masonry',
  },
  WALLS: {
    key: 'WALLS',
    num: 8,
    suffix: '',
    label: 'Walls',
    kind: 'structural',
    concreteDesc: (g) => `Reinforced in-situ concrete, grade ${g}, in walls; both faces formed`,
    formworkDesc: 'Formwork to walls; both faces; including striking',
    rebarDesc: (d) => `High-yield reinforcement bars, dia. ${d} mm, cut, bent and fixed in walls`,
  },
  BEAMS: {
    key: 'BEAMS',
    num: 9,
    suffix: '',
    label: 'Beams',
    kind: 'structural',
    concreteDesc: (g) =>
      `Reinforced in-situ concrete, grade ${g}, in beams; all section shapes`,
    formworkDesc: 'Formwork to beam soffits and exposed sides; including striking',
    rebarDesc: (d) =>
      `High-yield reinforcement bars, dia. ${d} mm, cut, bent and fixed in beams`,
  },
  SLABS: {
    key: 'SLABS',
    num: 10,
    suffix: '',
    label: 'Slabs',
    kind: 'structural',
    concreteDesc: (g) =>
      `Reinforced in-situ concrete, grade ${g}, in slabs; including ribs and drop panels where applicable`,
    formworkDesc:
      'Formwork to slab soffits, exposed rib sides, drop-panel sides and edges; including striking',
    rebarDesc: (d) =>
      `High-yield reinforcement bars, dia. ${d} mm, cut and fixed in slabs`,
  },
  STAIRS: {
    key: 'STAIRS',
    num: 11,
    suffix: '',
    label: 'Stairs',
    kind: 'structural',
    concreteDesc: (g) =>
      `Reinforced in-situ concrete, grade ${g}, in stair flights, landings and stair beams`,
    formworkDesc:
      'Formwork to stair soffits (m²); risers and exposed sides (lm, indicative — verify before procurement)',
    rebarDesc: (d) =>
      `High-yield reinforcement bars, dia. ${d} mm, cut and fixed in stairs`,
  },
  RAMPS: {
    key: 'RAMPS',
    num: 12,
    suffix: '',
    label: 'Ramps',
    kind: 'structural',
    concreteDesc: (g) =>
      `Reinforced in-situ concrete, grade ${g}, in inclined and helical ramps`,
    formworkDesc:
      'Formwork to ramp soffits and exposed sides; including striking',
    rebarDesc: (d) =>
      `High-yield reinforcement bars, dia. ${d} mm, cut and fixed in ramps`,
  },
  FLOOR_FINISH: {
    key: 'FLOOR_FINISH',
    num: 16,
    suffix: '',
    label: 'Floor Finishes',
    kind: 'finish',
  },
  WALL_FINISH: {
    key: 'WALL_FINISH',
    num: 17,
    suffix: '',
    label: 'Wall Finishes',
    kind: 'finish',
  },
  CEILING_FINISH: {
    key: 'CEILING_FINISH',
    num: 18,
    suffix: '',
    label: 'Ceiling Finishes',
    kind: 'finish',
  },
};

export const REPORTABLE_KEYS = Object.keys(ELEMENT_META);

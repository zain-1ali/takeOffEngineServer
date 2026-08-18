/**
 * Element Register — master list every takeoff object maps to.
 * Governs unit, measurement rule, default material, takeoff method,
 * NRM2 reference, and overlap rank (lower rank owns shared volume).
 *
 * Keep in sync with frontend/src/constants/elementRegister.ts
 */

export type ElementModuleId = 1 | 2 | 3;

export type TakeoffMethod =
  | 'parametric'
  | 'schedule'
  | 'count'
  | 'linear-network'
  | 'manual';

export type ElementRegisterEntry = {
  code: string;
  key: string;
  num: number;
  suffix?: string;
  label: string;
  module: ElementModuleId;
  moduleTitle: string;
  primaryUnit: string;
  secondaryQuantities: string[];
  measurementRule: string;
  defaultMaterial: string;
  takeoffMethod: TakeoffMethod;
  nrm2Ref: string;
  /** Lower rank owns shared volume where two elements intersect. */
  overlapRank: number;
  implemented: boolean;
  kind: 'structural' | 'masonry' | 'finish' | 'earthworks' | 'openings' | 'mep';
};

export const ELEMENT_MODULE_TITLES: Record<ElementModuleId, string> = {
  1: 'Structural Elements',
  2: 'Architectural & Finishes',
  3: 'MEP Networks',
};

export const ELEMENT_REGISTER: ElementRegisterEntry[] = [
  {
    code: '01',
    key: 'PAD_FOOTING',
    num: 1,
    label: 'Pad Foundation',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['formwork m²', 'rebar kg'],
    measurementRule:
      'Net concrete volume of pad (plan area × thickness, less voids); formwork to vertical sides',
    defaultMaterial: 'C25/30 concrete + HY reinforcement',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 3.1.1',
    overlapRank: 30,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '02',
    key: 'STRIP_FOOTING',
    num: 2,
    label: 'Strip Foundation (RC)',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['formwork m²', 'rebar kg', 'centreline length m'],
    measurementRule:
      'Net concrete volume along centreline (width × depth × length); formwork to sides',
    defaultMaterial: 'C25/30 concrete + HY reinforcement',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 3.1.2',
    overlapRank: 35,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '02a',
    key: 'STONE_STRIP',
    num: 2,
    suffix: 'a',
    label: 'Stone Strip Foundation',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['mortar m³', 'blinding m³', 'masonry m³'],
    measurementRule:
      'Masonry volume of strip (width × depth × length); mortar and blinding measured separately',
    defaultMaterial: 'Stone / rubble masonry + cement mortar',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 3.1.3',
    overlapRank: 36,
    implemented: true,
    kind: 'masonry',
  },
  {
    code: '03',
    key: 'RAFT',
    num: 3,
    label: 'Raft Foundation',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['formwork m²', 'rebar kg', 'plan area m²'],
    measurementRule:
      'Net raft volume including thickenings / downstands; perimeter edge formwork',
    defaultMaterial: 'C30/37 concrete + HY reinforcement',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 3.1.4',
    overlapRank: 40,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '04',
    key: 'PILE_CAP',
    num: 4,
    label: 'Pile Cap',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['formwork m²', 'rebar kg'],
    measurementRule:
      'Net concrete volume of pile cap; formwork to sides; pile intrusion voids deducted where modelled',
    defaultMaterial: 'C30/37 concrete + HY reinforcement',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 3.1.5',
    overlapRank: 20,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '05',
    key: 'PILES',
    num: 5,
    label: 'Piles',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['pile length m', 'nos', 'rebar / steel kg'],
    measurementRule:
      'Concrete volume of pile shaft (cross-section × embedded length); steel piles by mass or length as specified',
    defaultMaterial: 'C30/37 bored pile concrete or structural steel H-pile',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 3.1.6',
    overlapRank: 10,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '06',
    key: 'EARTHWORKS',
    num: 6,
    label: 'Earthworks',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['excavation m³', 'disposal m³', 'fill m³'],
    measurementRule:
      'Bulk excavation / fill measured in situ; structural concrete volumes do not transfer to earthworks',
    defaultMaterial: 'In-situ soil / fill (site classification)',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 3.2',
    overlapRank: 80,
    implemented: true,
    kind: 'earthworks',
  },
  {
    code: '07',
    key: 'COLUMNS',
    num: 7,
    label: 'Columns',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['formwork m²', 'rebar kg', 'storey height m'],
    measurementRule:
      'Net column shaft volume between storeys; owns volume at beam / wall intersections',
    defaultMaterial: 'C30/37 concrete + HY reinforcement',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 4.1.1',
    overlapRank: 50,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '08',
    key: 'WALLS',
    num: 8,
    label: 'RC Walls',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['formwork m²', 'rebar kg', 'wall area m²'],
    measurementRule:
      'Net wall volume (centreline length × thickness × height); openings deducted; loses to columns at intersections',
    defaultMaterial: 'C30/37 concrete + HY reinforcement',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 4.1.2',
    overlapRank: 60,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '09',
    key: 'BEAMS',
    num: 9,
    label: 'Beams',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['formwork m²', 'rebar kg', 'span length m'],
    measurementRule:
      'Net beam volume along clear / centreline span; soffit and side formwork; loses to columns at junctions',
    defaultMaterial: 'C30/37 concrete + HY reinforcement',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 4.1.3',
    overlapRank: 55,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '10',
    key: 'SLABS',
    num: 10,
    label: 'Slabs',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['formwork m²', 'rebar kg', 'plan area m²'],
    measurementRule:
      'Net slab volume (plan area × thickness, less voids); loses to beams / walls where depth is shared',
    defaultMaterial: 'C30/37 concrete + HY reinforcement',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 4.1.4',
    overlapRank: 65,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '11',
    key: 'STAIRS',
    num: 11,
    label: 'Stairs',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: [
      'soffit formwork m²',
      'riser formwork lm',
      'side formwork lm',
      'rebar kg',
    ],
    measurementRule:
      'Flight + landing + stair-beam concrete; soffit m²; riser/side lm per register assumptions',
    defaultMaterial: 'C30/37 concrete + HY reinforcement',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 4.1.5',
    overlapRank: 70,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '12',
    key: 'RAMPS',
    num: 12,
    label: 'Ramps',
    module: 1,
    moduleTitle: ELEMENT_MODULE_TITLES[1],
    primaryUnit: 'm³',
    secondaryQuantities: ['formwork m²', 'rebar kg', 'sloping length m'],
    measurementRule:
      'Net ramp slab volume along sloping development; soffit and edge formwork',
    defaultMaterial: 'C30/37 concrete + HY reinforcement',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 4.1.6',
    overlapRank: 72,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '13',
    key: 'MASONRY',
    num: 13,
    label: 'Masonry / Infill Walls',
    module: 2,
    moduleTitle: ELEMENT_MODULE_TITLES[2],
    primaryUnit: 'm²',
    secondaryQuantities: ['masonry m³', 'mortar m³', 'openings m²'],
    measurementRule:
      'Net wall face area (centreline × height) less openings; thickness for volume where required',
    defaultMaterial: 'Concrete block / clay brick + mortar',
    takeoffMethod: 'parametric',
    nrm2Ref: 'NRM2 4.2',
    overlapRank: 90,
    implemented: true,
    kind: 'masonry',
  },
  {
    code: '14',
    key: 'DOORS_WINDOWS',
    num: 14,
    label: 'Doors & Windows',
    module: 2,
    moduleTitle: ELEMENT_MODULE_TITLES[2],
    primaryUnit: 'nos',
    secondaryQuantities: ['opening area m²', 'perimeter lm'],
    measurementRule:
      'Enumerated by type/size; opening areas deducted from host wall / finish takeoffs',
    defaultMaterial: 'As schedule (timber / aluminium / uPVC)',
    takeoffMethod: 'count',
    nrm2Ref: 'NRM2 4.3',
    overlapRank: 100,
    implemented: true,
    kind: 'openings',
  },
  {
    code: '15',
    key: 'LINTELS',
    num: 15,
    label: 'Lintels',
    module: 2,
    moduleTitle: ELEMENT_MODULE_TITLES[2],
    primaryUnit: 'm',
    secondaryQuantities: ['concrete m³', 'rebar kg', 'nos'],
    measurementRule:
      'Clear opening span plus bearings; measured as length or enumerated units per schedule',
    defaultMaterial: 'Precast / in-situ concrete lintel',
    takeoffMethod: 'schedule',
    nrm2Ref: 'NRM2 4.2.3',
    overlapRank: 85,
    implemented: true,
    kind: 'structural',
  },
  {
    code: '16',
    key: 'FLOOR_FINISH',
    num: 16,
    label: 'Floor Finishes',
    module: 2,
    moduleTitle: ELEMENT_MODULE_TITLES[2],
    primaryUnit: 'm²',
    secondaryQuantities: ['screed m³', 'tiles m²', 'wastage %'],
    measurementRule:
      'Net floor area (room L×W less openings) × build-up; screed/tiling split by specification',
    defaultMaterial: 'Cement screed + ceramic / porcelain tiles',
    takeoffMethod: 'schedule',
    nrm2Ref: 'NRM2 5.1',
    overlapRank: 110,
    implemented: true,
    kind: 'finish',
  },
  {
    code: '17',
    key: 'WALL_FINISH',
    num: 17,
    label: 'Wall Finishes',
    module: 2,
    moduleTitle: ELEMENT_MODULE_TITLES[2],
    primaryUnit: 'm²',
    secondaryQuantities: ['plaster m²', 'paint m²', 'openings deducted m²'],
    measurementRule:
      'Net wall face area less openings; one or both faces per location rule',
    defaultMaterial: 'Cement plaster + emulsion paint',
    takeoffMethod: 'schedule',
    nrm2Ref: 'NRM2 5.2',
    overlapRank: 111,
    implemented: true,
    kind: 'finish',
  },
  {
    code: '18',
    key: 'CEILING_FINISH',
    num: 18,
    label: 'Ceiling Finishes',
    module: 2,
    moduleTitle: ELEMENT_MODULE_TITLES[2],
    primaryUnit: 'm²',
    secondaryQuantities: ['plaster / board m²', 'paint m²'],
    measurementRule: 'Net soffit / ceiling area on plan, less voids',
    defaultMaterial: 'Gypsum / plaster + paint',
    takeoffMethod: 'schedule',
    nrm2Ref: 'NRM2 5.3',
    overlapRank: 112,
    implemented: true,
    kind: 'finish',
  },
  {
    code: '19',
    key: 'SKIRTING',
    num: 19,
    label: 'Skirting / Baseboards',
    module: 2,
    moduleTitle: ELEMENT_MODULE_TITLES[2],
    primaryUnit: 'm',
    secondaryQuantities: ['nos of corners', 'material m'],
    measurementRule:
      'Net room perimeter less door openings; measured as linear metre on plan',
    defaultMaterial: 'Timber / MDF / tile skirting as specified',
    takeoffMethod: 'schedule',
    nrm2Ref: 'NRM2 5.1.4',
    overlapRank: 113,
    implemented: true,
    kind: 'finish',
  },
  {
    code: '20',
    key: 'DUCTS',
    num: 20,
    label: 'Air Distribution Ducts',
    module: 3,
    moduleTitle: ELEMENT_MODULE_TITLES[3],
    primaryUnit: 'm',
    secondaryQuantities: ['surface area m²', 'weight kg', 'nos of joints'],
    measurementRule:
      'Centreline length by duct size; surface area for insulation / cladding where required',
    defaultMaterial: 'Galvanised steel sheet ductwork',
    takeoffMethod: 'linear-network',
    nrm2Ref: 'NRM2 6.3',
    overlapRank: 120,
    implemented: true,
    kind: 'mep',
  },
  {
    code: '21',
    key: 'DUCT_FITTINGS',
    num: 21,
    label: 'Duct Fittings & HVAC',
    module: 3,
    moduleTitle: ELEMENT_MODULE_TITLES[3],
    primaryUnit: 'nos',
    secondaryQuantities: ['equivalent length m', 'equipment nos'],
    measurementRule:
      'Enumerated fittings / AHU / VAV / terminals by type; may convert to equivalent duct length',
    defaultMaterial: 'Galvanised fittings + HVAC equipment as schedule',
    takeoffMethod: 'count',
    nrm2Ref: 'NRM2 6.3.2',
    overlapRank: 121,
    implemented: true,
    kind: 'mep',
  },
  {
    code: '22',
    key: 'PIPES',
    num: 22,
    label: 'Pipes & Plumbing',
    module: 3,
    moduleTitle: ELEMENT_MODULE_TITLES[3],
    primaryUnit: 'm',
    secondaryQuantities: ['fittings nos', 'valves nos', 'insulation m'],
    measurementRule:
      'Centreline pipe run by diameter / system; fittings enumerated or included in rates',
    defaultMaterial: 'uPVC / copper / steel as system specification',
    takeoffMethod: 'linear-network',
    nrm2Ref: 'NRM2 6.2',
    overlapRank: 122,
    implemented: true,
    kind: 'mep',
  },
  {
    code: '23',
    key: 'ELECTRICAL',
    num: 23,
    label: 'Conduits & Cable Trays',
    module: 3,
    moduleTitle: ELEMENT_MODULE_TITLES[3],
    primaryUnit: 'm',
    secondaryQuantities: ['cables m', 'tray m', 'accessories nos'],
    measurementRule:
      'Centreline conduit / tray length by size; cables measured separately where required',
    defaultMaterial: 'PVC conduit / GI cable tray + cable as schedule',
    takeoffMethod: 'linear-network',
    nrm2Ref: 'NRM2 6.4',
    overlapRank: 123,
    implemented: true,
    kind: 'mep',
  },
];

export function findRegisterEntry(
  key: string,
): ElementRegisterEntry | undefined {
  return ELEMENT_REGISTER.find((e) => e.key === key);
}

export function registerByModule(
  module: ElementModuleId,
): ElementRegisterEntry[] {
  return ELEMENT_REGISTER.filter((e) => e.module === module);
}

export function ownerOfSharedVolume(
  aKey: string,
  bKey: string,
): ElementRegisterEntry | undefined {
  const a = findRegisterEntry(aKey);
  const b = findRegisterEntry(bKey);
  if (!a || !b) return a ?? b;
  return a.overlapRank <= b.overlapRank ? a : b;
}

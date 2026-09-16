import type { DriverField, ElementTakeoffSchema, HeadingContext, LineRecipe } from './types'
import { sharedNum, sharedOn } from './context'

const round6 = (value: number) =>
  Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 1e6) / 1e6

const f = (
  key: string,
  label: string,
  group: string,
  type: DriverField['type'],
  extra: Partial<DriverField> = {},
): DriverField => ({ key, label, group, type, ...extra })

const num = (ctx: HeadingContext, key: string, fallback = 0) =>
  sharedNum(ctx.shared, key, fallback)

const on = (ctx: HeadingContext, key: string) => sharedOn(ctx.shared, key)

const formula = (fn: (ctx: HeadingContext) => number, source: 'input' | 'derived' = 'input'): LineRecipe => ({
  kind: 'formula',
  formula: (ctx) => round6(fn(ctx)),
  source,
})

const conditional = (
  switchKey: string,
  fn: (ctx: HeadingContext) => number,
): LineRecipe => ({
  kind: 'conditional',
  switchKey,
  formula: (ctx) => (on(ctx, switchKey) ? round6(fn(ctx)) : 0),
  source: 'derived',
})

const direct = (directField: string): LineRecipe => ({
  kind: 'direct',
  directField,
  source: 'input',
})

const engine = (): LineRecipe => ({ kind: 'engine', source: 'input' })

function footingFields(prefix: string): DriverField[] {
  return [
    f('excavationDepthM', 'Excavation depth', 'Earthworks', 'number', { unit: 'm' }),
    f('workingSpaceM', 'Working space each side', 'Earthworks', 'number', { unit: 'm' }),
    f('includeExtraOver', 'Include extra-over / batter excavation', 'Earthworks', 'switch', {
      default: false,
    }),
    f('extraOverM3', 'Extra-over excavation', 'Earthworks', 'number', { unit: 'm³' }),
    f('reusePct', 'Reuse / retain on site', 'Earthworks', 'percent', { unit: '%', default: 0 }),
    f('importedFillM3', 'Imported selected fill', 'Earthworks', 'number', { unit: 'm³' }),
    f('bulkingPct', 'Bulking allowance', 'Earthworks', 'percent', { unit: '%', default: 0 }),
    f('blindingThicknessM', 'Blinding thickness', 'Blinding', 'number', { unit: 'm', default: 0.05 }),
    f('blindingProjectionM', 'Blinding projection each side', 'Blinding', 'number', { unit: 'm', default: 0.05 }),
    f('includeWaterproofing', 'Include waterproofing', 'Waterproofing', 'switch', { default: false }),
    f('turnUpHeightM', 'Membrane turn-up height', 'Waterproofing', 'number', { unit: 'm', default: 0.15 }),
    f('includeProtection', 'Protect waterproofed area', 'Waterproofing', 'switch', { default: false }),
    f('jointLengthM', 'Construction joint length', 'Accessories', 'number', { unit: 'm' }),
    f('includeFinish', 'Include exposed concrete finish', 'Finishes', 'switch', { default: false }),
    f('includeSealer', 'Seal finished concrete surface', 'Finishes', 'switch', { default: false }),
    f(`${prefix}BoltsNr`, 'Holding-down bolts / anchors', 'Accessories', 'count', { unit: 'nr' }),
    f(`${prefix}CastInsNr`, 'Cast-in plates / sockets', 'Accessories', 'count', { unit: 'nr' }),
  ]
}

function footingRecipes(core: { rebar: string; concrete: string; formwork: string }): Record<string, LineRecipe> {
  const excav = (ctx: HeadingContext) => ctx.excavationM3 * (1 + num(ctx, 'bulkingPct') / 100)
  const reuse = (ctx: HeadingContext) => excav(ctx) * (num(ctx, 'reusePct') / 100)
  const blinding = (ctx: HeadingContext) => {
    const t = num(ctx, 'blindingThicknessM', 0.05)
    const p = num(ctx, 'blindingProjectionM', 0.05)
    return Math.max(0, ctx.planArea + ctx.perimeter * p + 4 * p * p) * t
  }
  const membrane = (ctx: HeadingContext) =>
    ctx.planArea + ctx.perimeter * num(ctx, 'turnUpHeightM', 0.15)
  return {
    [core.rebar]: engine(),
    [core.concrete]: engine(),
    [core.formwork]: engine(),
  }
}

/** Pad 1.01–1.15 with CORE 1.06–1.08 */
const padRecipes = (): Record<string, LineRecipe> => {
  const excav = (ctx: HeadingContext) =>
    ctx.excavationM3 * (1 + num(ctx, 'bulkingPct') / 100) +
    (on(ctx, 'includeExtraOver') ? num(ctx, 'extraOverM3') : 0)
  const reuse = (ctx: HeadingContext) => excav(ctx) * (num(ctx, 'reusePct') / 100)
  const blinding = (ctx: HeadingContext) => {
    const t = num(ctx, 'blindingThicknessM', 0.05)
    const p = num(ctx, 'blindingProjectionM', 0.05)
    return (ctx.planArea + ctx.perimeter * p + 4 * p * p) * t
  }
  const membrane = (ctx: HeadingContext) =>
    ctx.planArea + ctx.perimeter * num(ctx, 'turnUpHeightM', 0.15)
  return {
    '1.01': formula(excav),
    '1.02': formula((ctx) => Math.max(0, excav(ctx) - reuse(ctx)), 'derived'),
    '1.03': formula(
      (ctx) => Math.max(0, excav(ctx) - ctx.concrete - num(ctx, 'importedFillM3')),
      'derived',
    ),
    '1.04': formula((ctx) => num(ctx, 'importedFillM3')),
    '1.05': formula(blinding),
    '1.06': engine(),
    '1.07': engine(),
    '1.08': engine(),
    '1.09': conditional('includeWaterproofing', membrane),
    '1.1': conditional('includeProtection', membrane),
    '1.10': conditional('includeProtection', membrane),
    '1.11': direct('padBoltsNr'),
    '1.12': direct('padCastInsNr'),
    '1.13': formula((ctx) => num(ctx, 'jointLengthM')),
    '1.14': conditional('includeFinish', (ctx) => ctx.formwork || ctx.planArea),
    '1.15': conditional('includeSealer', (ctx) => ctx.formwork || ctx.planArea),
  }
}

const stripRecipes = (): Record<string, LineRecipe> => {
  const excav = (ctx: HeadingContext) =>
    ctx.excavationM3 * (1 + num(ctx, 'bulkingPct') / 100) +
    (on(ctx, 'includeExtraOver') ? num(ctx, 'extraOverM3') : 0)
  const reuse = (ctx: HeadingContext) => excav(ctx) * (num(ctx, 'reusePct') / 100)
  const blinding = (ctx: HeadingContext) =>
    (ctx.length + 2 * num(ctx, 'blindingProjectionM', 0.05)) *
    (ctx.width / Math.max(1, ctx.units) + 2 * num(ctx, 'blindingProjectionM', 0.05)) *
    num(ctx, 'blindingThicknessM', 0.05)
  const membrane = (ctx: HeadingContext) =>
    ctx.length * (ctx.width / Math.max(1, ctx.units) + 2 * num(ctx, 'turnUpHeightM', 0.15))
  return {
    '2.01': formula(excav),
    '2.02': formula((ctx) => Math.max(0, excav(ctx) - reuse(ctx)), 'derived'),
    '2.03': formula(
      (ctx) => Math.max(0, excav(ctx) - ctx.concrete - num(ctx, 'importedFillM3')),
      'derived',
    ),
    '2.04': formula((ctx) => num(ctx, 'importedFillM3')),
    '2.05': formula(blinding),
    '2.06': engine(),
    '2.07': engine(),
    '2.08': engine(),
    '2.09': conditional('includeWaterproofing', membrane),
    '2.1': conditional('includeProtection', membrane),
    '2.10': conditional('includeProtection', membrane),
    '2.11': formula((ctx) => num(ctx, 'jointLengthM')),
  }
}

function rangedRecipes(
  prefix: string,
  count: number,
  make: (ref: string, n: number) => LineRecipe,
): Record<string, LineRecipe> {
  const recipes: Record<string, LineRecipe> = {}
  for (let n = 1; n <= count; n += 1) {
    const ref = prefix + '.' + n
    const recipe = make(ref, n)
    recipes[ref] = recipe
    if (n < 10) recipes[prefix + '.0' + n] = recipe
    if (n === 10) recipes[prefix + '.1'] = recipe
  }
  return recipes
}

export const ELEMENT_SCHEMAS: Record<string, ElementTakeoffSchema> = {
  PAD_FOOTING: {
    fields: footingFields('pad'),
    recipes: padRecipes(),
  },
  STRIP_FOOTING: {
    fields: footingFields('strip'),
    recipes: stripRecipes(),
  },
  STONE_STRIP: {
    fields: [
      f('blindingThicknessM', 'Blinding thickness', 'Blinding', 'number', { unit: 'm', default: 0.05 }),
      f('blindingProjectionM', 'Blinding projection', 'Blinding', 'number', { unit: 'm', default: 0.05 }),
      f('includeDpc', 'Include DPC', 'Accessories', 'switch', { default: false }),
    ],
    recipes: {
      '3.04': engine(),
      '3.05': engine(),
      '3.01': formula((ctx) => ctx.faceArea || ctx.length * (ctx.height / Math.max(1, ctx.units))),
      '3.02': formula((ctx) => ctx.faceArea),
      '3.03': formula((ctx) => ctx.faceArea),
      '3.06': conditional('includeDpc', (ctx) => ctx.length),
    },
  },
  RAFT: {
    fields: [
      ...footingFields('raft'),
      f('includeInsulation', 'Include insulation', 'Insulation', 'switch', { default: false }),
    ],
    recipes: {
      ...footingRecipes({ rebar: '4.1', concrete: '4.11', formwork: '4.12' }),
      '4.01': formula(
        (ctx) =>
          ctx.excavationM3 * (1 + num(ctx, 'bulkingPct') / 100) +
          (on(ctx, 'includeExtraOver') ? num(ctx, 'extraOverM3') : 0),
      ),
      '4.02': formula((ctx) => {
        const excav =
          ctx.excavationM3 * (1 + num(ctx, 'bulkingPct') / 100) +
          (on(ctx, 'includeExtraOver') ? num(ctx, 'extraOverM3') : 0)
        return Math.max(0, excav * (1 - num(ctx, 'reusePct') / 100))
      }, 'derived'),
      '4.03': formula((ctx) => num(ctx, 'importedFillM3')),
      '4.04': formula(
        (ctx) =>
          (ctx.planArea + ctx.perimeter * num(ctx, 'blindingProjectionM', 0.05)) *
          num(ctx, 'blindingThicknessM', 0.05),
      ),
      '4.1': engine(),
      '4.10': engine(),
      '4.11': engine(),
      '4.12': engine(),
      '4.13': conditional('includeWaterproofing', (ctx) => ctx.planArea),
      '4.14': conditional('includeInsulation', (ctx) => ctx.planArea),
      '4.15': formula((ctx) => num(ctx, 'jointLengthM')),
      '4.16': direct('raftBoltsNr'),
    },
  },
  PILE_CAP: {
    fields: footingFields('pileCap'),
    recipes: {
      '5.01': formula(
        (ctx) =>
          ctx.excavationM3 * (1 + num(ctx, 'bulkingPct') / 100) +
          (on(ctx, 'includeExtraOver') ? num(ctx, 'extraOverM3') : 0),
      ),
      '5.02': formula((ctx) => {
        const excav =
          ctx.excavationM3 * (1 + num(ctx, 'bulkingPct') / 100) +
          (on(ctx, 'includeExtraOver') ? num(ctx, 'extraOverM3') : 0)
        return Math.max(0, excav * (1 - num(ctx, 'reusePct') / 100))
      }, 'derived'),
      '5.03': formula((ctx) => num(ctx, 'importedFillM3')),
      '5.04': formula(
        (ctx) =>
          (ctx.planArea + ctx.perimeter * num(ctx, 'blindingProjectionM', 0.05)) *
          num(ctx, 'blindingThicknessM', 0.05),
      ),
      '5.05': engine(),
      '5.06': engine(),
      '5.07': engine(),
      '5.08': conditional('includeWaterproofing', (ctx) => ctx.planArea + ctx.perimeter * num(ctx, 'turnUpHeightM', 0.15)),
      '5.09': formula((ctx) => num(ctx, 'jointLengthM')),
      '5.1': direct('pileCapBoltsNr'),
      '5.10': direct('pileCapCastInsNr'),
    },
  },
  PILES: {
    fields: [
      f('includeCasing', 'Include casing', 'Piles', 'switch', { default: false }),
      f('casingLengthM', 'Casing length', 'Piles', 'number', { unit: 'm' }),
      f('standingTimeHr', 'Standing / idle time', 'Piles', 'number', { unit: 'hr' }),
      f('pileTestsNr', 'Pile tests', 'Piles', 'count', { unit: 'nr' }),
      f('includeCutOff', 'Include cut-off / trimming', 'Piles', 'switch', { default: false }),
    ],
    recipes: {
      '6.06': engine(),
      '6.07': engine(),
      '6.01': formula((ctx) => ctx.units),
      '6.02': formula((ctx) => ctx.length || ctx.units * (ctx.height / Math.max(1, ctx.units))),
      '6.03': conditional('includeCasing', (ctx) => num(ctx, 'casingLengthM') || ctx.length),
      '6.04': formula((ctx) => num(ctx, 'standingTimeHr')),
      '6.05': formula((ctx) => num(ctx, 'pileTestsNr')),
      '6.08': conditional('includeCutOff', (ctx) => ctx.units),
      '6.09': direct('pileTestsNr'),
    },
  },
  EARTHWORKS: {
    fields: [
      f('siteAreaM2', 'Site clearance area', 'Earthworks', 'number', { unit: 'm²' }),
      f('topsoilDepthM', 'Topsoil strip depth', 'Earthworks', 'number', { unit: 'm', default: 0.15 }),
      f('excavationDepthM', 'Average excavation / cut depth', 'Earthworks', 'number', { unit: 'm' }),
      f('cutVolumeM3', 'Measured cut volume (if known)', 'Earthworks', 'number', { unit: 'm³' }),
      f('reusePct', 'Retain / reuse on site', 'Earthworks', 'percent', { unit: '%', default: 0 }),
      f('importedFillM3', 'Imported fill', 'Earthworks', 'number', { unit: 'm³' }),
      f('includeRock', 'Include rock excavation', 'Earthworks', 'switch', { default: false }),
      f('rockM3', 'Rock excavation', 'Earthworks', 'number', { unit: 'm³' }),
      f('includeSupport', 'Include supported excavation', 'Earthworks', 'switch', { default: false }),
      f('supportedFaceM2', 'Supported face area', 'Earthworks', 'number', { unit: 'm²' }),
      f('blindingThicknessM', 'Blinding thickness', 'Blinding', 'number', { unit: 'm', default: 0.05 }),
      f('blindedAreaM2', 'Blinded area', 'Blinding', 'number', { unit: 'm²' }),
      f('geotextileM2', 'Geotextile / membrane area', 'Earthworks', 'number', { unit: 'm²' }),
      f('includeDewatering', 'Include dewatering', 'Earthworks', 'switch', { default: false }),
      f('dewateringItem', 'Dewatering system', 'Earthworks', 'count', { unit: 'item' }),
      f('earthTestsNr', 'Earthworks tests', 'Earthworks', 'count', { unit: 'nr' }),
    ],
    recipes: {
      '7.01': formula((ctx) => num(ctx, 'siteAreaM2') || ctx.planArea),
      '7.02': formula(
        (ctx) => (num(ctx, 'siteAreaM2') || ctx.planArea) * num(ctx, 'topsoilDepthM', 0.15),
      ),
      '7.03': engine(),
      '7.04': formula((ctx) => ctx.excavationM3 || num(ctx, 'cutVolumeM3')),
      '7.05': formula((ctx) => ctx.excavationM3 || num(ctx, 'cutVolumeM3')),
      '7.06': formula((ctx) => ctx.excavationM3 || num(ctx, 'cutVolumeM3')),
      '7.07': conditional('includeRock', (ctx) => num(ctx, 'rockM3')),
      '7.08': formula((ctx) => ctx.excavationM3 || num(ctx, 'cutVolumeM3')),
      '7.09': conditional('includeSupport', (ctx) => num(ctx, 'supportedFaceM2')),
      '7.1': engine(),
      '7.10': engine(),
      '7.11': formula((ctx) => {
        const excav = ctx.excavationM3 || num(ctx, 'cutVolumeM3')
        return excav * (num(ctx, 'reusePct') / 100)
      }, 'derived'),
      '7.12': formula((ctx) => {
        const excav = ctx.excavationM3 || num(ctx, 'cutVolumeM3')
        return excav * (num(ctx, 'reusePct') / 100)
      }, 'derived'),
      '7.13': formula((ctx) => num(ctx, 'importedFillM3')),
      '7.14': formula((ctx) => num(ctx, 'importedFillM3')),
      '7.15': formula((ctx) => num(ctx, 'blindedAreaM2') * num(ctx, 'blindingThicknessM', 0.05)),
      '7.16': formula((ctx) => num(ctx, 'geotextileM2') || num(ctx, 'siteAreaM2')),
      '7.17': formula((ctx) => num(ctx, 'geotextileM2') || num(ctx, 'siteAreaM2')),
      '7.18': formula((ctx) => num(ctx, 'geotextileM2') || num(ctx, 'siteAreaM2')),
      '7.19': conditional('includeDewatering', (ctx) => num(ctx, 'dewateringItem', 1)),
      '7.20': formula((ctx) => num(ctx, 'earthTestsNr')),
      '7.21': formula((ctx) => num(ctx, 'earthTestsNr')),
    },
  },
  COLUMNS: {
    fields: [
      f('includeFairFace', 'Include fair-face formwork', 'Formwork', 'switch', { default: false }),
      f('includeSealer', 'Seal exposed concrete', 'Finishes', 'switch', { default: false }),
      f('startersNr', 'Starter / kicker bars', 'Accessories', 'count', { unit: 'nr' }),
      f('columnOpeningsNr', 'Openings through columns', 'Accessories', 'count', { unit: 'nr' }),
    ],
    recipes: {
      '8.01': engine(),
      '8.02': engine(),
      '8.03': engine(),
      '8.04': conditional('includeFairFace', (ctx) => ctx.formwork),
      '8.05': formula((ctx) => num(ctx, 'startersNr')),
      '8.06': formula((ctx) => num(ctx, 'columnOpeningsNr')),
      '8.07': conditional('includeSealer', (ctx) => ctx.formwork),
      '8.08': formula((ctx) => ctx.units),
      '8.09': formula((ctx) => ctx.units),
    },
  },
  WALLS: {
    fields: [
      f('includeFairFace', 'Include fair-face / second face', 'Formwork', 'switch', { default: false }),
      f('includeWaterproofing', 'Include tanking / DPC', 'Waterproofing', 'switch', { default: false }),
      f('jointLengthM', 'Joint length', 'Accessories', 'number', { unit: 'm' }),
      f('includeSealer', 'Seal exposed concrete', 'Finishes', 'switch', { default: false }),
    ],
    recipes: {
      '9.01': engine(),
      '9.02': engine(),
      '9.03': engine(),
      '9.04': conditional('includeFairFace', (ctx) => ctx.formwork || ctx.faceArea),
      '9.05': conditional('includeFairFace', (ctx) => ctx.formwork || ctx.faceArea),
      '9.06': formula((ctx) => ctx.faceArea),
      '9.07': conditional('includeWaterproofing', (ctx) => ctx.faceArea),
      '9.08': conditional('includeWaterproofing', (ctx) => ctx.length),
      '9.09': formula((ctx) => num(ctx, 'jointLengthM')),
      '9.1': formula((ctx) => ctx.openingArea),
      '9.10': formula((ctx) => ctx.openingArea),
      '9.11': formula((ctx) => ctx.openingArea),
      '9.12': conditional('includeSealer', (ctx) => ctx.faceArea),
      '9.13': formula((ctx) => ctx.units),
      '9.14': formula((ctx) => ctx.faceArea),
      '9.15': formula((ctx) => ctx.length),
      '9.16': formula((ctx) => ctx.openingArea),
    },
  },
  BEAMS: {
    fields: [
      f('includeFairFace', 'Include fair-face formwork', 'Formwork', 'switch', { default: false }),
      f('jointLengthM', 'Joint length', 'Accessories', 'number', { unit: 'm' }),
      f('includeSealer', 'Seal exposed concrete', 'Finishes', 'switch', { default: false }),
    ],
    recipes: {
      '10.01': engine(),
      '10.02': engine(),
      '10.04': engine(),
      '10.03': formula((ctx) => ctx.concrete),
      '10.05': conditional('includeFairFace', (ctx) => ctx.formwork),
      '10.06': formula((ctx) => num(ctx, 'jointLengthM')),
      '10.07': conditional('includeSealer', (ctx) => ctx.formwork),
      '10.08': formula((ctx) => ctx.length),
      '10.09': formula((ctx) => ctx.units),
      '10.1': formula((ctx) => ctx.units),
      '10.10': formula((ctx) => ctx.units),
      '10.11': formula((ctx) => ctx.length),
    },
  },
  SLABS: {
    fields: [
      f('fillDepthM', 'Fill / make-up depth', 'Earthworks', 'number', { unit: 'm' }),
      f('blindingThicknessM', 'Blinding thickness', 'Blinding', 'number', { unit: 'm', default: 0.05 }),
      f('includeWaterproofing', 'Include DPM / waterproofing', 'Waterproofing', 'switch', { default: false }),
      f('includeInsulation', 'Include insulation', 'Insulation', 'switch', { default: false }),
      f('screedThicknessM', 'Screed thickness', 'Finishes', 'number', { unit: 'm', default: 0.05 }),
      f('jointLengthM', 'Joint length', 'Accessories', 'number', { unit: 'm' }),
      f('includeFinish', 'Include surface finish / sealer', 'Finishes', 'switch', { default: false }),
      f('voidFormerM3', 'Void formers', 'Accessories', 'number', { unit: 'm³' }),
    ],
    recipes: {
      '11.08': engine(),
      '11.1': engine(),
      '11.10': engine(),
      '11.11': engine(),
      '14.01': engine(),
      '14.02': engine(),
      '14.03': engine(),
      '11.01': formula((ctx) => ctx.planArea * num(ctx, 'fillDepthM')),
      '11.02': formula((ctx) => ctx.planArea * num(ctx, 'blindingThicknessM', 0.05)),
      '11.03': formula((ctx) => ctx.planArea * num(ctx, 'blindingThicknessM', 0.05)),
      '11.04': conditional('includeWaterproofing', (ctx) => ctx.planArea),
      '11.05': conditional('includeWaterproofing', (ctx) => ctx.planArea),
      '11.06': conditional('includeInsulation', (ctx) => ctx.planArea),
      '11.07': formula((ctx) => ctx.planArea),
      '11.09': formula((ctx) => ctx.concrete),
      '11.12': formula((ctx) => ctx.perimeter * (ctx.thickness / Math.max(1, ctx.units))),
      '11.13': formula((ctx) => num(ctx, 'voidFormerM3')),
      '11.14': formula((ctx) => num(ctx, 'jointLengthM')),
      '11.15': formula((ctx) => num(ctx, 'jointLengthM')),
      '11.16': conditional('includeFinish', (ctx) => ctx.planArea),
      '11.17': conditional('includeFinish', (ctx) => ctx.planArea),
      '11.18': formula((ctx) => ctx.planArea * num(ctx, 'screedThicknessM', 0.05)),
      '11.19': formula((ctx) => ctx.planArea),
      '11.2': formula((ctx) => ctx.planArea),
      '11.20': formula((ctx) => ctx.planArea),
      '11.21': formula((ctx) => ctx.perimeter),
      '11.22': formula((ctx) => ctx.units),
      '14.04': conditional('includeWaterproofing', (ctx) => ctx.planArea),
      '14.05': conditional('includeWaterproofing', (ctx) => ctx.planArea),
      '14.06': conditional('includeWaterproofing', (ctx) => ctx.planArea),
      '14.07': formula((ctx) => ctx.planArea * num(ctx, 'screedThicknessM', 0.05)),
      '14.08': formula((ctx) => num(ctx, 'jointLengthM')),
      '14.09': conditional('includeFinish', (ctx) => ctx.planArea),
      '14.1': formula((ctx) => ctx.planArea),
      '14.10': formula((ctx) => ctx.planArea),
      '14.11': formula((ctx) => ctx.planArea),
      '14.12': formula((ctx) => ctx.planArea),
      '14.13': formula((ctx) => ctx.perimeter),
      '14.14': formula((ctx) => ctx.planArea),
      '14.15': formula((ctx) => ctx.units),
      '14.16': formula((ctx) => ctx.planArea),
    },
  },
  STAIRS: {
    fields: [
      f('includeFinish', 'Include nosings / finish', 'Finishes', 'switch', { default: false }),
      f('includeBalustrade', 'Include balustrade / sides', 'Accessories', 'switch', { default: false }),
    ],
    recipes: {
      '12.01': engine(),
      '12.02': engine(),
      '12.03': engine(),
      '12.04': formula((ctx) => ctx.riserLm || ctx.length),
      '12.05': conditional('includeBalustrade', (ctx) => ctx.sideLm || ctx.length),
      '12.06': conditional('includeFinish', (ctx) => ctx.planArea || ctx.length * ctx.width),
      '12.07': formula((ctx) => ctx.units),
      '12.08': formula((ctx) => ctx.formwork),
      '12.09': formula((ctx) => ctx.units),
      '12.1': formula((ctx) => ctx.length),
      '12.10': formula((ctx) => ctx.length),
      '12.11': formula((ctx) => ctx.units),
    },
  },
  RAMPS: {
    fields: [
      f('includeFinish', 'Include surface finish', 'Finishes', 'switch', { default: false }),
      f('includeUpstand', 'Include upstand / kerb', 'Accessories', 'switch', { default: false }),
    ],
    recipes: {
      '13.01': engine(),
      '13.02': engine(),
      '13.03': engine(),
      '13.04': conditional('includeFinish', (ctx) => ctx.planArea),
      '13.05': conditional('includeUpstand', (ctx) => ctx.length),
      '13.06': formula((ctx) => ctx.formwork),
      '13.07': formula((ctx) => ctx.units),
      '13.08': formula((ctx) => ctx.planArea),
      '13.09': formula((ctx) => ctx.length),
      '13.1': formula((ctx) => ctx.units),
      '13.10': formula((ctx) => ctx.units),
      '13.11': formula((ctx) => ctx.planArea),
      '13.12': formula((ctx) => ctx.length),
      '13.13': formula((ctx) => ctx.formwork),
      '13.14': formula((ctx) => ctx.units),
    },
  },
  MASONRY: {
    fields: [
      f('includeInsulation', 'Include cavity insulation', 'Insulation', 'switch', { default: false }),
      f('includeTies', 'Include wall ties', 'Accessories', 'switch', { default: true }),
      f('includeDpc', 'Include DPC', 'Accessories', 'switch', { default: false }),
      f('tieRatePerM2', 'Ties per m²', 'Accessories', 'number', { unit: 'nr/m²', default: 5 }),
      f('closerLengthM', 'Cavity closer length', 'Accessories', 'number', { unit: 'm' }),
      f('fireStopM', 'Fire-stopping length', 'Accessories', 'number', { unit: 'm' }),
    ],
    recipes: {
      '13.01': formula((ctx) => ctx.faceArea || ctx.area),
      '13.02': formula((ctx) => ctx.faceArea || ctx.area),
      '13.03': formula((ctx) => ctx.faceArea || ctx.area),
      '13.04': formula((ctx) => ctx.faceArea || ctx.area),
      '13.05': formula((ctx) => ctx.faceArea || ctx.area),
      '13.06': formula((ctx) => ctx.faceArea || ctx.area),
      '13.07': conditional('includeInsulation', (ctx) => ctx.faceArea || ctx.area),
      '13.08': conditional('includeTies', (ctx) => (ctx.faceArea || ctx.area) * num(ctx, 'tieRatePerM2', 5)),
      '13.09': conditional('includeDpc', (ctx) => ctx.length),
      '13.1': formula((ctx) => ctx.openingArea),
      '13.10': formula((ctx) => ctx.openingArea),
      '13.11': formula((ctx) => ctx.openingArea),
      '13.12': formula((ctx) => num(ctx, 'closerLengthM') || ctx.openingArea),
      '13.13': formula((ctx) => ctx.length),
      '13.14': formula((ctx) => num(ctx, 'fireStopM')),
      '13.15': formula((ctx) => ctx.faceArea || ctx.area),
      '13.16': formula((ctx) => ctx.faceArea || ctx.area),
      '13.17': formula((ctx) => ctx.units),
      '13.18': formula((ctx) => ctx.length),
      '13.19': formula((ctx) => ctx.faceArea || ctx.area),
      '13.2': formula((ctx) => ctx.openingArea),
      '13.20': formula((ctx) => ctx.openingArea),
      '13.21': formula((ctx) => ctx.units),
    },
  },
  DOORS_WINDOWS: {
    fields: [
      f('ironmongerySetsNr', 'Ironmongery sets', 'Accessories', 'count', { unit: 'nr' }),
      f('includeArchitrave', 'Include architraves / frames', 'Accessories', 'switch', { default: false }),
      f('includeGuards', 'Include guards / screens', 'Accessories', 'switch', { default: false }),
    ],
    recipes: rangedRecipes('14', 25, () =>
      formula((ctx) => ctx.nos || ctx.units),
    ),
  },
  LINTELS: {
    fields: [
      f('includeBearing', 'Include extra bearing / padstones', 'Accessories', 'switch', { default: false }),
      f('padstonesNr', 'Padstones', 'Accessories', 'count', { unit: 'nr' }),
    ],
    recipes: {
      '15.01': formula((ctx) => ctx.length),
      '15.02': formula((ctx) => ctx.concrete || ctx.length * (ctx.width / Math.max(1, ctx.units)) * (ctx.thickness / Math.max(1, ctx.units))),
      '15.03': formula((ctx) => ctx.formwork),
      '15.04': formula((ctx) => ctx.units),
      '15.05': conditional('includeBearing', (ctx) => num(ctx, 'padstonesNr') || ctx.units * 2),
      '15.06': formula((ctx) => ctx.length),
      '15.07': formula((ctx) => ctx.units),
      '15.08': formula((ctx) => ctx.length),
      '15.09': formula((ctx) => ctx.units),
    },
  },
  FLOOR_FINISH: {
    fields: [
      f('includePrep', 'Include preparation / primer / DPM', 'Preparation', 'switch', { default: true }),
      f('screedThicknessM', 'Screed thickness', 'Screed', 'number', { unit: 'm', default: 0.05 }),
      f('includeJoints', 'Include movement joints', 'Accessories', 'switch', { default: false }),
      f('jointLengthM', 'Joint / perimeter seal length', 'Accessories', 'number', { unit: 'm' }),
      f('matNr', 'Entrance mats', 'Accessories', 'count', { unit: 'nr' }),
    ],
    recipes: rangedRecipes('16', 23, (_ref, n) =>
      formula((ctx) => {
        if (on(ctx, 'includePrep') === false && n <= 3) return 0
        if (n === 4) return ctx.area * num(ctx, 'screedThicknessM', 0.05)
        if (n === 22 || n === 21) return num(ctx, 'jointLengthM') || ctx.length
        if (n === 19) return num(ctx, 'matNr')
        return ctx.area
      }),
    ),
  },
  WALL_FINISH: {
    fields: [
      f('includePrep', 'Include preparation / dubbing', 'Preparation', 'switch', { default: true }),
      f('coatsNr', 'Paint coats (factor)', 'Finishes', 'number', { default: 2 }),
    ],
    recipes: rangedRecipes('17', 17, (_ref, n) =>
      formula((ctx) => {
        if (on(ctx, 'includePrep') === false && n <= 2) return 0
        return ctx.faceArea || ctx.area
      }),
    ),
  },
  CEILING_FINISH: {
    fields: [
      f('includeGrid', 'Include suspension grid / hangers', 'Accessories', 'switch', { default: false }),
      f('accessPanelsNr', 'Access panels', 'Accessories', 'count', { unit: 'nr' }),
    ],
    recipes: rangedRecipes('18', 17, (_ref, n) =>
      formula((ctx) => {
        if (n === 16 || n === 17) return num(ctx, 'accessPanelsNr')
        return ctx.area
      }),
    ),
  },
  SKIRTING: {
    fields: [
      f('includeCorners', 'Count internal / external corners', 'Accessories', 'switch', { default: true }),
    ],
    recipes: {
      '19.01': formula((ctx) => ctx.length),
      '19.02': formula((ctx) => ctx.length),
      '19.03': conditional('includeCorners', (ctx) => ctx.units * 4),
    },
  },
  DUCTS: {
    fields: [
      f('includeInsulation', 'Include insulation / cladding', 'Insulation', 'switch', { default: false }),
      f('includeAttenuators', 'Include attenuators / access doors', 'Accessories', 'switch', { default: false }),
      f('accessoriesNr', 'Attenuators, access doors, firestops', 'Accessories', 'count', { unit: 'nr' }),
    ],
    recipes: {},
  },
  DUCT_FITTINGS: {
    fields: [
      f('fittingsNr', 'Fittings (bends, tees, reducers)', 'Fittings', 'count', { unit: 'nr' }),
    ],
    recipes: {},
  },
  PIPES: {
    fields: [
      f('includeInsulation', 'Include pipe insulation', 'Insulation', 'switch', { default: false }),
      f('includeFittings', 'Include fittings from schedule', 'Fittings', 'switch', { default: true }),
    ],
    recipes: {},
  },
  ELECTRICAL: {
    fields: [
      f('includeContainment', 'Include containment from cable length', 'Containment', 'switch', { default: true }),
      f('pointsNr', 'Outlets / points / fittings', 'Accessories', 'count', { unit: 'nr' }),
    ],
    recipes: {},
  },
}

function unitMethodField(unit: string): { type: DriverField['type']; unit: string; group: string } {
  const value = unit.trim().toLowerCase().replace(/\s/g, '').replace(/²/g, '2').replace(/³/g, '3')
  if (/^(nr|no|nos|item|each|ea)$/.test(value)) return { type: 'count', unit, group: 'Counts' }
  if (/^(m|lm|linm)$/.test(value)) return { type: 'number', unit: 'm', group: 'Lengths' }
  if (/^(m2|sqm)$/.test(value)) return { type: 'number', unit: 'm²', group: 'Areas' }
  if (/^(m3|cum)$/.test(value)) return { type: 'number', unit: 'm³', group: 'Volumes' }
  if (/^(kg|t|ton|tonne)$/.test(value)) return { type: 'number', unit, group: 'Weight' }
  if (/^(hr|hour|day|week|wk|month|mth)$/.test(value)) return { type: 'number', unit, group: 'Time' }
  if (/^(%|percent|pct)$/.test(value)) return { type: 'percent', unit: '%', group: 'Percentages' }
  return { type: 'number', unit, group: 'Additional measured work' }
}

export function directFieldKey(lineKey: string): string {
  return `direct:${lineKey}`
}

export function isPrelimHeading(elementKey: string): boolean {
  return /^CAT_M00_/i.test(elementKey)
}

/** wk / GFA m² / % of contract stay with evaluatePrelimQty — not driver cells. */
export function isPrelimAutoUnit(unit: string): boolean {
  const value = unit.trim().toLowerCase().replace(/\s/g, '').replace(/²/g, '2')
  return (
    value === 'wk' ||
    value === 'week' ||
    value === 'weeks' ||
    value === 'm2' ||
    value === 'sqm' ||
    value === '%' ||
    value === 'percent' ||
    value === 'pct'
  )
}

function synthKey(category: string, unit: string): string {
  const cat = (category || 'Measured').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
  const u = unit.replace(/[^a-zA-Z0-9]+/g, '') || 'qty'
  return `synth:${cat || 'Measured'}:${u}`
}

/** Catalogue-only headings: share one driver per work-category + unit for derived lines. */
export function synthesizeFromLines(
  elementKey: string,
  lines: SelectedLineLite[],
): ElementTakeoffSchema {
  const fields: DriverField[] = []
  const recipes: Record<string, LineRecipe> = {}
  const fieldByKey = new Map()

  const addField = (field: DriverField) => {
    const existing = fieldByKey.get(field.key)
    if (existing) {
      existing.feeds = [...new Set([...(existing.feeds || []), ...(field.feeds || [])])]
      return existing
    }
    fieldByKey.set(field.key, field)
    fields.push(field)
    return field
  }

  for (const line of lines) {
    const ref = (line.catalogueRef || '').trim()
    const id = (line.lineKey || ref).trim()
    if (!ref && !id) continue
    if (isPrelimHeading(elementKey) && isPrelimAutoUnit(line.unit || '')) {
      recipes[ref] = engine()
      if (id) recipes[id] = engine()
      continue
    }
    const meta = unitMethodField(line.unit || '')
    const derived = (line.quantityBasis || '') === 'derived'
    if (derived) {
      const key = synthKey(line.workCategory || meta.group, meta.unit)
      addField({
        key,
        label: `${line.workCategory || meta.group} (${meta.unit})`,
        group: line.workCategory || meta.group,
        type: meta.type,
        unit: meta.unit,
        feeds: [ref],
      })
      const recipe = direct(key)
      recipes[ref] = recipe
      if (id) recipes[id] = recipe
      continue
    }
    const key = directFieldKey(id || ref)
    addField({
      key,
      label: shortLabel(line.description, line.unit),
      group: 'Additional measured work',
      type: meta.type,
      unit: meta.unit,
      feeds: [ref],
    })
    const recipe = direct(key)
    recipes[ref] = recipe
    if (id) recipes[id] = recipe
  }
  return { fields, recipes }
}

export function recipeForRef(
  elementKey: string,
  ref: string,
): LineRecipe | undefined {
  const schema = ELEMENT_SCHEMAS[elementKey]
  if (!schema) return undefined
  return (
    schema.recipes[ref] ||
    schema.recipes[ref.replace(/\.0(\d+)$/, '.$1')] ||
    schema.recipes[ref.replace(/\.(\d)$/, '.0$1')]
  )
}

export function schemaForElement(elementKey: string, engineKey?: string): ElementTakeoffSchema | undefined {
  return ELEMENT_SCHEMAS[elementKey] || (engineKey ? ELEMENT_SCHEMAS[engineKey] : undefined)
}

export type SelectedLineLite = {
  lineKey?: string
  catalogueRef: string
  description: string
  unit: string
  quantityBasis?: string
  workCategory?: string
}

/** Merge dedicated schema with generated direct fields for unmatched selected lines. */
export function visibleSchemaForLines(
  elementKey: string,
  lines: SelectedLineLite[],
  engineKey?: string,
): { fields: DriverField[]; recipes: Record<string, LineRecipe> } {
  const resolvedEngine = (engineKey || '').trim() || elementKey
  const dedicated = schemaForElement(elementKey, engineKey)
  const base = dedicated || synthesizeFromLines(elementKey, lines)
  const recipes = { ...base.recipes }
  const fields: DriverField[] = base.fields.map((field) => ({
    ...field,
    feeds: field.feeds ? [...field.feeds] : [],
  }))
  const fieldByKey = new Map(fields.map((field) => [field.key, field]))
  const extra: DriverField[] = []

  const usedKeys = new Set()
  let needsHeadingDrivers = false
  const markFeed = (key: string | undefined, ref: string) => {
    if (!key) return
    usedKeys.add(key)
    const field = fieldByKey.get(key)
    if (field) {
      field.feeds = [...new Set([...(field.feeds || []), ref])]
    }
  }

  for (const line of lines) {
    const ref = (line.catalogueRef || '').trim()
    const id = (line.lineKey || ref).trim()
    if (isPrelimHeading(elementKey) && isPrelimAutoUnit(line.unit || '')) {
      recipes[ref] = engine()
      if (id) recipes[id] = engine()
      continue
    }
    let recipe = recipes[ref] || recipes[id]
    if (!recipe) {
      const mep = mepRecipe(resolvedEngine, line)
      if (mep) {
        recipe = mep
        recipes[ref] = mep
        if (id) recipes[id] = mep
      }
    }
    if (recipe && recipe.kind === 'engine') continue
    needsHeadingDrivers = true
    if (!recipe || recipe.kind === 'direct') {
      const key = recipe?.directField || directFieldKey(id)
      recipe = { kind: 'direct', directField: key, source: 'input' }
      recipes[ref] = recipe
      recipes[id] = recipe
      if (!fieldByKey.has(key)) {
        const meta = unitMethodField(line.unit || '')
        const generated: DriverField = {
          key,
          label: shortLabel(line.description, line.unit),
          group: 'Additional measured work',
          type: meta.type,
          unit: meta.unit,
          feeds: [ref],
        }
        extra.push(generated)
        fieldByKey.set(key, generated)
      }
      markFeed(key, ref)
      continue
    }
    if (recipe.kind === 'engine') continue
    if (recipe.switchKey) markFeed(recipe.switchKey, ref)
    if (recipe.directField) markFeed(recipe.directField, ref)
    for (const field of fields) {
      if (recipeUsesField(recipe, field.key)) markFeed(field.key, ref)
    }
  }

  const visible = [...fields, ...extra].filter((field) => {
    if (extra.includes(field)) return true
    if (needsHeadingDrivers && fields.includes(field)) return true
    if ((field.feeds || []).length) return true
    return usedKeys.has(field.key)
  })
  return { fields: visible, recipes }
}

function shortLabel(description: string, unit: string): string {
  const text = (description || 'Measured quantity').replace(/\s+/g, ' ').trim()
  const clipped = text.length > 72 ? `${text.slice(0, 69)}…` : text
  return unit ? `${clipped} (${unit})` : clipped
}

function recipeUsesField(recipe: LineRecipe, key: string): boolean {
  if (recipe.switchKey === key || recipe.directField === key) return true
  if (!recipe.formula) return false
  const src = recipe.formula.toString()
  return src.includes(`'${key}'`) || src.includes(`"${key}"`)
}

function mepRecipe(elementKey: string, line: SelectedLineLite): LineRecipe | undefined {
  const unit = (line.unit || '').toLowerCase().replace(/\s/g, '')
  const desc = (line.description || '').toLowerCase()
  if (elementKey === 'DUCTS') {
    if (unit.includes('m3') || unit === 'kg' || unit === 't') {
      return formula((ctx) => ctx.surface || ctx.length)
    }
    if (unit === 'm2' || unit === 'm²' || desc.includes('surface') || desc.includes('insulat')) {
      return conditional('includeInsulation', (ctx) => ctx.surface || ctx.length)
    }
    if (unit === 'nr' || unit === 'no' || unit === 'item') {
      return conditional('includeAttenuators', (ctx) => num(ctx, 'accessoriesNr') || ctx.joints || ctx.units)
    }
    if (unit === 'm' || unit === 'lm') return formula((ctx) => ctx.length)
  }
  if (elementKey === 'PIPES') {
    if (desc.includes('insulat') || unit === 'm2' || unit === 'm²') {
      return conditional('includeInsulation', (ctx) => ctx.insulation || ctx.length)
    }
    if (unit === 'nr' || unit === 'no') {
      return conditional('includeFittings', (ctx) => ctx.fittings || ctx.units)
    }
    if (unit === 'm' || unit === 'lm') return formula((ctx) => ctx.length)
  }
  if (elementKey === 'DUCT_FITTINGS') {
    if (unit === 'nr' || unit === 'no') return formula((ctx) => num(ctx, 'fittingsNr') || ctx.nos || ctx.units)
    if (unit === 'm') return formula((ctx) => ctx.equivalentLength || ctx.length)
  }
  if (elementKey === 'ELECTRICAL') {
    if (unit === 'm' || unit === 'lm') {
      return conditional('includeContainment', (ctx) => ctx.length || ctx.cable)
    }
    if (unit === 'nr' || unit === 'no' || unit === 'item') {
      return formula((ctx) => num(ctx, 'pointsNr') || ctx.nos || ctx.units)
    }
  }
  return undefined
}

export function evaluateRecipe(
  recipe: LineRecipe,
  ctx: HeadingContext,
  shared: Record<string, unknown>,
): { quantity: number; source: 'input' | 'derived' } | null {
  if (recipe.kind === 'engine') return null
  if (recipe.kind === 'direct' && recipe.directField) {
    const raw = shared[recipe.directField]
    if (raw == null || raw === '') return null
    return {
      quantity: round6(sharedNum(shared, recipe.directField)),
      source: 'input',
    }
  }
  if (recipe.switchKey && !sharedOn(shared, recipe.switchKey)) {
    return { quantity: 0, source: 'derived' }
  }
  if (recipe.formula) {
    return {
      quantity: round6(recipe.formula(ctx)),
      source: recipe.source || (recipe.kind === 'conditional' ? 'derived' : 'input'),
    }
  }
  return null
}

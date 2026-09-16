export type DriverFieldType = 'number' | 'percent' | 'switch' | 'count'

export type DriverField = {
  key: string
  label: string
  group: string
  type: DriverFieldType
  unit?: string
  default?: number | boolean
  /** Catalogue refs this field helps quantify. Filled when serving schema. */
  feeds?: string[]
}

export type HeadingContext = {
  units: number
  planArea: number
  length: number
  width: number
  thickness: number
  height: number
  perimeter: number
  openingArea: number
  excavationM3: number
  concrete: number
  formwork: number
  faceArea: number
  area: number
  nos: number
  surface: number
  joints: number
  insulation: number
  fittings: number
  screed: number
  tiles: number
  riserLm: number
  sideLm: number
  cable: number
  equivalentLength: number
  shared: Record<string, unknown>
}

export type LineRecipe = {
  kind: 'engine' | 'formula' | 'conditional' | 'direct'
  formula?: (ctx: HeadingContext) => number
  switchKey?: string
  directField?: string
  source?: 'input' | 'derived'
}

export type ElementTakeoffSchema = {
  fields: DriverField[]
  recipes: Record<string, LineRecipe>
}

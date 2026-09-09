export const BOQ_PACK_PROFILE = 'PROJECT_ISSUE_TRACKER_V1'
export const BOQ_PACK_PARSER_VERSION = 'issue-tracker-v1'

export type QuantityBasis = 'independent' | 'derived' | 'conditional'
export type BindingKind = 'ENGINE' | 'CATALOGUE'
export type ElementScope = 'PROJECT' | 'FLOOR'

export type ParsedBoqPackModule = {
  moduleNo: number
  moduleKey: string
  title: string
  discipline: string
  sourceSheet: string
  sortOrder: number
  elementCount: number
  itemCount: number
}

export type ParsedBoqPackElement = {
  moduleNo: number
  elementRef: string
  label: string
  normalizedLabel: string
  elementKey: string
  bindingKind: BindingKind
  engineKey?: string
  scope: ElementScope
  applicableLevelsRaw: string[]
  sortOrder: number
}

export type ParsedBoqPackItem = {
  moduleNo: number
  ref: string
  lineKey: string
  elementKey: string
  elementRef: string
  description: string
  unit: string
  applicableLevelRaw: string
  formulaText: string
  quantityBasis: QuantityBasis
  sourceSheet: string
  sourceRow: number
  sortOrder: number
}

export type ParsedBoqPackRate = {
  lineKey: string
  labour: number
  material: number
  plant: number
  subcontract: number
  wastePct: number
  ohpPct: number
  directCost: number
  compositeRate: number
  sourceSheet: string
  sourceRow: number
}

export type ParsedBoqPackResource = {
  code: string
  category: 'MAT' | 'LAB' | 'PLT' | 'SUB' | 'OTHER'
  description: string
  unit: string
  unitRate: number
  wastePct: number
  sortOrder: number
}

export type ParsedBoqPackAnalysisLine = {
  sourceCode: string
  quantity: number
  remarks: string
  sortOrder: number
}

export type ParsedBoqPackAnalysis = {
  lineKey: string
  moduleNo: number
  ref: string
  description: string
  unit: string
  lines: ParsedBoqPackAnalysisLine[]
  allowances: {
    transportPctMaterials: number
    sundriesPctLabourPlantSubcontract: number
    overheadPct: number
    profitPct: number
  }
  sourceSheet: string
  sourceRow: number
}

export type ParsedIssueTrackerPack = {
  profile: typeof BOQ_PACK_PROFILE
  parserVersion: typeof BOQ_PACK_PARSER_VERSION
  sourceFileName: string
  pricing: {
    currency: string
    location?: string
    taxInclusive: boolean
  }
  modules: ParsedBoqPackModule[]
  elements: ParsedBoqPackElement[]
  items: ParsedBoqPackItem[]
  rates: ParsedBoqPackRate[]
  resources: ParsedBoqPackResource[]
  analyses: ParsedBoqPackAnalysis[]
  analysisCount: number
  warnings: string[]
  errors: string[]
}

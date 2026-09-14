import catalogueJson from '../reports/boqCatalogue/catalogue.json'
import type { BoqCatalogueFile } from '../reports/boqCatalogue/types'

const file = catalogueJson as BoqCatalogueFile

function moduleFromSheet(sheet: string): number | null {
  const m = /module\s+(\d+)/i.exec(String(sheet || ''))
  if (!m) return null
  return Number(m[1])
}

function catalogueKey(moduleNo: number, ref: string): string {
  return `${moduleNo}:${String(ref || '').trim()}`
}

const CATALOGUE_WC: Record<string, string> = {}
for (let i = 0; i < file.items.length; i++) {
  const it = file.items[i]
  const mod = moduleFromSheet(it.sheet)
  if (mod == null) continue
  const k = catalogueKey(mod, it.ref)
  if (!CATALOGUE_WC[k] && it.workCategory) CATALOGUE_WC[k] = it.workCategory
}

function headingWorkCategory(elementKey: string, headingLabel: string): string | null {
  if (elementKey === 'CEILING_FINISH') return 'Ceiling Finishes'
  if (elementKey === 'FLOOR_FINISH') return null
  if (elementKey === 'WALL_FINISH') return 'Wall Finishes'
  if (elementKey === 'DOORS_WINDOWS') return 'Doors & Windows'
  if (elementKey === 'LINTELS') return 'Lintels'
  const label = String(headingLabel || '').trim()
  if (!label) return null
  return null
}

/**
 * Work category stored on pack items and copied onto selected BOQ.
 * Modules 1–2 prefer catalogue.json, then ordered description rules.
 * Other modules use Prelims / MEP / Finishes / heading — never unit-based Formwork.
 */
export function classifyPackWorkCategory(args: {
  moduleNo: number
  ref: string
  description: string
  unit: string
  elementKey: string
  headingLabel: string
}): string {
  const moduleNo = args.moduleNo
  const elementKey = args.elementKey
  const heading = String(args.headingLabel || '').trim()
  const d = String(args.description || '').toLowerCase()

  if (moduleNo === 0) return 'Prelims'
  if (moduleNo === 17) return 'Finishes'
  if (moduleNo >= 3 && moduleNo <= 16) {
    if (moduleNo === 10) return heading || 'Other'
    if (moduleNo === 12) return heading || 'Other'
    return 'MEP'
  }

  const headingCat = headingWorkCategory(elementKey, heading)
  if (headingCat) return headingCat

  const fromCat = CATALOGUE_WC[catalogueKey(moduleNo, args.ref)]
  if (fromCat) {
    if (elementKey === 'CEILING_FINISH' && /floor finishes/i.test(fromCat)) {
      return 'Ceiling Finishes'
    }
    return fromCat
  }

  if (
    /waterproof|tanking|\bdpm\b|damp-proof|gas-resistant membrane|protection board|protection fleece|vapour-control/.test(
      d,
    )
  ) {
    return 'Waterproofing'
  }
  if (/\binsulation\b|\binsulat/.test(d)) return 'Insulation'
  if (/\bexcavat/.test(d) || /\bbackfill\b/.test(d) || /\bgranular base\b/.test(d)) {
    return 'Earthworks'
  }
  if (/\bdispos|\bcart away|\bspoil|\bhaul/.test(d)) return 'Earthworks'
  if (/\bblinding\b/.test(d)) return 'Blinding'
  if (
    /\brebar\b|\breinforcement\b|\bhigh-yield\b|\breinforcing\b|\bsteel bar|\bmesh\b/.test(
      d,
    )
  ) {
    return 'Reinforcement'
  }
  if (/\bformwork\b|\bfalsework\b/.test(d)) return 'Formwork'
  if (/\bmortar\b/.test(d)) return 'Mortar'
  if (
    (/\bmasonry\b|\bblock work\b|\bblockwork\b|\bbrick\b/.test(d) ||
      (/\bstone\b/.test(d) &&
        /\bfoundation|rubble|walling|mason/.test(d) &&
        !/\bfloor|cladding|cill|sill|worktop|window board/.test(d))) &&
    elementKey !== 'FLOOR_FINISH' &&
    elementKey !== 'WALL_FINISH'
  ) {
    return 'Masonry'
  }
  if (/\bscreed\b/.test(d)) return 'Screed'
  if (
    /\btile\b|\btiling\b/.test(d) &&
    elementKey !== 'CEILING_FINISH' &&
    !/ceiling|acoustic|mineral-fibre|mineral fibre/.test(d)
  ) {
    return 'Tiling'
  }
  if (/\bplaster\b/.test(d)) return 'Plaster'
  if (/\bpaint\b|\bemulsion\b|\bsealer\b|\bfair-faced\b/.test(d)) {
    if (elementKey === 'CEILING_FINISH' || elementKey === 'WALL_FINISH') {
      return elementKey === 'CEILING_FINISH' ? 'Ceiling Finishes' : 'Wall Finishes'
    }
    return 'Paint'
  }
  if (/\bconcrete\b/.test(d)) return 'Concrete'

  if (elementKey === 'EARTHWORKS') return 'Earthworks'
  if (elementKey === 'MASONRY' || elementKey === 'STONE_STRIP') return 'Masonry'
  if (heading) return heading
  return 'Other'
}

import fs from 'fs'
import path from 'path'

const SEED_NAMES = [
  'PROJECT  ISSUE TRACKER.xlsx',
  'PROJECT ISSUE TRACKER.xlsx',
]

const CLIENT_DOWNLOADS_XLSX = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Downloads',
  'PROJECT  ISSUE TRACKER.xlsx',
)

function candidateDirs(): string[] {
  const cwd = process.cwd()
  const here = __dirname
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const fromEnv = (process.env.BOQ_PACK_SEED_XLSX || '').trim()
  const dirs = [
    path.join(home, 'Downloads'),
    path.join(cwd, 'fixtures', 'boq-pack'),
    path.join(here, '..', '..', '..', 'fixtures', 'boq-pack'),
    path.join(here, '__fixtures__'),
  ]
  if (fromEnv) {
    return [path.dirname(fromEnv), ...dirs]
  }
  return dirs
}

function envExactPath(): string | null {
  const fromEnv = (process.env.BOQ_PACK_SEED_XLSX || '').trim()
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv
  return null
}

/** Client Issue Tracker: Downloads first, then shipped fixtures. Upload still replaces an ACTIVE pack. */
export function resolveDefaultBoqPackSeedPath(): string | null {
  const exact = envExactPath()
  if (exact) return exact
  if (CLIENT_DOWNLOADS_XLSX && fs.existsSync(CLIENT_DOWNLOADS_XLSX)) {
    return CLIENT_DOWNLOADS_XLSX
  }
  for (const dir of candidateDirs()) {
    for (const name of SEED_NAMES) {
      const p = path.join(dir, name)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

let cached: {
  buffer: Buffer
  fileName: string
  path: string
} | null = null

export function readDefaultBoqPackSeed(): {
  buffer: Buffer
  fileName: string
  path: string
} | null {
  if (cached) return cached
  const seedPath = resolveDefaultBoqPackSeedPath()
  if (!seedPath) return null
  const buffer = fs.readFileSync(seedPath)
  if (!buffer.length) return null
  cached = {
    buffer,
    fileName: path.basename(seedPath),
    path: seedPath,
  }
  return cached
}

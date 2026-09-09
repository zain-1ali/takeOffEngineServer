import type { Types } from 'mongoose'
import { Project } from '../../models/Project'
import {
  findActiveBoqPack,
  persistBoqPackFromWorkbook,
} from './persistBoqPack'
import { readDefaultBoqPackSeed } from './seedPath'

const inflight = new Map()

/**
 * Load the shipped Issue Tracker catalogue when the project has no ACTIVE pack.
 * Upload remains the way to replace it. Missing seed file is a no-op.
 */
export async function ensureDefaultBoqPack(opts: {
  projectId: Types.ObjectId
  projectCurrency?: string
}) {
  const existing = await findActiveBoqPack(opts.projectId)
  if (existing) return existing

  const key = opts.projectId.toString()
  const running = inflight.get(key)
  if (running) return running

  const job = seedIfMissing(opts).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, job)
  return job
}

async function seedIfMissing(opts: {
  projectId: Types.ObjectId
  projectCurrency?: string
}) {
  const raced = await findActiveBoqPack(opts.projectId)
  if (raced) return raced

  const seed = readDefaultBoqPackSeed()
  if (!seed) {
    console.warn(
      '[boq-pack] No default Issue Tracker workbook found; project will use catalogue.json until a workbook is uploaded.',
    )
    return null
  }

  let projectCurrency = opts.projectCurrency || ''
  if (!projectCurrency) {
    const project = await Project.findById(opts.projectId).select({ currency: 1 })
    projectCurrency = project?.currency || ''
  }

  try {
    await persistBoqPackFromWorkbook({
      projectId: opts.projectId,
      buffer: seed.buffer,
      fileName: seed.fileName,
      projectCurrency,
    })
  } catch (err) {
    console.error('[boq-pack] Failed to seed default Issue Tracker workbook', err)
    return findActiveBoqPack(opts.projectId)
  }

  return findActiveBoqPack(opts.projectId)
}

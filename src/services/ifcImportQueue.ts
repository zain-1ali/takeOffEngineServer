/**
 * In-process IFC parse queue (p-queue). Uploaded files live on disk until the
 * job runs, then are deleted. Concurrency 1 — IFC parse is memory-heavy.
 *
 * Results land as PENDING IfcSuggestion documents (not only embedded on the job).
 */
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { IfcImportJob } from '../models/IfcImportJob';
import { IfcSuggestion } from '../models/IfcSuggestion';
import { buildIfcSuggestionsFromParse } from './ifcBuildSuggestions';
import { parseIfc } from './ifcImport';

// p-queue v6 interop: under tsx/CJS, require() yields `{ default: PQueue }`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PQueueMod = require('p-queue');
const PQueue = PQueueMod.default ?? PQueueMod;

const queue = new PQueue({ concurrency: 1 });

export function enqueueIfcImport(jobId: string) {
  void queue.add(() => runIfcImportJob(jobId));
}

/** Exposed for tests — runs the worker body directly. */
export async function runIfcImportJob(jobId: string): Promise<void> {
  const job = await IfcImportJob.findById(jobId);
  if (!job) return;

  const tempPath = job.tempFilePath ? String(job.tempFilePath) : '';
  if (!tempPath) {
    job.status = 'FAILED';
    job.error =
      'Uploaded IFC was lost before processing (server restart?)';
    await job.save();
    return;
  }

  job.status = 'RUNNING';
  job.error = null;
  await job.save();

  try {
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(tempPath);
    } catch {
      job.status = 'FAILED';
      job.error =
        'Uploaded IFC was lost before processing (server restart?)';
      await job.save();
      return;
    }

    if (!buffer.length) {
      job.status = 'FAILED';
      job.error = 'Uploaded IFC file was empty';
      await job.save();
      return;
    }

    const result = await parseIfc(buffer);
    const built = buildIfcSuggestionsFromParse(result);

    await IfcSuggestion.deleteMany({ jobId: job._id });
    if (built.length) {
      await IfcSuggestion.insertMany(
        built.map((s) => ({
          projectId: job.projectId,
          jobId: job._id,
          ...s,
        })),
      );
    }

    // Keep a thin embedded mirror for older clients / job summary UI.
    job.suggestions = built
      .filter((s) => s.entityType === 'IfcWall')
      .map((s) => ({
        id: randomUUID(),
        sourceGlobalId: s.sourceGlobalId,
        expressId: s.expressId,
        elementKey: 'WALLS' as const,
        name: s.name,
        mark: s.mappedInstanceData?.mark ?? null,
        shape:
          s.mappedInstanceData?.shape === 'LINEAR' ||
          s.mappedInstanceData?.shape === 'CURVED'
            ? s.mappedInstanceData.shape
            : null,
        geometry: s.mappedInstanceData?.geometry
          ? {
              thickness: Number(s.mappedInstanceData.geometry.thickness) || 0,
              height: Number(s.mappedInstanceData.geometry.height) || 0,
              ...(s.mappedInstanceData.geometry.length != null
                ? { length: Number(s.mappedInstanceData.geometry.length) }
                : {}),
              ...(s.mappedInstanceData.geometry.radius != null
                ? { radius: Number(s.mappedInstanceData.geometry.radius) }
                : {}),
              ...(s.mappedInstanceData.geometry.arcAngleDeg != null
                ? {
                    arcAngleDeg: Number(
                      s.mappedInstanceData.geometry.arcAngleDeg,
                    ),
                  }
                : {}),
            }
          : null,
        confidence: s.confidence,
        confidenceNotes: s.confidenceNotes,
        needsManualReview: s.needsManualModeling,
        status: 'PENDING' as const,
      }));
    job.summary = result.summary;
    job.status = 'SUCCEEDED';
    job.error = null;
    await job.save();
  } catch (err) {
    job.status = 'FAILED';
    job.error = err instanceof Error ? err.message : 'IFC parse failed';
    await job.save();
  } finally {
    await cleanupTempFile(jobId, tempPath);
  }
}

async function cleanupTempFile(jobId: string, tempPath: string): Promise<void> {
  try {
    await fs.unlink(tempPath);
  } catch {
    /* already gone */
  }
  try {
    await IfcImportJob.findByIdAndUpdate(jobId, { $set: { tempFilePath: null } });
  } catch {
    /* ignore */
  }
}

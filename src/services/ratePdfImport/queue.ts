/**
 * In-memory PDF import queue (p-queue). PDF bytes live only until the job runs.
 */
import { RatePdfImportJob } from '../../models/RatePdfImportJob';
import { extractRatesFromPdf } from './openRouterExtract';
import { extractPdfText } from './pdfText';

// p-queue v6 interop: under tsx/CJS, require() yields `{ default: PQueue }`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PQueueMod = require('p-queue')
const PQueue = PQueueMod.default ?? PQueueMod

type PendingPdf = {
  buffer: Buffer;
  fileName: string;
};

const pendingPdfs = new Map<string, PendingPdf>();
const queue = new PQueue({ concurrency: 1 });

export function storePendingPdf(jobId: string, fileName: string, buffer: Buffer) {
  pendingPdfs.set(jobId, { buffer, fileName });
}

export function enqueueRatePdfImport(jobId: string) {
  void queue.add(() => runRatePdfImportJob(jobId));
}

async function runRatePdfImportJob(jobId: string): Promise<void> {
  const job = await RatePdfImportJob.findById(jobId);
  if (!job) {
    pendingPdfs.delete(jobId);
    return;
  }

  const pending = pendingPdfs.get(jobId);
  if (!pending) {
    job.status = 'FAILED';
    job.error = 'Uploaded PDF was lost before processing (server restart?)';
    await job.save();
    return;
  }

  job.status = 'RUNNING';
  job.error = null;
  await job.save();

  try {
    const text = await extractPdfText(pending.buffer);
    const suggestions = await extractRatesFromPdf({
      fileName: pending.fileName,
      pdfBuffer: pending.buffer,
      extractedText: text,
    });
    job.suggestions = suggestions;
    job.status = 'SUCCEEDED';
    job.error = null;
    await job.save();
  } catch (err) {
    job.status = 'FAILED';
    job.error = err instanceof Error ? err.message : 'PDF import failed';
    await job.save();
  } finally {
    pendingPdfs.delete(jobId);
  }
}

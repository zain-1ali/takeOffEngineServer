/**
 * In-memory PDF conversion queue (p-queue v6, same interop as IFC import).
 * Jobs are lost on restart; single-process only.
 */

type Task<TaskResult> = () => Promise<TaskResult> | TaskResult;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PQueueMod = require('p-queue');
const PQueue = PQueueMod.default ?? PQueueMod;

const queue = new PQueue({ concurrency: 2 });

export function enqueueBackgroundJob(
  task: () => Promise<void>,
  label: string,
): void {
  void queue.add(async () => {
    try {
      await task();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[pdfJobQueue] ${label} failed:`, message);
    }
  });
}

export function enqueuePdfTask<T>(fn: Task<T>): Promise<T> {
  return queue.add(fn) as Promise<T>;
}

/**
 * In-memory AI extraction queue (p-queue v6 CJS).
 * Jobs are lost on restart; single-process only.
 */

type Task<TaskResult> = () => Promise<TaskResult> | TaskResult;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PQueueMod = require('p-queue');
const PQueue = PQueueMod.default ?? PQueueMod;

const queue = new PQueue({ concurrency: 2 });

export async function withRetryOnce<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await fn();
  } catch (firstError: unknown) {
    const message =
      firstError instanceof Error ? firstError.message : String(firstError);
    console.error(`[aiExtractionQueue] ${label} failed, retrying once:`, message);
    return await fn();
  }
}

export function enqueueBackgroundJob(
  task: () => Promise<void>,
  label: string,
): void {
  void queue.add(async () => {
    try {
      await task();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[aiExtractionQueue] ${label} failed:`, message);
    }
  });
}

export function enqueueAiTask<T>(fn: Task<T>): Promise<T> {
  return queue.add(fn) as Promise<T>;
}

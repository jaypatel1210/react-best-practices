type SchedulerLike = { yield?: () => Promise<void> };

/**
 * Pauses the current async task so the browser can handle pending input and paint, then resumes.
 *
 * Uses `scheduler.yield()` where available: the continuation resumes ahead of other queued tasks,
 * so yielding costs little. Elsewhere it resumes in a new task posted through a MessageChannel,
 * which avoids the ~4 ms clamp browsers apply to nested `setTimeout(0)` calls.
 *
 * No dependencies.
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export type ChunkOptions = {
  /**
   * How long to keep working before yielding, in milliseconds. Default 10, which leaves room in
   * each frame for input handling and rendering. Long tasks start at 50 ms.
   */
  budgetMs?: number;
  /** Stops the loop between items; the returned promise rejects with the signal's reason. */
  signal?: AbortSignal;
};

/**
 * Runs `work` for each item and yields to the browser whenever the time budget is used up, so a
 * long loop becomes a series of short tasks instead of one long task that blocks input.
 *
 * At least one item runs per chunk. Keep `work` itself short: a single slow item still blocks.
 * CPU-heavy jobs that take seconds belong in a Web Worker instead.
 *
 * No dependencies.
 */
export async function runInChunks<T>(
  items: Iterable<T>,
  work: (item: T, index: number) => void,
  options: ChunkOptions = {},
): Promise<void> {
  const { budgetMs = 10, signal } = options;
  signal?.throwIfAborted();

  let deadline = performance.now() + budgetMs;
  let index = 0;
  for (const item of items) {
    // Checked before each item after the first, so there's no pointless yield after the last one.
    if (index > 0 && performance.now() >= deadline) {
      await yieldToMain();
      signal?.throwIfAborted();
      deadline = performance.now() + budgetMs;
    }
    work(item, index++);
    signal?.throwIfAborted();
  }
}

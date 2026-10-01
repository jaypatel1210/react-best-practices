import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInChunks, yieldToMain } from '../skills/react-responsiveness/assets/yield-to-main';

// Newer DOM typings declare `scheduler` fully; the tests only stub the part the helper uses.
const g = globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } };
const originalScheduler = g.scheduler;

// A fake clock for performance.now(): each unit of simulated work advances it explicitly.
let clock = 0;
let yieldsAt: number[] = [];
let processed = 0;

beforeEach(() => {
  clock = 0;
  processed = 0;
  yieldsAt = [];
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  g.scheduler = {
    yield: vi.fn(async () => {
      yieldsAt.push(processed);
    }),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  g.scheduler = originalScheduler;
});

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('yieldToMain', () => {
  it('uses scheduler.yield() when available', async () => {
    await yieldToMain();
    expect(g.scheduler!.yield).toHaveBeenCalledTimes(1);
  });

  it('falls back to a new task when scheduler.yield() is unavailable', async () => {
    g.scheduler = undefined;
    const order: string[] = [];
    const pending = yieldToMain().then(() => order.push('resumed'));
    await Promise.resolve();
    order.push('microtasks drained'); // the continuation is a new task, not a microtask
    await pending;
    expect(order).toEqual(['microtasks drained', 'resumed']);
  });
});

describe('runInChunks', () => {
  it('processes every item in order', async () => {
    const seen: Array<[number, number]> = [];
    await runInChunks(['a', 'b', 'c'].map((_, i) => i * 10), (item, index) => seen.push([item, index]));
    expect(seen).toEqual([
      [0, 0],
      [10, 1],
      [20, 2],
    ]);
  });

  it('yields each time the time budget is used up', async () => {
    await runInChunks(
      range(10),
      () => {
        clock += 4; // each item takes 4 ms
        processed++;
      },
      { budgetMs: 10 },
    );
    // 4 + 4 + 4 = 12 ms >= 10 → yield after every third item
    expect(yieldsAt).toEqual([3, 6, 9]);
    expect(processed).toBe(10);
  });

  it("doesn't yield when the whole job fits in the budget", async () => {
    await runInChunks(range(5), () => {
      clock += 1;
    });
    expect(g.scheduler!.yield).not.toHaveBeenCalled();
  });

  it('runs at least one item per chunk, and never yields after the last item', async () => {
    await runInChunks(
      range(3),
      () => {
        clock += 30; // every item alone exceeds the budget
        processed++;
      },
      { budgetMs: 10 },
    );
    expect(yieldsAt).toEqual([1, 2]);
    expect(processed).toBe(3);
  });

  it('stops at the next item after the signal aborts, rejecting with its reason', async () => {
    const controller = new AbortController();
    const work = vi.fn((item: number) => {
      clock += 1;
      if (item === 4) controller.abort(new Error('query changed'));
    });
    await expect(runInChunks(range(100), work, { signal: controller.signal })).rejects.toThrow(
      'query changed',
    );
    expect(work).toHaveBeenCalledTimes(5);
  });

  it('rejects without doing any work when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('unmounted'));
    const work = vi.fn();
    await expect(runInChunks(range(3), work, { signal: controller.signal })).rejects.toThrow('unmounted');
    expect(work).not.toHaveBeenCalled();
  });

  it('accepts any iterable, such as a generator', async () => {
    function* lines() {
      yield 'id,name';
      yield '1,Ada';
    }
    const seen: string[] = [];
    await runInChunks(lines(), (line) => seen.push(line));
    expect(seen).toEqual(['id,name', '1,Ada']);
  });
});

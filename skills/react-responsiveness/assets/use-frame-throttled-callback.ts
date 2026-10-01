import { useEffect, useInsertionEffect, useRef, useState } from 'react';

export type FrameThrottledFunction<Args extends unknown[]> = ((...args: Args) => void) & {
  /** Drop the call scheduled for the next frame, if any. */
  cancel: () => void;
  /** Run the scheduled call now instead of waiting for the frame (e.g. on pointerup). */
  flush: () => void;
  /** Whether a call is scheduled for the next frame. */
  isPending: () => boolean;
};

/**
 * Coalesces calls into at most one per animation frame. The latest `callback` runs right before
 * the browser's next paint, with the arguments of the most recent call.
 *
 * Use it for handlers of continuous events (pointermove, scroll, resize, drag) that update
 * visuals, set state or read layout, so work happens once per frame at most.
 *
 * - The returned function never changes identity, and the callback may read the latest
 *   props/state; you don't need to memoize it.
 * - Pass plain values (coordinates, sizes), not the event: `event.currentTarget` is null
 *   once the handler has returned.
 * - A scheduled call is cancelled on unmount.
 * - Browsers don't run animation frames in background tabs, so don't use it for non-visual work.
 *
 * Requires React 18+. No dependencies.
 */
export function useFrameThrottledCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
): FrameThrottledFunction<Args> {
  const callbackRef = useRef(callback);

  useInsertionEffect(() => {
    callbackRef.current = callback;
  });

  const [throttled] = useState(() => {
    let frame: number | undefined;
    let pendingArgs: Args | undefined;

    const run = () => {
      frame = undefined;
      const args = pendingArgs as Args;
      pendingArgs = undefined;
      callbackRef.current(...args);
    };

    const fn = ((...args: Args) => {
      pendingArgs = args;
      if (frame === undefined) frame = requestAnimationFrame(run);
    }) as FrameThrottledFunction<Args>;

    fn.cancel = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      pendingArgs = undefined;
    };

    fn.flush = () => {
      if (frame === undefined) return;
      cancelAnimationFrame(frame);
      run();
    };

    fn.isPending = () => frame !== undefined;

    return fn;
  });

  useEffect(() => () => throttled.cancel(), [throttled]);

  return throttled;
}

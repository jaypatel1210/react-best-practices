import { useEffect, useInsertionEffect, useRef, useState } from 'react';

export type ThrottledFunction<Args extends unknown[]> = ((...args: Args) => void) & {
  /** Drop the pending trailing invocation and reset the interval. */
  cancel: () => void;
  /** Run the pending trailing invocation now, if any. */
  flush: () => void;
  /** Whether a trailing invocation is scheduled. */
  isPending: () => boolean;
};

export type ThrottleOptions = {
  /** Run a pending trailing invocation when the component unmounts instead of dropping it (e.g. autosave). */
  flushOnUnmount?: boolean;
};

/**
 * Throttle with a stable identity: invokes the latest `callback` at most once per `intervalMs`.
 * The first call runs immediately (leading edge); calls made during the interval are coalesced into
 * one trailing invocation with the arguments of the last call.
 *
 * - The returned function never changes identity.
 * - The callback may read the latest props/state; you don't need to memoize it.
 * - A pending trailing call is cancelled on unmount (or flushed with `flushOnUnmount`).
 *
 * Requires React 18+. No dependencies.
 */
export function useThrottledCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  intervalMs: number,
  options: ThrottleOptions = {},
): ThrottledFunction<Args> {
  const callbackRef = useRef(callback);
  const intervalRef = useRef(intervalMs);
  const flushOnUnmountRef = useRef(options.flushOnUnmount ?? false);

  useInsertionEffect(() => {
    callbackRef.current = callback;
    intervalRef.current = intervalMs;
    flushOnUnmountRef.current = options.flushOnUnmount ?? false;
  });

  const [throttled] = useState(() => {
    let lastInvokeTime: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingArgs: Args | undefined;

    const invoke = (args: Args) => {
      lastInvokeTime = Date.now();
      callbackRef.current(...args);
    };

    const runTrailing = () => {
      timer = undefined;
      const args = pendingArgs;
      pendingArgs = undefined;
      if (args) invoke(args);
    };

    const fn = ((...args: Args) => {
      const now = Date.now();
      let elapsed = lastInvokeTime === undefined ? Infinity : now - lastInvokeTime;
      if (elapsed < 0) elapsed = Infinity; // the system clock moved backwards

      const remaining = intervalRef.current - elapsed;
      if (remaining <= 0 && timer === undefined) {
        invoke(args);
        return;
      }

      pendingArgs = args;
      if (timer === undefined) {
        timer = setTimeout(runTrailing, Math.max(0, remaining));
      }
    }) as ThrottledFunction<Args>;

    fn.cancel = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pendingArgs = undefined;
      lastInvokeTime = undefined;
    };

    fn.flush = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      runTrailing();
    };

    fn.isPending = () => timer !== undefined;

    return fn;
  });

  useEffect(
    () => () => {
      if (flushOnUnmountRef.current) throttled.flush();
      else throttled.cancel();
    },
    [throttled],
  );

  return throttled;
}

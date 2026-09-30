import { useEffect, useInsertionEffect, useRef, useState } from 'react';

export type DebouncedFunction<Args extends unknown[]> = ((...args: Args) => void) & {
  /** Drop the pending invocation, if any. */
  cancel: () => void;
  /** Run the pending invocation now, if any. */
  flush: () => void;
  /** Whether an invocation is waiting to run. */
  isPending: () => boolean;
};

export type DebounceOptions = {
  /** Run a pending invocation when the component unmounts instead of dropping it (e.g. autosave). */
  flushOnUnmount?: boolean;
};

/**
 * Debounce with a stable identity: waits until `delayMs` has passed without calls, then invokes the
 * latest `callback` with the arguments of the last call (trailing edge).
 *
 * - The returned function never changes identity, so it is safe in dependency arrays and as a prop
 *   of `memo` components.
 * - The callback may read the latest props/state; you don't need to memoize it.
 * - Pending calls are cancelled on unmount (or flushed with `flushOnUnmount`).
 * - Changing `delayMs` applies to the next call.
 *
 * Requires React 18+. No dependencies.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
  options: DebounceOptions = {},
): DebouncedFunction<Args> {
  const callbackRef = useRef(callback);
  const delayRef = useRef(delayMs);
  const flushOnUnmountRef = useRef(options.flushOnUnmount ?? false);

  useInsertionEffect(() => {
    callbackRef.current = callback;
    delayRef.current = delayMs;
    flushOnUnmountRef.current = options.flushOnUnmount ?? false;
  });

  // Created once per component instance; a state initializer is guaranteed not to re-run.
  const [debounced] = useState(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingArgs: Args | undefined;

    const invoke = () => {
      const args = pendingArgs;
      timer = undefined;
      pendingArgs = undefined;
      if (args) callbackRef.current(...args);
    };

    const fn = ((...args: Args) => {
      pendingArgs = args;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(invoke, delayRef.current);
    }) as DebouncedFunction<Args>;

    fn.cancel = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pendingArgs = undefined;
    };

    fn.flush = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      invoke();
    };

    fn.isPending = () => timer !== undefined;

    return fn;
  });

  useEffect(
    () => () => {
      if (flushOnUnmountRef.current) debounced.flush();
      else debounced.cancel();
    },
    [debounced],
  );

  return debounced;
}

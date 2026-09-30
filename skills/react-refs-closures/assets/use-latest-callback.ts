import { useInsertionEffect, useRef, useState } from 'react';

/**
 * Returns a function whose identity never changes but which always calls the latest `callback`.
 *
 * Use it for callbacks that must stay referentially stable while reading fresh props/state:
 * props of `memo` components, long-lived subscriptions (sockets, DOM listeners), timers,
 * and debounced/throttled wrappers.
 *
 * - Don't call the returned function during render; it may run the previous render's callback.
 * - For logic that is only called from inside effects on React 19.2+, `useEffectEvent` is the
 *   built-in alternative.
 *
 * Requires React 18+. No dependencies.
 */
export function useLatestCallback<Args extends unknown[], Return>(
  callback: (...args: Args) => Return,
): (...args: Args) => Return {
  const callbackRef = useRef(callback);

  // Insertion effects run before every layout effect and effect in the same commit, including
  // children's, so anything that calls the stable function after this commit sees the new callback.
  useInsertionEffect(() => {
    callbackRef.current = callback;
  });

  // A state initializer (unlike useMemo/useCallback) is guaranteed to run once per instance.
  const [stable] = useState(() => (...args: Args): Return => callbackRef.current(...args));
  return stable;
}

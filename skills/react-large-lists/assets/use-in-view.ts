import { useEffect, useState } from 'react';

export type InViewOptions = {
  /**
   * The scroll container to test against. Defaults to the viewport. Pass the element itself
   * (from state or a callback ref), not a ref object.
   */
  root?: Element | Document | null;
  /** Grows (or shrinks) the root's box before testing, e.g. '300px 0px' to start work early. */
  rootMargin?: string;
  /** Fraction(s) of the element that must be visible to count as in view. Defaults to 0 (any pixel). */
  threshold?: number | number[];
  /**
   * Latch on the first time the element is in view: `inView` stays true and observing stops.
   * Use it for lazy mounting and one-time impressions.
   */
  once?: boolean;
  /**
   * The value before the first observation, during server rendering, and in environments without
   * IntersectionObserver. With `once`, an initial `true` latches immediately.
   */
  initialInView?: boolean;
};

/**
 * Tracks whether an element is within (or near) the viewport or a scroll container.
 *
 * Returns a callback ref to attach to the element, and the current visibility. Because it's a
 * callback ref, it follows elements that mount later, unmount, or get replaced.
 *
 * - State updates only when visibility flips, so the component re-renders on crossings, not on scroll.
 * - The observer is disconnected on unmount, when the element detaches, and after a `once` hit.
 *
 * Requires React 18+. No dependencies.
 */
export function useInView<T extends Element = Element>(
  options: InViewOptions = {},
): [ref: (node: T | null) => void, inView: boolean] {
  const { root = null, rootMargin = '0px', threshold = 0, once = false, initialInView = false } = options;
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(initialInView);

  // A primitive key, so a new array literal with the same values doesn't recreate the observer.
  const thresholdKey = Array.isArray(threshold) ? threshold.join(',') : String(threshold);
  const latched = once && inView;

  useEffect(() => {
    if (node === null || latched || typeof IntersectionObserver === 'undefined') return;

    const thresholds = thresholdKey.split(',').map(Number);
    const minThreshold = Math.min(...thresholds);
    // disconnect() doesn't drop entries the browser already queued, so ignore late callbacks.
    let stopped = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (stopped) return;
        // Entries are queued per target; the last one describes the current state.
        const entry = entries[entries.length - 1];
        // isIntersecting stays true below the threshold (e.g. while scrolling out), so check the
        // ratio too. With a threshold of 0 this is just isIntersecting, which also handles
        // zero-height sentinels.
        const visible = entry.isIntersecting && entry.intersectionRatio >= minThreshold;
        setInView(visible);
        if (visible && once) {
          stopped = true;
          observer.disconnect();
        }
      },
      { root, rootMargin, threshold: thresholds },
    );
    observer.observe(node);
    return () => {
      stopped = true;
      observer.disconnect();
    };
  }, [node, root, rootMargin, thresholdKey, once, latched]);

  return [setNode, inView];
}

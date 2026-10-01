import { act, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useInView, type InViewOptions } from '../skills/react-large-lists/assets/use-in-view';

// jsdom has no IntersectionObserver. This mock records instances and lets tests report entries.
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit;
  readonly targets = new Set<Element>();
  disconnected = false;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    this.disconnected = true;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  report(target: Element, isIntersecting: boolean, intersectionRatio = isIntersecting ? 1 : 0) {
    const entry = { target, isIntersecting, intersectionRatio } as IntersectionObserverEntry;
    act(() => this.callback([entry], this as unknown as IntersectionObserver));
  }
}

const original = globalThis.IntersectionObserver;
beforeEach(() => {
  MockIntersectionObserver.instances = [];
  globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  globalThis.IntersectionObserver = original;
});

const active = () => MockIntersectionObserver.instances.filter((o) => !o.disconnected);

function renderProbe(options?: InViewOptions) {
  const seen: boolean[] = [];
  const commits: boolean[] = [];
  function Probe() {
    const [ref, inView] = useInView<HTMLDivElement>(options);
    seen.push(inView);
    useEffect(() => {
      commits.push(inView);
    });
    return <div ref={ref} data-testid="target" />;
  }
  const utils = render(<Probe />);
  return { ...utils, seen, commits, target: utils.getByTestId('target') };
}

describe('useInView', () => {
  it('starts false, then tracks the element entering and leaving', () => {
    const { seen, target } = renderProbe();
    expect(seen.at(-1)).toBe(false);
    const [observer] = active();
    expect(observer.targets.has(target)).toBe(true);

    observer.report(target, true);
    expect(seen.at(-1)).toBe(true);
    observer.report(target, false);
    expect(seen.at(-1)).toBe(false);
  });

  it('passes root, rootMargin and threshold to the observer', () => {
    const root = document.createElement('div');
    renderProbe({ root, rootMargin: '300px 0px', threshold: [0, 0.5] });
    const [observer] = active();
    expect(observer.options.root).toBe(root);
    expect(observer.options.rootMargin).toBe('300px 0px');
    expect(observer.options.threshold).toEqual([0, 0.5]);
  });

  it('does not count an intersection below the threshold', () => {
    const { seen, target } = renderProbe({ threshold: 0.5 });
    const [observer] = active();
    observer.report(target, true, 0.2); // intersecting, but only 20% visible
    expect(seen.at(-1)).toBe(false);
    observer.report(target, true, 0.6);
    expect(seen.at(-1)).toBe(true);
    observer.report(target, true, 0.3); // scrolling out: still intersecting, below threshold
    expect(seen.at(-1)).toBe(false);
  });

  it('commits a re-render only when visibility flips', () => {
    // React may call the component once before bailing out of an equal state update, so count
    // commits (effects), not render calls.
    const { commits, target } = renderProbe();
    const [observer] = active();
    const commitsBefore = commits.length;
    observer.report(target, false); // same value as the initial state
    expect(commits.length).toBe(commitsBefore);
    observer.report(target, true);
    observer.report(target, true);
    expect(commits.length).toBe(commitsBefore + 1);
  });

  it('with once, latches true and stops observing', () => {
    const { seen, target } = renderProbe({ once: true });
    const [observer] = active();
    observer.report(target, true);
    expect(seen.at(-1)).toBe(true);
    expect(observer.disconnected).toBe(true);
    expect(active()).toHaveLength(0);

    observer.report(target, false); // late entries from the old observer are ignored by design
    expect(seen.at(-1)).toBe(true);
  });

  it('with once and initialInView, never observes', () => {
    const { seen } = renderProbe({ once: true, initialInView: true });
    expect(seen.at(-1)).toBe(true);
    expect(active()).toHaveLength(0);
  });

  it('disconnects on unmount', () => {
    const { unmount } = renderProbe();
    const [observer] = active();
    unmount();
    expect(observer.disconnected).toBe(true);
  });

  it('follows a conditionally rendered element through the callback ref', () => {
    let toggle: () => void = () => {};
    function Toggle() {
      const [ref, inView] = useInView<HTMLElement>();
      const [useFirst, setUseFirst] = useState(true);
      toggle = () => setUseFirst((v) => !v);
      return useFirst ? (
        <section ref={ref} data-testid="first" data-in-view={inView} />
      ) : (
        <aside ref={ref} data-testid="second" data-in-view={inView} />
      );
    }
    const { getByTestId } = render(<Toggle />);
    const first = getByTestId('first');
    const [firstObserver] = active();
    expect(firstObserver.targets.has(first)).toBe(true);

    act(() => toggle());
    const second = getByTestId('second');
    expect(firstObserver.disconnected).toBe(true);
    const [secondObserver] = active();
    expect(secondObserver.targets.has(second)).toBe(true);

    secondObserver.report(second, true);
    expect(getByTestId('second').dataset.inView).toBe('true');
  });

  it('keeps one observer across re-renders with equal options, even with a new threshold array', () => {
    let rerender: () => void = () => {};
    function Parent() {
      const [, setTick] = useState(0);
      rerender = () => setTick((t) => t + 1);
      const [ref] = useInView<HTMLDivElement>({ rootMargin: '100px', threshold: [0, 1] });
      return <div ref={ref} />;
    }
    render(<Parent />);
    const [observer] = active();
    act(() => rerender());
    act(() => rerender());
    expect(active()).toEqual([observer]);
    expect(MockIntersectionObserver.instances).toHaveLength(1);
  });

  it('reports initialInView when IntersectionObserver is unavailable', () => {
    // @ts-expect-error simulating an environment without the API
    delete globalThis.IntersectionObserver;
    const { seen } = renderProbe({ initialInView: true });
    expect(seen.at(-1)).toBe(true);
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });
});

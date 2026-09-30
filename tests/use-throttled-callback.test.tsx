import { act, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useThrottledCallback,
  type ThrottledFunction,
} from '../skills/react-refs-closures/assets/use-throttled-callback';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function renderThrottled<Args extends unknown[]>(
  callback: (...args: Args) => void,
  intervalMs = 1000,
  options?: { flushOnUnmount?: boolean },
) {
  const handle: { current: ThrottledFunction<Args> | null } = { current: null };
  function Probe() {
    handle.current = useThrottledCallback(callback, intervalMs, options);
    return null;
  }
  const utils = render(<Probe />);
  return { ...utils, handle };
}

describe('useThrottledCallback', () => {
  it('runs the first call immediately (leading edge)', () => {
    const spy = vi.fn();
    const { handle } = renderThrottled(spy);
    act(() => handle.current!('first'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('first');
  });

  it('coalesces calls during the interval into one trailing call with the latest arguments', () => {
    const spy = vi.fn();
    const { handle } = renderThrottled(spy, 1000);

    act(() => handle.current!('a')); // leading
    act(() => {
      vi.advanceTimersByTime(200);
      handle.current!('b');
      vi.advanceTimersByTime(200);
      handle.current!('c');
    });
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(600)); // 1000ms after the leading call
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('c');
  });

  it('never invokes more than once per interval under a continuous stream of calls', () => {
    const invokeTimes: number[] = [];
    const { handle } = renderThrottled(() => invokeTimes.push(Date.now()), 500);
    const start = Date.now();

    act(() => {
      for (let t = 0; t < 5000; t += 50) {
        handle.current!();
        vi.advanceTimersByTime(50);
      }
    });
    act(() => vi.advanceTimersByTime(1000));

    const gaps = invokeTimes.slice(1).map((t, i) => t - invokeTimes[i]);
    expect(gaps.every((gap) => gap >= 500)).toBe(true);
    expect(invokeTimes.length).toBeGreaterThanOrEqual(10); // ~5000ms / 500ms
    expect(invokeTimes[0]).toBe(start);
  });

  it('keeps one identity while state updates re-render the component, and reads the latest state', () => {
    const saved: string[] = [];
    const identities = new Set<unknown>();
    function Editor() {
      const [text, setText] = useState('');
      const save = useThrottledCallback(() => saved.push(text), 1000);
      identities.add(save);
      return (
        <textarea
          aria-label="t"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            save();
          }}
        />
      );
    }
    const { getByLabelText } = render(<Editor />);
    fireEvent.change(getByLabelText('t'), { target: { value: 'h' } }); // leading: runs before the re-render
    fireEvent.change(getByLabelText('t'), { target: { value: 'he' } });
    fireEvent.change(getByLabelText('t'), { target: { value: 'hello' } });
    act(() => vi.advanceTimersByTime(1000));

    expect(identities.size).toBe(1);
    expect(saved.at(-1)).toBe('hello');
    expect(saved.length).toBe(2);
  });

  it('cancel drops the trailing call and resets the interval', () => {
    const spy = vi.fn();
    const { handle } = renderThrottled(spy, 1000);
    act(() => handle.current!(1));
    act(() => handle.current!(2));
    expect(handle.current!.isPending()).toBe(true);
    act(() => handle.current!.cancel());
    act(() => vi.advanceTimersByTime(2000));
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => handle.current!(3)); // leading again after cancel
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(3);
  });

  it('flush runs the pending trailing call immediately', () => {
    const spy = vi.fn();
    const { handle } = renderThrottled(spy, 1000);
    act(() => handle.current!('a'));
    act(() => handle.current!('b'));
    act(() => handle.current!.flush());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('b');
    act(() => vi.advanceTimersByTime(2000));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('drops a pending trailing call on unmount by default', () => {
    const spy = vi.fn();
    const { handle, unmount } = renderThrottled(spy, 1000);
    act(() => handle.current!('a'));
    act(() => handle.current!('b'));
    unmount();
    act(() => vi.advanceTimersByTime(2000));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('runs a pending trailing call on unmount with flushOnUnmount (autosave keeps the last edit)', () => {
    const spy = vi.fn();
    const { handle, unmount } = renderThrottled(spy, 1000, { flushOnUnmount: true });
    act(() => handle.current!('draft v1'));
    act(() => handle.current!('draft v2'));
    unmount();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('draft v2');
  });
});

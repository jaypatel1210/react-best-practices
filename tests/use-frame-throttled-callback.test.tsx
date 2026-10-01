import { act, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useFrameThrottledCallback,
  type FrameThrottledFunction,
} from '../skills/react-responsiveness/assets/use-frame-throttled-callback';

// Vitest's fake timers also fake requestAnimationFrame; advanceTimersToNextFrame runs one frame.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function renderFrameThrottled<Args extends unknown[]>(callback: (...args: Args) => void) {
  const handle: { current: FrameThrottledFunction<Args> | null } = { current: null };
  function Probe() {
    handle.current = useFrameThrottledCallback(callback);
    return null;
  }
  const utils = render(<Probe />);
  return { ...utils, handle };
}

describe('useFrameThrottledCallback', () => {
  it('waits for the next frame, then runs once with the latest arguments', () => {
    const spy = vi.fn();
    const { handle } = renderFrameThrottled(spy);

    act(() => {
      handle.current!(1);
      handle.current!(2);
      handle.current!(3);
    });
    expect(spy).not.toHaveBeenCalled();
    expect(handle.current!.isPending()).toBe(true);

    act(() => vi.advanceTimersToNextFrame());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(3);
    expect(handle.current!.isPending()).toBe(false);
  });

  it('runs at most once per frame under a continuous stream of calls', () => {
    const spy = vi.fn();
    const { handle } = renderFrameThrottled(spy);
    act(() => {
      for (let frame = 0; frame < 5; frame++) {
        for (let call = 0; call < 8; call++) handle.current!(frame * 8 + call);
        vi.advanceTimersToNextFrame();
      }
    });
    expect(spy).toHaveBeenCalledTimes(5);
    expect(spy.mock.calls.map(([value]) => value)).toEqual([7, 15, 23, 31, 39]);
  });

  it('keeps one identity across re-renders and calls the latest callback', () => {
    const seen: string[] = [];
    const identities = new Set<unknown>();
    function Tracker() {
      const [label, setLabel] = useState('first');
      const onMove = useFrameThrottledCallback((x: number) => seen.push(`${label}:${x}`));
      identities.add(onMove);
      return (
        <>
          <button onClick={() => setLabel('second')}>relabel</button>
          <div data-testid="area" onPointerMove={(e) => onMove(e.clientX)} />
        </>
      );
    }
    const { getByTestId, getByText } = render(<Tracker />);
    fireEvent.pointerMove(getByTestId('area'), { clientX: 10 });
    fireEvent.click(getByText('relabel')); // re-render before the frame fires
    act(() => vi.advanceTimersToNextFrame());

    expect(identities.size).toBe(1);
    expect(seen).toEqual(['second:10']);
  });

  it('cancel drops the scheduled call', () => {
    const spy = vi.fn();
    const { handle } = renderFrameThrottled(spy);
    act(() => handle.current!('a'));
    act(() => handle.current!.cancel());
    act(() => vi.advanceTimersToNextFrame());
    expect(spy).not.toHaveBeenCalled();

    act(() => handle.current!('b'));
    act(() => vi.advanceTimersToNextFrame());
    expect(spy).toHaveBeenCalledWith('b');
  });

  it('flush runs the scheduled call immediately and only once', () => {
    const spy = vi.fn();
    const { handle } = renderFrameThrottled(spy);
    act(() => handle.current!('last position'));
    act(() => handle.current!.flush());
    expect(spy).toHaveBeenCalledWith('last position');
    act(() => vi.advanceTimersToNextFrame());
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => handle.current!.flush()); // nothing pending
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('cancels a scheduled call on unmount', () => {
    const spy = vi.fn();
    const { handle, unmount } = renderFrameThrottled(spy);
    act(() => handle.current!('a'));
    unmount();
    act(() => vi.advanceTimersToNextFrame());
    expect(spy).not.toHaveBeenCalled();
  });
});

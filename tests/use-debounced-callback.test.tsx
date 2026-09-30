import { act, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDebouncedCallback,
  type DebouncedFunction,
} from '../skills/react-refs-closures/assets/use-debounced-callback';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function renderDebounced<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs = 300,
  options?: { flushOnUnmount?: boolean },
) {
  const handle: { current: DebouncedFunction<Args> | null } = { current: null };
  function Probe({ cb, delay }: { cb: (...args: Args) => void; delay: number }) {
    handle.current = useDebouncedCallback(cb, delay, options);
    return null;
  }
  const utils = render(<Probe cb={callback} delay={delayMs} />);
  return {
    ...utils,
    handle,
    rerenderWith: (cb: (...args: Args) => void, delay = delayMs) => utils.rerender(<Probe cb={cb} delay={delay} />),
  };
}

describe('useDebouncedCallback', () => {
  it('collapses a burst of calls into one trailing call with the last arguments', () => {
    const spy = vi.fn();
    const { handle } = renderDebounced(spy, 300);

    act(() => {
      handle.current!('p');
      vi.advanceTimersByTime(100);
      handle.current!('pa');
      vi.advanceTimersByTime(100);
      handle.current!('par');
    });
    expect(spy).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(299));
    expect(spy).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('par');
  });

  it('stays one debouncer across re-renders caused by typing (the classic bug)', () => {
    const requests: string[] = [];
    const identities = new Set<unknown>();

    function Search() {
      const [query, setQuery] = useState('');
      const search = useDebouncedCallback((q: string) => requests.push(q), 300);
      identities.add(search);
      return (
        <input
          aria-label="q"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            search(e.target.value);
          }}
        />
      );
    }

    const { getByLabelText } = render(<Search />);
    for (const value of ['p', 'pa', 'par', 'pari', 'paris']) {
      fireEvent.change(getByLabelText('q'), { target: { value } });
      act(() => vi.advanceTimersByTime(50));
    }
    act(() => vi.advanceTimersByTime(300));

    expect(requests).toEqual(['paris']);
    expect(identities.size).toBe(1);
  });

  it('invokes the latest callback, so it can read fresh state', () => {
    const seen: string[] = [];
    function Form() {
      const [value, setValue] = useState('');
      const save = useDebouncedCallback(() => seen.push(value), 200);
      return (
        <input
          aria-label="v"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            save();
          }}
        />
      );
    }
    const { getByLabelText } = render(<Form />);
    fireEvent.change(getByLabelText('v'), { target: { value: 'a' } });
    fireEvent.change(getByLabelText('v'), { target: { value: 'ab' } });
    act(() => vi.advanceTimersByTime(200));
    expect(seen).toEqual(['ab']);
  });

  it('supports cancel, flush and isPending', () => {
    const spy = vi.fn();
    const { handle } = renderDebounced(spy, 300);

    act(() => handle.current!('x'));
    expect(handle.current!.isPending()).toBe(true);
    act(() => handle.current!.cancel());
    expect(handle.current!.isPending()).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(spy).not.toHaveBeenCalled();

    act(() => handle.current!('y'));
    act(() => handle.current!.flush());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith('y');
    act(() => vi.advanceTimersByTime(1000));
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => handle.current!.flush()); // nothing pending: no-op
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('drops a pending call on unmount by default', () => {
    const spy = vi.fn();
    const { handle, unmount } = renderDebounced(spy, 300);
    act(() => handle.current!('late'));
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(spy).not.toHaveBeenCalled();
  });

  it('runs a pending call on unmount with flushOnUnmount', () => {
    const spy = vi.fn();
    const { handle, unmount } = renderDebounced(spy, 300, { flushOnUnmount: true });
    act(() => handle.current!('last edit'));
    unmount();
    expect(spy).toHaveBeenCalledWith('last edit');
  });

  it('applies a changed delay to the next call', () => {
    const spy = vi.fn();
    const { handle, rerenderWith } = renderDebounced(spy, 300);
    rerenderWith(spy, 1000);
    act(() => handle.current!('slow'));
    act(() => vi.advanceTimersByTime(300));
    expect(spy).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(700));
    expect(spy).toHaveBeenCalledWith('slow');
  });
});

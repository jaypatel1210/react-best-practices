import { act, fireEvent, render } from '@testing-library/react';
import { memo, useEffect, useLayoutEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useLatestCallback } from '../skills/react-refs-closures/assets/use-latest-callback';

describe('useLatestCallback', () => {
  it('keeps the same identity across re-renders', () => {
    const identities = new Set<unknown>();
    function Probe({ value }: { value: number }) {
      identities.add(useLatestCallback(() => value));
      return null;
    }
    const { rerender } = render(<Probe value={1} />);
    rerender(<Probe value={2} />);
    rerender(<Probe value={3} />);
    expect(identities.size).toBe(1);
  });

  it('calls the closure from the latest committed render', () => {
    let fn: (() => number) | undefined;
    function Probe({ value }: { value: number }) {
      fn = useLatestCallback(() => value);
      return null;
    }
    const { rerender } = render(<Probe value={1} />);
    expect(fn!()).toBe(1);
    rerender(<Probe value={42} />);
    expect(fn!()).toBe(42);
  });

  it('forwards arguments and return values', () => {
    let fn: ((a: number, b: number) => number) | undefined;
    function Probe({ offset }: { offset: number }) {
      fn = useLatestCallback((a: number, b: number) => a + b + offset);
      return null;
    }
    render(<Probe offset={10} />);
    expect(fn!(1, 2)).toBe(13);
  });

  it('lets a memoized child read fresh state without re-rendering it', () => {
    const childRenders = vi.fn();
    const Child = memo(function Child({ onSubmit }: { onSubmit: () => void }) {
      childRenders();
      return <button onClick={onSubmit}>submit</button>;
    });

    const submitted: string[] = [];
    function Form() {
      const [name, setName] = useState('');
      const onSubmit = useLatestCallback(() => submitted.push(name));
      return (
        <>
          <input aria-label="name" value={name} onChange={(e) => setName(e.target.value)} />
          <Child onSubmit={onSubmit} />
        </>
      );
    }

    const { getByLabelText, getByText } = render(<Form />);
    fireEvent.change(getByLabelText('name'), { target: { value: 'Ada' } });
    fireEvent.change(getByLabelText('name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.click(getByText('submit'));

    expect(submitted).toEqual(['Ada Lovelace']);
    expect(childRenders).toHaveBeenCalledTimes(1);
  });

  it("is already up to date inside children's effects and layout effects of the same commit", () => {
    const fromEffect: number[] = [];
    const fromLayoutEffect: number[] = [];

    function Child({ report }: { report: (sink: number[]) => void }) {
      useLayoutEffect(() => {
        report(fromLayoutEffect);
      });
      useEffect(() => {
        report(fromEffect);
      });
      return null;
    }
    function Parent({ value }: { value: number }) {
      const report = useLatestCallback((sink: number[]) => sink.push(value));
      return <Child report={report} />;
    }

    const { rerender } = render(<Parent value={1} />);
    act(() => rerender(<Parent value={2} />));

    expect(fromLayoutEffect).toEqual([1, 2]);
    expect(fromEffect).toEqual([1, 2]);
  });
});

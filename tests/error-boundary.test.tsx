import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, useThrowToBoundary } from '../skills/react-error-handling/assets/error-boundary';

// React logs every caught error to console.error; keep test output readable.
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

function Bomb({ explode, message = 'boom' }: { explode: boolean; message?: string }) {
  if (explode) throw new Error(message);
  return <p>all good</p>;
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <Bomb explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('catches render errors, shows the fallback and reports with a component stack', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary fallback={<p>fallback</p>} onError={onError}>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(screen.getByText('fallback')).toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(1);
    const [error, info] = onError.mock.calls[0];
    expect((error as Error).message).toBe('boom');
    expect(info.componentStack).toContain('Bomb');
  });

  it('catches errors thrown inside effects', () => {
    function EffectBomb() {
      useEffect(() => {
        throw new Error('effect failed');
      }, []);
      return null;
    }
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <EffectBomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('fallback')).toBeTruthy();
  });

  it('only affects its own subtree', () => {
    render(
      <>
        <ErrorBoundary fallback={<p>widget failed</p>}>
          <Bomb explode />
        </ErrorBoundary>
        <p>rest of the page</p>
      </>,
    );
    expect(screen.getByText('widget failed')).toBeTruthy();
    expect(screen.getByText('rest of the page')).toBeTruthy();
  });

  it('fallbackRender receives the error and can reset the boundary', () => {
    const onReset = vi.fn();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('flaky');
      return <p>recovered</p>;
    }
    render(
      <ErrorBoundary
        onReset={onReset}
        fallbackRender={({ error, resetErrorBoundary }) => (
          <button onClick={resetErrorBoundary}>retry after {(error as Error).message}</button>
        )}
      >
        <Flaky />
      </ErrorBoundary>,
    );
    shouldThrow = false; // the cause is fixed (e.g. data refetched)
    fireEvent.click(screen.getByText('retry after flaky'));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('recovered')).toBeTruthy();
  });

  it('resets when resetKeys change after the error was caught', () => {
    function Page({ path }: { path: string }) {
      return (
        <ErrorBoundary resetKeys={[path]} fallback={<p>page failed</p>}>
          <Bomb explode={path === '/broken'} />
        </ErrorBoundary>
      );
    }
    const { rerender } = render(<Page path="/broken" />);
    expect(screen.getByText('page failed')).toBeTruthy();
    rerender(<Page path="/home" />);
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('does not reset in the same update that caused the error (no reset loop)', () => {
    function Page({ path }: { path: string }) {
      return (
        <ErrorBoundary resetKeys={[path]} fallback={<p>page failed</p>}>
          <Bomb explode={path === '/broken'} />
        </ErrorBoundary>
      );
    }
    const { rerender } = render(<Page path="/home" />);
    rerender(<Page path="/broken" />); // key change and error in the same update
    expect(screen.getByText('page failed')).toBeTruthy();
  });

  it('shows nothing when no fallback is provided', () => {
    const { container } = render(
      <ErrorBoundary>
        <Bomb explode />
      </ErrorBoundary>,
    );
    expect(container.textContent).toBe('');
  });
});

describe('useThrowToBoundary', () => {
  it('routes an event-handler error to the nearest boundary', () => {
    function ExportButton() {
      const throwToBoundary = useThrowToBoundary();
      return (
        <button
          onClick={() => {
            try {
              throw new Error('export failed');
            } catch (err) {
              throwToBoundary(err);
            }
          }}
        >
          export
        </button>
      );
    }
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError} fallbackRender={({ error }) => <p>{(error as Error).message}</p>}>
        <ExportButton />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText('export'));
    expect(screen.getByText('export failed')).toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('routes a rejected promise to the nearest boundary', async () => {
    function Loader() {
      const throwToBoundary = useThrowToBoundary();
      const [data] = useState<string | null>(null);
      useEffect(() => {
        Promise.reject(new Error('request failed')).catch(throwToBoundary);
      }, [throwToBoundary]);
      return <p>{data ?? 'loading'}</p>;
    }
    render(
      <ErrorBoundary fallbackRender={({ error }) => <p>{(error as Error).message}</p>}>
        <Loader />
      </ErrorBoundary>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('request failed')).toBeTruthy();
  });
});

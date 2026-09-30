import { Component, useCallback, useState, type ErrorInfo, type ReactNode } from 'react';

export type FallbackRenderProps = {
  error: unknown;
  /** Clear the error and render the children again. */
  resetErrorBoundary: () => void;
};

export type ErrorBoundaryProps = {
  children?: ReactNode;
  /** Static fallback UI. */
  fallback?: ReactNode;
  /** Fallback with access to the error and a reset function. Takes precedence over `fallback`. */
  fallbackRender?: (props: FallbackRenderProps) => ReactNode;
  /** Report the error (Sentry, Datadog, your logger). `info.componentStack` shows where it happened. */
  onError?: (error: unknown, info: ErrorInfo) => void;
  /** Called when the boundary resets, before the children render again (clear caches, refetch...). */
  onReset?: () => void;
  /**
   * When any value changes (Object.is) while the fallback is showing, the boundary resets automatically.
   * Typical keys: the route path, the id of the entity the region shows.
   */
  resetKeys?: readonly unknown[];
};

type ErrorBoundaryState = { hasError: boolean; error: unknown };

const initialState: ErrorBoundaryState = { hasError: false, error: null };

/**
 * Catches errors thrown while rendering, in lifecycle methods and in effects of its descendants, and
 * renders a fallback instead of unmounting the whole app. It does not see errors from event handlers or
 * async code; forward those with `useThrowToBoundary`.
 *
 * No dependencies. If the project already uses `react-error-boundary`, prefer that library.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = initialState;

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState) {
    // Only reset for key changes that happen *after* the error was caught. If the update that changed the
    // keys is also the one that threw, resetting immediately would just throw again.
    if (this.state.hasError && prevState.hasError && haveKeysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.resetErrorBoundary();
    }
  }

  resetErrorBoundary = () => {
    this.props.onReset?.();
    this.setState(initialState);
  };

  render() {
    if (this.state.hasError) {
      const { fallbackRender, fallback = null } = this.props;
      return fallbackRender
        ? fallbackRender({ error: this.state.error, resetErrorBoundary: this.resetErrorBoundary })
        : fallback;
    }
    return this.props.children;
  }
}

function haveKeysChanged(prev: readonly unknown[] = [], next: readonly unknown[] = []) {
  return prev.length !== next.length || prev.some((value, index) => !Object.is(value, next[index]));
}

/**
 * Returns a function that re-throws an error inside React's render cycle, so the nearest error boundary
 * catches it. Use it for errors from event handlers, promises, timers and subscriptions, which error
 * boundaries can't see on their own.
 *
 *   const throwToBoundary = useThrowToBoundary();
 *   fetchReport().catch(throwToBoundary);
 */
export function useThrowToBoundary(): (error: unknown) => void {
  const [, setState] = useState<null>(null);
  return useCallback((error: unknown) => {
    // React calls the updater while re-rendering this component; throwing there reaches the boundary.
    setState(() => {
      throw error;
    });
  }, []);
}

# Example: Errors From Event Handlers and Async Code

Error boundaries only see errors thrown while React is rendering, running lifecycle methods or running effects. Anything that happens later (a click, a resolved promise, a timer) runs outside that window.

```tsx
function InvoiceActions({ invoiceId }: { invoiceId: string }) {
  useEffect(() => {
    throw new Error('config missing');   // caught by the nearest boundary
  }, []);

  useEffect(() => {
    fetchTotals(invoiceId).then(() => {
      throw new Error('bad totals');     // NOT caught: runs later, in a promise callback
    });
  }, [invoiceId]);

  const onVoid = () => {
    throw new Error('void failed');      // NOT caught: event handler
  };

  return <button onClick={onVoid}>Void invoice</button>;
}
```

## Decide: expected or unexpected?

- **Expected, recoverable failures** (validation errors, a 409 conflict, "payment declined", network hiccups on a user action): handle them *locally*, next to the action, with specific UI such as an inline message, a toast, or a retry button.
- **Unexpected failures that leave the region unusable** (malformed data, a missing config, bugs): send them to the region's error boundary, so the fallback replaces the broken UI and the error gets reported.

## Local handling in an event handler

```tsx
function VoidInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');

  const onVoid = async () => {
    setStatus('working');
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/void`, { method: 'POST' });
      if (res.status === 409) {
        setStatus('error'); // expected: already paid
        return;
      }
      if (!res.ok) throw new Error(`Void failed: ${res.status}`);
      setStatus('idle');
    } catch (err) {
      reportError(err);
      setStatus('error');
    }
  };

  return (
    <>
      <button onClick={onVoid} disabled={status === 'working'}>Void invoice</button>
      {status === 'error' && <p role="alert">Couldn't void this invoice. Try again or contact support.</p>}
    </>
  );
}
```

On React 19 you could also run this as an Action with `const [isPending, startTransition] = useTransition()`. Errors thrown (or promises rejected) inside an action passed to *that* `startTransition` propagate to the nearest error boundary, so catch the expected ones inside the action and let only unexpected ones escape. The standalone `startTransition` imported from `react` doesn't do this: React reports its errors with `window.reportError`, and no boundary shows a fallback.

## Re-throwing to the boundary

```tsx
import { useThrowToBoundary } from './components/error-boundary';

function TaxSummary({ invoiceId }: { invoiceId: string }) {
  const [summary, setSummary] = useState<TaxSummaryData | null>(null);
  const throwToBoundary = useThrowToBoundary();

  useEffect(() => {
    const controller = new AbortController();
    fetchTaxSummary(invoiceId, controller.signal)
      .then(setSummary)
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return; // superseded, not a failure
        throwToBoundary(err); // the region can't render without this → show the boundary fallback
      });
    return () => controller.abort();
  }, [invoiceId, throwToBoundary]);

  return summary ? <TaxTable summary={summary} /> : <TaxSkeleton />;
}
```

`useThrowToBoundary` calls a state setter with an updater function that throws. React runs updaters while rendering the component, so the error surfaces as a render error and the nearest boundary catches it. The same boundary then handles reporting and retry for render errors and async errors alike.

## Wrapping callbacks so no handler error escapes

For a component with many risky handlers, a small wrapper avoids repeating `try/catch`:

```tsx
function useGuardedCallback<Args extends unknown[]>(fn: (...args: Args) => unknown) {
  const throwToBoundary = useThrowToBoundary();
  const latest = useLatestCallback(fn); // react-refs-closures/assets/use-latest-callback.ts
  return useCallback(
    (...args: Args) => {
      try {
        const result = latest(...args);
        if (result instanceof Promise) result.catch(throwToBoundary);
      } catch (err) {
        throwToBoundary(err);
      }
    },
    [latest, throwToBoundary],
  );
}

const onRecalculate = useGuardedCallback(async () => {
  const totals = await recalculate(invoiceId);
  applyTotals(totals);
});
```

Use this for *unexpected* errors only. Expected failures deserve specific, local UI.

## With `react-error-boundary`

```tsx
import { ErrorBoundary, useErrorBoundary } from 'react-error-boundary';

function TaxSummary() {
  const { showBoundary } = useErrorBoundary();
  useEffect(() => {
    fetchTaxSummary().then(setSummary).catch(showBoundary);
  }, [showBoundary]);
}
```

## With TanStack Query

```tsx
// Route every query error in this region to the boundary:
const { data } = useQuery({ ...taxSummaryQuery(invoiceId), throwOnError: true });

// Or with Suspense, where errors always go to the boundary and loading goes to <Suspense>:
const { data } = useSuspenseQuery(taxSummaryQuery(invoiceId));
```

Pair it with the boundary's `onReset={() => queryClient.resetQueries(...)}`, or use TanStack Query's `QueryErrorResetBoundary`, so "Retry" refetches instead of re-throwing the cached error.

## Anti-patterns

```tsx
try {
  useEffect(() => { risky(); }, []); // useless: the effect runs later, outside this try
} catch {}

try {
  return <Chart data={data} />;      // useless: Chart renders after this function returns
} catch {
  return <Fallback />;
}

function Widget() {
  const [failed, setFailed] = useState(false);
  try {
    compute();
  } catch {
    setFailed(true);                 // infinite loop: setState during render
  }
}
```

# Example: Race Conditions in Data Fetching

## The bug

A billing screen lists invoices on the left. Clicking one shows its details on the right.

```tsx
function BillingScreen() {
  const [invoiceId, setInvoiceId] = useState('inv_001');
  return (
    <>
      <InvoiceList selectedId={invoiceId} onSelect={setInvoiceId} />
      <InvoiceDetails invoiceId={invoiceId} />
    </>
  );
}

function InvoiceDetails({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    fetch(`/api/invoices/${invoiceId}`)
      .then((r) => r.json())
      .then(setInvoice); // any response, from any past request, can land here
  }, [invoiceId]);

  return invoice ? <InvoiceView invoice={invoice} /> : <DetailsSkeleton />;
}
```

A user clicks `inv_001`, then quickly `inv_002`. If `inv_001`'s response is slower, the sequence is:

1. `inv_002` resolves, and the details show invoice 002.
2. `inv_001` resolves late, and the details show invoice 001, while `inv_002` is highlighted in the list.

The user may now pay or refund the wrong invoice. The cause: `InvoiceDetails` stays mounted across selections, and every in-flight promise holds the same `setInvoice`. Whichever resolves last wins.

## Fix A: abort the previous request (preferred for `fetch`)

```tsx
const [invoice, setInvoice] = useState<Invoice | null>(null);
const [error, setError] = useState<Error | null>(null);

useEffect(() => {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`Failed to load invoice ${invoiceId}: ${res.status}`);
      setInvoice(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // superseded; not an error
      setError(err as Error);
    }
  })();

  return () => controller.abort(); // runs before the next effect and on unmount
}, [invoiceId]);
```

The cleanup of the previous effect runs before the next effect starts, so the older request is cancelled and can never call `setInvoice`. The browser also stops downloading it.

## Fix B: ignore stale results (works for any promise)

When the async work isn't cancellable (an SDK call, IndexedDB, a Web Worker message):

```tsx
useEffect(() => {
  let ignore = false;
  billingSdk.getInvoice(invoiceId).then((inv) => {
    if (!ignore) setInvoice(inv);
  });
  return () => {
    ignore = true; // this effect run is obsolete from now on
  };
}, [invoiceId]);
```

Each effect run has its own `ignore` variable, captured by its own `.then` callback. Cleanup flips only the obsolete run's flag.

## Fix C: compare against the latest request

Useful when the promise is created somewhere you can't wrap, but the result carries its identity:

```tsx
const latestIdRef = useRef(invoiceId);

useEffect(() => {
  latestIdRef.current = invoiceId;
  loadInvoice(invoiceId).then((inv) => {
    if (inv.id === latestIdRef.current) setInvoice(inv);
  });
}, [invoiceId]);
```

## Fix D: remount per item (last resort)

```tsx
<InvoiceDetails key={invoiceId} invoiceId={invoiceId} />
```

The old instance unmounts, and setting state on an unmounted component is a no-op, so the stale response is dropped. It also destroys all local state, focus and scroll, and re-runs every effect below it. Use it when you *want* a fresh instance per item anyway (see `react-reconciliation`), not as the race-condition fix.

## Keep the previous item visible while loading the next

With any of the fixes, you can avoid flashing a skeleton on every click by keeping the last invoice on screen with a loading indicator:

```tsx
const [state, setState] = useState<{ invoice: Invoice | null; loadingId: string | null }>({ invoice: null, loadingId: null });
// on start: setState((s) => ({ ...s, loadingId: invoiceId }))
// on success (if not aborted): setState({ invoice: result, loadingId: null })
```

Libraries provide this directly (TanStack Query `placeholderData: keepPreviousData`; SWR `keepPreviousData: true`).

## Requests started from event handlers

Search-as-you-type, filters and "load more" often start requests in handlers rather than effects. There's no effect cleanup to lean on, so track the in-flight controller yourself:

```tsx
function useLatestRequest() {
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []); // abort on unmount

  return useCallback(async <T,>(url: string): Promise<T | undefined> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return undefined; // superseded
      throw err;
    }
  }, []);
}
```

Combine it with a debounce to reduce request volume (`react-refs-closures`). Debounce controls *how many* requests start; aborting controls *which response* is allowed to land.

## Things that are not fixes

- **`async`/`await` instead of `.then`**: same race, different syntax.
- **A "loading" boolean that blocks new requests**: users can't switch until the slow one finishes, and a stale response still wins if the flag resets early.
- **Removing StrictMode because effects run twice in development**: the double run is how React surfaces missing cleanups. With Fix A or B in place, the extra request is harmless.

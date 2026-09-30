# Example: Debounce and Throttle That Actually Work

## Why the obvious version fails

```tsx
function CitySearch() {
  const [query, setQuery] = useState('');
  const search = debounce((q: string) => fetchCities(q), 300); // runs on every render

  return (
    <input
      value={query}
      onChange={(e) => {
        setQuery(e.target.value);
        search(e.target.value);
      }}
    />
  );
}
```

Typing "paris" sends five requests ("p", "pa", "par", "pari", "paris"), each 300 ms late. Every keystroke calls `setQuery`, which re-renders `CitySearch`, which calls `debounce(...)` again and creates a *new* debouncer with its own timer. Each keystroke therefore goes to a different debouncer, and every one of them fires. The result is a delay, not a debounce.

Two tempting fixes that are also wrong:

- **`useMemo(() => debounce(...), [query])` or `useCallback` with state deps**: the debouncer is recreated whenever `query` changes, which is every keystroke. Same result.
- **`useRef(debounce(() => fetchCities(query), 300))`**: one debouncer, but its function closes over the first render's `query`. It fetches "" forever.

## Debounced search with stale-response protection

```tsx
import { useDebouncedCallback } from './hooks/use-debounced-callback';

function CitySearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<City[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const search = useDebouncedCallback(async (q: string) => {
    controllerRef.current?.abort(); // drop the previous in-flight request
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const res = await fetch(`/api/cities?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      setResults(await res.json());
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // superseded, not an error
      setError(err as Error);
    }
  }, 300);

  useEffect(() => () => controllerRef.current?.abort(), []); // abort in-flight request on unmount

  return (
    <>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value); // immediate: the input stays responsive
          search(e.target.value);   // debounced: one request after typing pauses
        }}
      />
      {error ? <p role="alert">{error.message}</p> : <CityList cities={results} />}
    </>
  );
}
```

- `useDebouncedCallback` creates the debouncer once per instance and always calls the latest callback. It also cancels a pending call on unmount.
- The abort handles responses arriving out of order. A debounce reduces how many requests are sent; it doesn't guarantee they resolve in order.
- If the project uses TanStack Query or SWR, debounce the *query key* instead (`const debouncedQuery = useDebouncedValue(query, 300)`) and let the library handle cancellation and caching.

A debounced *value* hook, when you'd rather derive a value than call a function:

```tsx
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id); // each change resets the timer
  }, [value, delayMs]);
  return debounced;
}
```

This is correct because the effect cleanup clears the previous timer on every change, so only the last value survives the pause.

## Throttled autosave that doesn't lose the last edit

A long-form editor saves drafts while the user types: at most every 2 seconds, and never losing the final keystrokes.

```tsx
import { useThrottledCallback } from './hooks/use-throttled-callback';

function DraftEditor({ draftId }: { draftId: string }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');

  const save = useThrottledCallback(
    async (content: string) => {
      setStatus('saving');
      try {
        await saveDraft(draftId, content); // reads the latest draftId
        setStatus('saved');
      } catch {
        setStatus('error');
      }
    },
    2000,
    { flushOnUnmount: true }, // navigating away still saves the pending edit
  );

  return (
    <>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          save(e.target.value);
        }}
        onBlur={() => save.flush()} // save immediately when the user leaves the field
      />
      <SaveStatus status={status} />
    </>
  );
}
```

Throttle instead of debounce here, because a user typing continuously would *never* trigger a debounced save. Throttle guarantees periodic saves. The trailing call carries the latest text, so the final state is always saved.

For production autosave, also handle ordering on the server side (send a version number or timestamp) so a slow earlier save can't overwrite a later one.

## Throttled scroll or resize tracking

```tsx
const reportScrollDepth = useThrottledCallback((depth: number) => analytics.track('scroll_depth', { depth }), 1000);

<div onScroll={(e) => reportScrollDepth(Math.round(e.currentTarget.scrollTop / 100) * 100)}>{children}</div>;
```

For visual updates tied to scroll or resize, prefer CSS (`position: sticky`, scroll-driven animations, container queries) or `requestAnimationFrame`-batched writes over throttled React state. Throttling state updates still re-renders at the throttle rate.

## Wrapping an existing library debounce

If the project already depends on lodash or es-toolkit:

```tsx
function useLibraryDebounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number) {
  const latest = useLatestCallback(fn);
  const [debounced] = useState(() => debounce((...args: Args) => latest(...args), ms));
  useEffect(() => () => debounced.cancel(), [debounced]);
  return debounced;
}
```

This has the same three properties: created once, calls the latest callback, cancelled on unmount. Changing `ms` after mount is ignored in this minimal version; the asset handles it.

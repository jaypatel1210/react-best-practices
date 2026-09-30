# Example: When the Heavy Render Genuinely Depends on the Changing State

Sometimes restructuring can't help: the expensive part *must* respond to the state. Typing in a filter has to re-filter the table. In that case, keep the urgent update (the input) fast and let the expensive update lag or do less.

## Scenario: filtering 5,000 rows while typing

### Before

```tsx
function CustomerDirectory({ customers }: { customers: Customer[] }) {
  const [query, setQuery] = useState('');
  const visible = customers.filter((c) => matches(c, query));

  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <CustomerTable rows={visible} />
    </>
  );
}
```

Each keystroke re-filters and re-renders thousands of rows before the browser can paint the new character. Input lag is the most noticeable kind of slowness, and it shows up in the INP (Interaction to Next Paint) metric.

### Step 1: defer the expensive part

```tsx
function CustomerDirectory({ customers }: { customers: Customer[] }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  const visible = useMemo(
    () => customers.filter((c) => matches(c, deferredQuery)),
    [customers, deferredQuery],
  );

  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <div style={{ opacity: isStale ? 0.6 : 1 }}>
        <CustomerTable rows={visible} />
      </div>
    </>
  );
}

const CustomerTable = memo(function CustomerTable({ rows }: { rows: Customer[] }) {
  // ...expensive rendering
});
```

How it works:

- The keystroke first renders with the old `deferredQuery`. The input updates immediately.
- `useMemo` returns the cached `visible` array, and `memo` skips `CustomerTable` because `rows` is the same array.
- React then renders again in the background with the new `deferredQuery`. That render is interruptible: if another keystroke arrives, React abandons it and starts over with the latest value.
- `isStale` lets you hint that results are catching up.

**Both `memo` and `useMemo` are required.** Without them the urgent render still does all the heavy work, and deferring gains nothing. This is one of the legitimate uses of memoization described in the `react-memoization` skill. With React Compiler enabled, the compiler adds the equivalent memoization for you.

`startTransition(() => setFilter(value))` is the alternative when you own the state setter for the expensive part and want to mark *that update* as non-urgent. Use `useDeferredValue` when you receive the value from elsewhere or want to keep a single state.

### Step 2: render less

If a single render of the table is still too slow, render only the visible rows:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function CustomerTable({ rows }: { rows: Customer[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
  });

  return (
    <div ref={parentRef} style={{ height: 600, overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => (
          <CustomerRow
            key={rows[item.index].id}
            customer={rows[item.index]}
            style={{ position: 'absolute', top: 0, transform: `translateY(${item.start}px)`, height: item.size }}
          />
        ))}
      </div>
    </div>
  );
}
```

Use whatever virtualization library the project already has. Keys still come from data IDs, not the virtual index; see `react-reconciliation`.

### Debounce vs deferred value

| Goal | Tool |
|---|---|
| Fewer **network requests** while typing | Debounce the request (see `react-refs-closures`) and cancel stale ones (see `react-data-fetching`) |
| Responsive typing despite **expensive rendering** | `useDeferredValue` or `startTransition`, plus `memo` |
| Both | Deferred value for rendering; debounced fetch for the server |

A debounce adds a fixed delay even on fast devices. A deferred value adapts: on a fast machine the background render finishes almost immediately.

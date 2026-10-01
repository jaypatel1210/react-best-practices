# Example: Dependencies That Loop or Over-fire

Dependency arrays compare each entry with `Object.is`. Primitives compare by value; objects, arrays and functions compare by identity, and anything created during render has a new identity every render.

## Scenario 1: an object dependency that requests forever

```tsx
function TicketList({ status, page }: { status: TicketStatus; page: number }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const filters = { status, page, pageSize: 50 };

  useEffect(() => {
    const controller = new AbortController();
    fetchTickets(filters, controller.signal).then(setTickets).catch(ignoreAbort);
    return () => controller.abort();
  }, [filters]);
  // ...
}
```

Render creates `filters` → the effect runs → `setTickets` re-renders with a new array → render creates a new `filters` → the effect runs again. Nothing crashes, because each `setTickets` happens asynchronously, so React never sees "too many nested updates". The network tab fills with requests, and the list flickers.

**Fix A: build the object inside the effect and depend on primitives.**

```tsx
useEffect(() => {
  const controller = new AbortController();
  fetchTickets({ status, page, pageSize: 50 }, controller.signal).then(setTickets).catch(ignoreAbort);
  return () => controller.abort();
}, [status, page]);
```

**Fix B: when the object comes from a parent**, stabilize it where it's created (`useMemo` in the parent), or have the child receive primitives instead of an object.

**Fix C: hoist values that never change**, such as `const PAGE_SIZE = 50`, to module scope.

With a data library, the same rule applies to query keys: `queryKey: ['tickets', status, page]` built from primitives.

## Scenario 2: a callback prop that reconnects a socket

```tsx
function OrderFeed({ storeId, onOrder }: { storeId: string; onOrder: (o: Order) => void }) {
  useEffect(() => {
    const socket = connectOrders(storeId);
    socket.on('order', onOrder);
    return () => socket.close();
  }, [storeId, onOrder]); // the parent passes an inline arrow
}
```

The parent re-renders whenever anything in it changes, passing a new `onOrder`, so the socket disconnects and reconnects, dropping orders that arrive in between. `onOrder` is something the effect *calls*, not something it should *re-synchronize* for.

```tsx
// React 19.2+
function OrderFeed({ storeId, onOrder }: Props) {
  const handleOrder = useEffectEvent((order: Order) => onOrder(order));
  useEffect(() => {
    const socket = connectOrders(storeId);
    socket.on('order', handleOrder);
    return () => socket.close();
  }, [storeId]); // Effect Events are not dependencies
}
```

On earlier versions, use `useLatestCallback` from `react-refs-closures/assets/use-latest-callback.ts` and list its stable result as a dependency. Don't ask every parent to remember `useCallback`: the component is correct on its own.

## Scenario 3: a synchronous loop

```tsx
const [range, setRange] = useState<Range>({ from, to });
useEffect(() => {
  setRange({ from, to }); // a new object every time
}); // no dependency array
```

Every commit sets a new object, which re-renders, which commits, which sets a new object. React stops it with "Maximum update depth exceeded". The value is derived: `const range = { from, to };` (memoized only if a `memo` child or a dependency array needs a stable reference).

## Scenario 4: an effect that reads the state it sets

```tsx
useEffect(() => {
  if (latestEvent) setLog([...log, latestEvent]);
}, [latestEvent, log]);
```

Setting `log` changes `log`, which re-runs the effect, which appends `latestEvent` again. Read the previous value through an updater so the effect doesn't depend on it:

```tsx
useEffect(() => {
  if (latestEvent) setLog((prev) => [...prev, latestEvent]);
}, [latestEvent]);
```

Better still, append in the code that receives the event (the socket handler or event handler), with no effect at all.

## Scenario 5: updaters and reducers with side effects

```tsx
setCart((prev) => {
  prev.items.push(item);        // mutates the current state
  analytics.track('add_to_cart'); // a side effect inside an updater
  return prev;                  // same object: React may skip the re-render
});
```

- Returning the same object lets React bail out, so the screen may not update at all.
- StrictMode calls updaters twice in development, so the item is pushed twice and the event is tracked twice. Mutation corrupts the state the first call already used.

```tsx
const addItem = (item: CartItem) => {
  setCart((prev) => ({ ...prev, items: [...prev.items, item] })); // pure
  analytics.track('add_to_cart');                                    // in the handler
};
```

The same applies to reducers: a `case 'checkout':` that calls an API runs that request twice in development and replays it whenever React re-applies queued updates. Reducers compute the next state; handlers perform effects.

## Diagnosing over-firing effects

- Log inside the effect with its dependencies: `console.log('sync', { status, page })`. If it logs with identical values, a dependency changes identity without changing meaning.
- React DevTools' "Why did this render?" shows which prop or hook changed for the component.
- The `react-hooks/exhaustive-deps` lint warning about "the object makes the dependencies change on every render" points to Scenario 1 directly.

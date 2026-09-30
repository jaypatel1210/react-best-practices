# Example: Reading Only a Slice of Shared State

## Why "selecting" from context doesn't work by itself

```tsx
function useCartCount() {
  const { items } = useContext(CartContext);
  return useMemo(() => items.length, [items]); // still re-renders on ANY cart context change
}
```

The component calling `useCartCount` subscribes to the whole `CartContext`. The `useMemo` caches a value, but it can't stop the re-render that the context change already caused.

## Option 1: a memoized inner component

Use this when one expensive component needs one stable piece of a busy context, and restructuring the context isn't worth it.

```tsx
const HeavyBoard = memo(function HeavyBoard({ onRequestFullscreen }: { onRequestFullscreen: () => void }) {
  // ...expensive rendering; never re-renders because of RailContext changes
});

function BoardWithRail() {
  // Thin wrapper: reads the context and re-renders on every context change (cheap)
  const { collapse } = useRail(); // `collapse` must be stable in the provider (see provider-patterns.md)
  return <HeavyBoard onRequestFullscreen={collapse} />;
}
```

The wrapper re-renders when the context changes. `HeavyBoard` receives a stable function, so `memo` skips it. The same idea packaged as a HOC:

```tsx
function withRailCollapse<P extends { onRequestFullscreen: () => void }>(Component: React.ComponentType<P>) {
  const Memoized = memo(Component) as unknown as React.ComponentType<P>;
  function WithRailCollapse(props: Omit<P, 'onRequestFullscreen'>) {
    const { collapse } = useRail();
    return <Memoized {...(props as P)} onRequestFullscreen={collapse} />;
  }
  return WithRailCollapse;
}
```

This only works if every other prop passed through is also stable. See `react-memoization`.

## Option 2: a tiny external store with selectors

For shared state that changes often and is read in slices, keep it outside React and subscribe with `useSyncExternalStore`. A component re-renders only when *its selected value* changes.

```tsx
type Listener = () => void;

export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    setState: (update: (prev: T) => T) => {
      const next = update(state);
      if (Object.is(next, state)) return;
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T, S>(store: ReturnType<typeof createStore<T>>, selector: (state: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()), // server snapshot for SSR
  );
}

// Usage
export const cartStore = createStore({ items: [] as CartItem[], isOpen: false });

function CartBadge() {
  const count = useStore(cartStore, (s) => s.items.length); // primitive: re-renders only when the count changes
  return <span className="badge">{count}</span>;
}

function addToCart(item: CartItem) {
  cartStore.setState((s) => ({ ...s, items: [...s.items, item] }));
}
```

The selector must return either a primitive or a value that is **the same reference when nothing relevant changed**, such as `s.items` itself. A selector that builds a new object or array on every call (`(s) => ({ count: s.items.length })` or `(s) => s.items.filter(...)`) makes `useSyncExternalStore` see a "change" on every check, which causes extra renders or an infinite-loop warning. For derived collections, memoize the derivation (for example, cache it by the input reference) or select the raw slice and derive in the component.

If you need an SSR-safe store per request, create it inside a provider and pass it through context. The context value (the store object) never changes, so consumers subscribe to the store, not to the context.

## Option 3: a store library

Once you need middleware, devtools, persistence, many derived selectors, or cross-tab sync, use a library instead of growing a homemade store:

```tsx
// Zustand
const useCart = create<CartState>()((set) => ({
  items: [],
  add: (item) => set((s) => ({ items: [...s.items, item] })),
}));

const count = useCart((s) => s.items.length);  // selector subscription
const add = useCart((s) => s.add);            // stable action
```

For selectors that return objects, Zustand's `useShallow`, Redux's `shallowEqual` or memoized selectors (`createSelector`) keep references stable.

## Decision guide

- A few consumers, low update frequency → context with a memoized value is enough.
- Many consumers and busy updates, but a clear state/actions split → split contexts.
- One heavy consumer needs one stable piece → the memoized inner component.
- Many consumers reading different slices of busy state → a store with selectors.
- Server data → a data-fetching cache, not a client store.

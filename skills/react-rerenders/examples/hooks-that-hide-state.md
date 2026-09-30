# Example: State Hidden in Custom Hooks

A hook call is part of the component that makes it. Any `useState`, `useReducer`, `useSyncExternalStore` or context read inside the hook, or inside hooks *it* calls, re-renders that component on change. That's true even when the component ignores the return value.

## Scenario 1: a viewport hook in the app shell

```tsx
function useViewport() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function AppShell() {
  const { width } = useViewport();
  const isCompact = width < 768;
  return (
    <Layout sidebar={isCompact ? null : <Sidebar />}>
      <Routes />
    </Layout>
  );
}
```

Three problems compound:

- A resize fires many events per second during a drag.
- Each event stores a **new object**, so the `Object.is` bail-out can never apply.
- The hook sits in `AppShell`, so the entire app re-renders on each event, while the component only cares whether the width crosses 768px.

### Fix A: store the coarse value

```tsx
type Breakpoint = 'compact' | 'regular';

function getBreakpoint(): Breakpoint {
  return window.innerWidth < 768 ? 'compact' : 'regular';
}

function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState(getBreakpoint);
  useEffect(() => {
    const onResize = () => setBp(getBreakpoint()); // same string → React bails out
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return bp;
}
```

Resizing now re-renders `AppShell` only when the breakpoint actually changes.

This version reads `window` while initializing, so it's client-only. In SSR apps, use Fix B, which supplies a server snapshot.

### Fix B: subscribe to exactly what you need

`matchMedia` fires only when the query result flips, and `useSyncExternalStore` handles concurrent rendering and SSR correctly:

```tsx
function useMediaQuery(query: string, serverFallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches, // client snapshot: a primitive
    () => serverFallback,                    // server snapshot
  );
}

const isCompact = useMediaQuery('(max-width: 767px)');
```

Keep snapshots primitive, or return a cached object. A `getSnapshot` that builds a new object on each call makes React re-render in a loop.

The `useCallback` here is not decoration. `subscribe` is passed to a hook, and `useSyncExternalStore` re-subscribes whenever that function's identity changes.

### Fix C: call it where it's used

If only the sidebar toggle needs the value, call the hook there rather than in `AppShell`:

```tsx
function SidebarSlot() {
  const isCompact = useMediaQuery('(max-width: 767px)');
  return isCompact ? null : <Sidebar />;
}
```

Fixes A and B reduce *how often* the host re-renders. Fix C reduces *what* re-renders. Combine them.

## Scenario 2: hidden two levels deep

```tsx
function useChatLayout() {
  const isCompact = useMediaQuery('(max-width: 767px)');
  const presence = usePresence();        // socket subscription, updates every few seconds
  const composerHeight = useComposerHeight(); // updates as the user types multi-line messages
  return { isCompact, columns: isCompact ? 1 : 2 };
}

function ChatPage() {
  const layout = useChatLayout(); // re-renders the whole chat page on presence ticks and while typing
  // ...
}
```

`ChatPage` re-renders on every presence tick and while the user types, even though it only reads `isCompact` and `columns`. The return value doesn't matter: the state in `usePresence` and `useComposerHeight` belongs to `ChatPage`.

Fix: remove the unrelated subscriptions from the layout hook, and call `usePresence` and `useComposerHeight` in the components that display presence and the composer.

## Checklist for hooks

- **Is the hook called high in the tree?** Check what it holds: state, subscriptions, and context reads, including those inside nested hooks.
- **How often can it change?** Every keystroke, scroll, resize, timer tick or socket message is a red flag at the top of the tree.
- **Does it store more detail than callers need?** Raw width versus a breakpoint; a full object versus one field.
- **Does it return a new object each render?** That doesn't cause re-renders by itself, but it breaks `memo` and effect dependencies downstream. See `react-memoization`.

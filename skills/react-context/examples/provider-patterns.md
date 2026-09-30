# Example: Building a Context Provider Step by Step

## The problem

A project-management app has a collapsible navigation rail. The collapse button lives deep inside `NavRail`. The board area, deep inside `BoardView`, shows 3 columns when the rail is collapsed and 2 when it's expanded. Both subtrees are expensive.

### Step 0: lifting state (the slow version)

```tsx
function Workspace() {
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  return (
    <AppLayout>
      <NavRail isCollapsed={isRailCollapsed} onToggle={() => setIsRailCollapsed((c) => !c)} />
      <BoardView columns={isRailCollapsed ? 3 : 2} />
    </AppLayout>
  );
}
```

Every toggle re-renders `Workspace`, and therefore all of `NavRail` and `BoardView`. Both also gain props they only pass down.

### Step 1: a provider that owns the state and renders children

```tsx
type RailContextValue = { isCollapsed: boolean; toggle: () => void };
const RailContext = createContext<RailContextValue | null>(null);

function RailProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const toggle = () => setIsCollapsed((c) => !c);
  return <RailContext.Provider value={{ isCollapsed, toggle }}>{children}</RailContext.Provider>;
}

function useRail() {
  const ctx = useContext(RailContext);
  if (!ctx) throw new Error('useRail must be used within RailProvider');
  return ctx;
}

function Workspace() {
  return (
    <RailProvider>
      <AppLayout>
        <NavRail />
        <BoardView />
      </AppLayout>
    </RailProvider>
  );
}

function RailToggleButton() {
  const { isCollapsed, toggle } = useRail();
  return <button onClick={toggle} aria-expanded={!isCollapsed}>{isCollapsed ? 'Expand' : 'Collapse'}</button>;
}

function BoardColumns({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useRail();
  return <div className={isCollapsed ? 'board board--3' : 'board board--2'}>{children}</div>;
}
```

Toggling now re-renders `RailToggleButton` and `BoardColumns` only. `AppLayout`, `NavRail` and `BoardView` were created by `Workspace` and passed as children, so they're skipped. The props-drilling is gone too.

### Step 2: memoize the value

A month later someone moves the provider into `AppLayout` and adds scroll tracking there:

```tsx
function AppLayout({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useScrolledPast(80, setScrolled);
  return (
    <RailProvider>
      <div className={scrolled ? 'layout layout--scrolled' : 'layout'}>{children}</div>
    </RailProvider>
  );
}
```

`RailProvider` now re-renders whenever `scrolled` flips. Its `value={{ … }}` is a new object each time, so every `useRail()` consumer re-renders on scroll changes, even though the rail state didn't change. Memoizing prevents this whatever the provider's surroundings:

```tsx
function RailProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const toggle = useCallback(() => setIsCollapsed((c) => !c), []);
  const value = useMemo(() => ({ isCollapsed, toggle }), [isCollapsed, toggle]);
  return <RailContext.Provider value={value}>{children}</RailContext.Provider>;
}
```

### Step 3: split state from actions

A global keyboard shortcut (`[`) toggles the rail. The shortcut handler lives in a large `ShortcutLayer` component that only needs `toggle`. With one context it re-renders on every toggle, although it never displays the state.

```tsx
const RailStateContext = createContext<boolean | null>(null);
const RailActionsContext = createContext<{ toggle(): void; collapse(): void; expand(): void } | null>(null);

function RailProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const actions = useMemo(
    () => ({
      toggle: () => setIsCollapsed((c) => !c),
      collapse: () => setIsCollapsed(true),
      expand: () => setIsCollapsed(false),
    }),
    [], // setters are stable, and functional updates remove the state dependency
  );
  return (
    <RailActionsContext.Provider value={actions}>
      <RailStateContext.Provider value={isCollapsed}>{children}</RailStateContext.Provider>
    </RailActionsContext.Provider>
  );
}

export function useRailCollapsed() {
  const v = useContext(RailStateContext);
  if (v === null) throw new Error('useRailCollapsed must be used within RailProvider');
  return v;
}
export function useRailActions() {
  const v = useContext(RailActionsContext);
  if (!v) throw new Error('useRailActions must be used within RailProvider');
  return v;
}
```

`ShortcutLayer` calls `useRailActions()` and never re-renders because of the rail state. The state context's value is a boolean primitive, so it needs no memoization.

### Step 4: when there's more state, use a reducer

If the rail grows (width, pinned sections, a hover-peek mode), a reducer keeps transitions named and actions stable:

```tsx
type RailState = { isCollapsed: boolean; width: number; peek: boolean };
type RailAction =
  | { type: 'toggle' }
  | { type: 'resize'; width: number }
  | { type: 'peek'; on: boolean };

function railReducer(state: RailState, action: RailAction): RailState {
  switch (action.type) {
    case 'toggle': return { ...state, isCollapsed: !state.isCollapsed, peek: false };
    case 'resize': return { ...state, width: Math.max(56, Math.min(400, action.width)) };
    case 'peek': return state.isCollapsed ? { ...state, peek: action.on } : state;
  }
}

function RailProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(railReducer, { isCollapsed: false, width: 240, peek: false });
  const actions = useMemo(() => ({
    toggle: () => dispatch({ type: 'toggle' }),
    resize: (width: number) => dispatch({ type: 'resize', width }),
    peek: (on: boolean) => dispatch({ type: 'peek', on }),
  }), []);
  return (
    <RailActionsContext.Provider value={actions}>
      <RailStateContext.Provider value={state}>{children}</RailStateContext.Provider>
    </RailActionsContext.Provider>
  );
}
```

When the rail isn't collapsed, `peek` returns the same `state` object, so React bails out and consumers don't re-render. `state` itself is stable between unrelated renders because only `dispatch` replaces it. (With this shape, `RailStateContext`'s type becomes `RailState | null`.)

If `width` changes continuously while dragging, consumers that only care about `isCollapsed` would re-render on every drag frame. That's the signal to split `width` into its own context or move this state into a store with selectors (see `selecting-from-context.md`).

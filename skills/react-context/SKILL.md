---
name: react-context
description: Use React Context without performance problems, covering the provider-owns-state pattern, memoized provider values, splitting state and actions into separate contexts, useReducer or functional updates for stable action APIs, selector-style subscriptions, and when to move to an external store (Zustand, Redux, Jotai, useSyncExternalStore). Use when creating or reviewing a Context or Provider, when many components re-render after one context change, when replacing prop drilling, or when choosing a state-management approach for shared client state.
license: MIT
---

# React Context Without the Re-render Tax

Context delivers data from a provider to any descendant without threading props through every layer. Used well, it *improves* performance, because the components in between don't re-render at all. Used carelessly, a single change re-renders every consumer in the app.

## Three facts to design around

1. **Consumers re-render when the provider's `value` changes identity** (`Object.is`).
2. **All of them re-render**, including those that read a part of the value that didn't change. Destructuring (`const { open } = useContext(Ctx)`) doesn't narrow the subscription.
3. **`memo` on a consumer doesn't prevent it.** Reading context behaves like owning state: the component re-renders even when its props are equal.

## Pattern 1: the provider owns the state and renders `children`

```tsx
type SidebarContextValue = { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void };
const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const value = useMemo(() => ({ isCollapsed, setIsCollapsed }), [isCollapsed]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider');
  return ctx;
}
```

- **Why `children`**: the tree between the provider and its consumers is created by the provider's *parent*, so it isn't re-rendered when the provider's state changes. Only consumers are. Compare this with lifting the state into a page component, which re-renders the whole page.
- **A `null` default plus a throwing hook** turns a missing provider into an immediate, clear error instead of a silent default value.
- On React 19 you can render `<SidebarContext value={value}>` directly. `.Provider` still works; follow the codebase.

## Pattern 2: always memoize the provider value

`value={{ isCollapsed, setIsCollapsed }}` creates a new object *whenever the provider renders for any reason*. Then every consumer re-renders, even when nothing changed. It's often harmless on day one, when the provider sits at the root. It becomes a bug the day someone renders the provider inside a component with frequently-changing state, like a layout that tracks scroll position.

Memoize provider values by default. This is one of the few places where memoizing without measuring is right, because you can't know which component will render the provider later. Functions in the value must be stable too (`useCallback`, state setters, `dispatch`).

## Pattern 3: split contexts by what changes and who reads it

```tsx
const SidebarStateContext = createContext<{ isCollapsed: boolean } | null>(null);
const SidebarActionsContext = createContext<{ collapse(): void; expand(): void; toggle(): void } | null>(null);
```

- **State and actions apart.** Components that only *trigger* changes (a keyboard shortcut handler, a menu item) read the actions context and never re-render when the state changes.
- **Unrelated domains apart.** Theme, current user, feature flags and cart state go in separate contexts, not one `AppContext`.
- **Hot slices apart.** A frequently-updating field gets its own context, or leaves context entirely (Pattern 5).

## Pattern 4: make actions independent of state

An action that reads state (`toggle = () => setIsCollapsed(!isCollapsed)`) has to change whenever the state changes, which drags the actions context along with it. Remove the dependency:

- **Functional updates:** `const toggle = useCallback(() => setIsCollapsed((c) => !c), []);`
- **`useReducer`:** `dispatch` is stable, so an actions object built from it never changes:

  ```tsx
  const [state, dispatch] = useReducer(sidebarReducer, { isCollapsed: false });
  const actions = useMemo(() => ({
    collapse: () => dispatch({ type: 'collapse' }),
    expand: () => dispatch({ type: 'expand' }),
    toggle: () => dispatch({ type: 'toggle' }),
  }), []);
  ```

Either way the actions context value is created once, and its consumers never re-render because of state changes. A reducer shines when there are several related fields and named transitions. For one boolean, functional updates are simpler.

## Pattern 5: selecting a slice

Context has no built-in selectors. In order of preference:

1. **Split the context** further (Pattern 3). This is usually enough.
2. **Use a memoized inner component.** A thin wrapper reads the context and passes only the needed, stable slice as props to a `memo` child. The wrapper re-renders on every context change, but it's cheap. The heavy child re-renders only when its slice changes. See `examples/selecting-from-context.md`.
3. **Use an external store with selector subscriptions**: Zustand, Redux Toolkit, Jotai, or a small store built on `useSyncExternalStore`. A component re-renders only when the value its selector returns changes.

## Context or an external store?

| Shared state | Recommended |
|---|---|
| Low-frequency values: theme, locale, signed-in user, feature flags, permissions | Context |
| Dependency injection: API clients, analytics, services | Context (value created once) |
| Compound component internals (`Tabs`, `Menu`) | Context |
| Frequently-changing state read by many components in different slices (editors, canvases, real-time dashboards, large forms) | External store with selectors |
| Server data (lists, entities, pagination) | A data-fetching cache (TanStack Query, SWR, RTK Query, Apollo), not context |

## Anti-patterns

- `value={{ … }}` without `useMemo`, or functions in the value recreated every render.
- One god context with everything in it.
- High-frequency values (pointer position, scroll offset, typed text, animation progress) in a widely-consumed context.
- A provider placed higher than needed, so unrelated screens subscribe to it.
- Reading a context in a big component just to pass one field down. Read it in the leaf that needs it.

## Review checklist

- [ ] The provider value is memoized, and every function in it is stable.
- [ ] State and actions are split when some consumers only call actions.
- [ ] Actions don't depend on state (functional updates or `dispatch`).
- [ ] Contexts are separated by domain and by update frequency.
- [ ] Consumers read context in the smallest component that needs it.
- [ ] Hot, widely-read state lives in a store with selectors, and server data in a data cache.
- [ ] There's a custom hook with a clear error when the provider is missing.

## Examples

- `examples/provider-patterns.md`: a workspace layout provider built step by step (children, a memoized value, a state/actions split, a reducer) with the re-render effect of each step.
- `examples/selecting-from-context.md`: selecting a slice with a memoized inner component, a tiny `useSyncExternalStore` store with selectors, and when to migrate to a store library.

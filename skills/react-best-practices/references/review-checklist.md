# React Review Checklist

Use this list when reviewing or auditing React code. Each item gives a pattern to look for, why it matters, and the fix, plus the focused skill with more depth. Flag only items that actually apply to the code in front of you.

## Contents

1. [Severity guide](#severity-guide)
2. [Re-renders and state placement](#1-re-renders-and-state-placement)
3. [Memoization](#2-memoization)
4. [Identity, keys and reconciliation](#3-identity-keys-and-reconciliation)
5. [Effects, refs and closures](#4-effects-refs-and-closures)
6. [Context and shared state](#5-context-and-shared-state)
7. [Component API design](#6-component-api-design)
8. [Layout, overlays and portals](#7-layout-overlays-and-portals)
9. [Data fetching](#8-data-fetching)
10. [Error handling](#9-error-handling)
11. [Output format](#output-format)

## Severity guide

- **High (bug):** users see wrong data, lose input or state, hit a crash or blank screen, or data is written to the wrong place. Race conditions, state leaking between entities, remount-on-every-render, missing root error boundary.
- **Medium (performance on a hot path):** work that repeats on keystrokes, scroll, pointer moves, resize or animation frames, or on large lists. Also broken memoization on components that are demonstrably expensive.
- **Low (maintainability):** noise memoization, configuration-prop explosion, legacy patterns with no current cost.

Only call something a performance issue when it sits on a path that runs often or is expensive. "This re-renders" is not a finding by itself; "this re-renders the 2,000-row table on every keystroke" is.

## 1. Re-renders and state placement

| Look for | Why it matters | Fix |
|---|---|---|
| Frequently-changing state (input text, scroll/pointer position, timers, drag, resize) in a component that also renders heavy, unrelated children | Every update re-renders the whole subtree | Move the state and its consumers into a small component, or pass the heavy parts as `children`/element props. `react-rerenders` |
| Custom hooks with internal state or subscriptions (resize, scroll, intervals, sockets, media queries, form state) called high in the tree | Hook state re-renders the calling component even if the value is unused | Call the hook in a leaf; make it store coarse values; select narrowly. `react-rerenders` |
| State initialized from props and then synced with `useEffect`, or derived values stored in state | Extra render passes, and values drift out of sync | Compute during render; reset with `key`. `react-rerenders`, `react-reconciliation` |
| Page-level component owns state that only one widget uses | Whole page re-renders for a local interaction | Colocate state with the widget. `react-rerenders` |

## 2. Memoization

| Look for | Why it matters | Fix |
|---|---|---|
| `useCallback`/`useMemo` whose result goes only to DOM elements or non-`memo` components and is not a hook dependency | Adds cost and noise, prevents nothing | Remove it (unless it's a codebase convention). `react-memoization` |
| `memo` component receiving inline objects/arrays/functions, `style={{…}}`, or JSX (`children`, `icon={<Icon/>}`) | Props change every render, so `memo` never skips | Memoize those props, hoist constants, or drop `memo`. `react-memoization` |
| `memo` component receiving `{...props}` or values from custom hooks of unknown stability | Stability depends on code elsewhere and breaks silently | Pass explicit primitives; make the hook return stable values. `react-memoization` |
| Default parameters like `items = []` or `options = {}` feeding `memo` props or hook deps | A new array/object each render when the prop is omitted | Hoist a module-level constant. `react-memoization` |
| Custom `arePropsEqual` that ignores function props | Child keeps calling a stale callback | Compare all props; use a latest-ref callback. `react-memoization`, `react-refs-closures` |
| `useMemo` around cheap computations with no measurement | Mount cost and complexity for nothing | Remove, or measure first. `react-memoization` |
| React Compiler enabled and new code adds manual memoization, or code breaks the Rules of React (mutating props/state, reading refs during render) | Duplicated effort; compiler bails out of broken components | Remove new manual memo; fix rule violations. `react-memoization` |

## 3. Identity, keys and reconciliation

| Look for | Why it matters | Fix |
|---|---|---|
| Component declared inside another component's body; `withSomething(Component)` or `styled(...)` called during render | New component type every render, so the subtree remounts: focus lost, state reset, effects re-run, slow | Move the declaration to module scope and pass data as props. `react-reconciliation` |
| `key={index}` on lists that reorder, insert, delete or filter, or whose items hold state or are memoized | State and DOM stick to the position, not the item; memoized rows re-render | Use a stable ID from the data. `react-reconciliation` |
| `key={Math.random()}`, `key={uuid()}` or `key={Date.now()}` in render | Every item remounts every render | Use a stable ID assigned once, when data is created or fetched. `react-reconciliation` |
| Ternary between two instances of the same component type that represent different entities (`isA ? <Form a/> : <Form b/>`) | State leaks from one entity to the other | Give each a distinct `key`. `react-reconciliation` |
| `useEffect` that resets local state when an `id` prop changes | Stale state renders for a frame, and it's easy to miss fields | Key the component by the id. `react-reconciliation` |
| Conditional wrapper around a stateful subtree (`cond ? <Wrapper><Editor/></Wrapper> : <Editor/>`) | Toggling the condition remounts `Editor` | Keep the tree shape stable; toggle props or styles instead. `react-reconciliation` |

## 4. Effects, refs and closures

| Look for | Why it matters | Fix |
|---|---|---|
| Missing dependencies, or `eslint-disable` of `react-hooks/exhaustive-deps` | Effects and callbacks read stale values | Add the deps; use functional updates, the latest-ref pattern, or `useEffectEvent`. `react-refs-closures` |
| `setInterval`, socket or DOM listeners registered once but reading state or props | Handler sees mount-time values forever | Use functional updates or read through a latest ref. `react-refs-closures` |
| `ref.current` read or written during render (other than lazy init) | Rendered output goes stale; breaks purity and React Compiler | Move the access to effects or handlers; use state if the value is rendered. `react-refs-closures` |
| Rendered values stored in refs | UI doesn't update when they change | Use state. `react-refs-closures` |
| Boolean "trigger" props for imperative actions (`shouldFocus`, `openNow`) | Fire once, then need resetting, which is fragile | Expose a ref or imperative handle. `react-refs-closures` |
| `debounce(...)`/`throttle(...)` called in the render body, or re-created whenever state changes | Behaves like a delay: every call still fires | Create once per instance and call the latest callback via a ref; cancel on unmount. `react-refs-closures` |
| Effect used for logic that belongs to an event (e.g., "after submit, POST") | Runs at the wrong time, runs twice in dev, is hard to follow | Put it in the event handler. |

## 5. Context and shared state

| Look for | Why it matters | Fix |
|---|---|---|
| Provider `value={{ … }}` or functions created inline without memoization | Every consumer re-renders whenever the provider's parent re-renders | `useMemo` the value and `useCallback` the functions. `react-context` |
| One context mixing frequently-changing state with stable actions | Components that only dispatch still re-render on every state change | Split into state and actions contexts. `react-context` |
| High-frequency values (pointer, scroll, text input, timers) in a widely-consumed context | App-wide re-render storms | Keep them local, or use a store with selectors. `react-context` |
| Hand-rolled context caching of server data in an app that already has a data library | Duplicated caching, stale data, no dedupe | Use the library's cache. `react-data-fetching` |

## 6. Component API design

| Look for | Why it matters | Fix |
|---|---|---|
| Growing configuration props that only forward to an inner element (`iconName`, `iconSize`, `iconColor`) | Rigid, hard-to-extend API | Accept an element or render prop. `react-composition` |
| `cloneElement` that overwrites the caller's props (`cloneElement(el, defaults)`) | Consumer overrides silently stop working | Merge as `{...defaults, ...el.props}`, or use a render prop. `react-composition` |
| HOC that drops props, swallows the original callback, or is applied inside render | Broken behavior, or remounts | Spread props through, call the original handler, apply at module scope. `react-composition` |

## 7. Layout, overlays and portals

| Look for | Why it matters | Fix |
|---|---|---|
| Measure-then-`setState` in `useEffect` that changes layout visibly | A frame of wrong layout flashes | Use `useLayoutEffect`; keep the work small. `react-layout-portals` |
| `typeof window !== 'undefined'` (or similar) branching in render in SSR apps | Hydration mismatch | Render the same on server and first client render; switch after mount. `react-layout-portals` |
| Modal, popover or dropdown rendered inline inside containers with `transform`, `filter`, `overflow` or `z-index` | Clipped, mispositioned or hidden behind siblings | Portal to `document.body`, or use the top layer. `react-layout-portals` |
| `z-index: 9999` escalation as the fix | Can't beat a parent stacking context | Portal, or fix the stacking context. `react-layout-portals` |
| Portal content relying on ancestor CSS selectors, native ancestor listeners, or an outer `<form>` | Styles, events and submits don't follow the portal | Style the overlay directly; put the `<form>` inside the overlay. `react-layout-portals` |
| Ancestor `onClick`/`onKeyDown` handlers that also fire for clicks inside a portaled overlay | Synthetic events bubble through the React tree | `stopPropagation` at the overlay root, or check `event.currentTarget.contains(event.target)`. `react-layout-portals` |

## 8. Data fetching

| Look for | Why it matters | Fix |
|---|---|---|
| `fetch` in `useEffect` with changing deps and no cleanup | An older response can overwrite a newer one | Abort in cleanup (`AbortController`), or ignore stale results. `react-data-fetching` |
| Independent requests awaited one after another; children that only start fetching after the parent's data arrives | Waterfall: total time is the sum instead of the max | Start them in parallel; lift, prefetch or use a data provider. `react-data-fetching` |
| No `response.ok` check; errors swallowed; no loading or error state | Failures look like empty data | Check the status, surface errors, and render explicit states. `react-data-fetching` |
| Module-level (`const p = fetch(...)` at import time) fetches for non-critical data | Uncontrolled requests compete with critical ones | Keep them for critical route data or lazy chunks only. `react-data-fetching` |
| Re-implementing caching, dedupe, or retries that the project's data library already provides | Bugs and inconsistency | Use the library. `react-data-fetching` |

## 9. Error handling

| Look for | Why it matters | Fix |
|---|---|---|
| No error boundary at the root or route level | Any render error blanks the whole app | Add root and route boundaries with a useful fallback. `react-error-handling` |
| Independent widgets (charts, feeds, third-party embeds, editors) sharing one boundary with the whole page | One widget's crash takes the page down | Add boundaries around independent regions. `react-error-handling` |
| Errors in event handlers or promises neither handled nor surfaced | Silent failures | Handle locally, or re-throw into the boundary. `react-error-handling` |
| `setState` inside a `catch` during render | Infinite render loop | Return fallback UI, or let a boundary handle it. `react-error-handling` |
| Boundary without reporting or without a way to recover | Errors go unseen; users stuck | Add `componentDidCatch`/`onError` reporting and reset (`resetKeys`, a retry button). `react-error-handling` |

## Output format

Order findings by severity, then by impact. For each finding:

```markdown
### [High|Medium|Low] <short title> — `path/to/File.tsx:42`
**What happens:** <a concrete scenario a user or developer would hit>
**Why:** <the rule from the mental model, one sentence>
**Fix:** <code change or steps; a minimal diff is best>
```

End with a short list of what's done well when it's genuinely useful (for example, "keys are stable IDs throughout"). Don't invent issues to fill space.

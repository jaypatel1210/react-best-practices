---
name: react-effects
description: Write fewer and correct effects in React, covering when useEffect is the wrong tool (derived values, effect chains, resetting state, notifying parents, event-specific logic, subscriptions better served by useSyncExternalStore, one-time initialization), honest dependency arrays, loops caused by object and function dependencies, setState inside effects, effect timing, purity of render, updaters and reducers under StrictMode, and cleanup of every resource an effect acquires to prevent memory leaks (timers, listeners, observers, sockets, workers, third-party widgets, object URLs). Use when writing or reviewing any useEffect or useLayoutEffect, when a component renders twice or loops, when an effect fires too often or with stale values, when a handler runs several times after revisiting a screen, when memory grows as users navigate, or when lint flags exhaustive-deps or set-state-in-effect.
license: MIT
---

# Effects: Fewer, Honest, Cleaned Up

An effect **synchronizes a component with something outside React**: the network, a subscription, a timer, the DOM, a non-React widget. If no external system is involved, the logic belongs in render or in an event handler, and an effect only adds extra renders, stale frames and bugs.

## Step 1: do you need an effect?

| You want to… | Instead of an effect |
|---|---|
| Compute a value from props or state | Compute it during render (`useMemo` only if measured as expensive) |
| Reset all state when an ID prop changes | `key={id}` on the component (`react-reconciliation`) |
| Adjust one piece of state when a prop changes | Derive it, or store the ID of the selection instead of a copy of the object |
| Run logic because the user did something (submit, buy, send a toast) | Put it in the event handler |
| Tell the parent about a change | Call the parent's callback in the same handler that changes the state, or lift the state |
| Chain updates (A changes → effect sets B → effect sets C) | Compute B and C during render, or set them together in the handler |
| Subscribe to an external store or browser API | `useSyncExternalStore` |
| Initialize something once per app load | Module-level code, or a module-level "did init" flag |
| Fetch data | The framework loader or a data library; a raw effect only with cleanup (`react-data-fetching`) |

Two smells deserve special attention:

- **Effect chains.** Each link costs a render and briefly shows values that disagree with each other (a total that doesn't match its items). Replace the chain with plain computation in render.
- **`setState` called synchronously in an effect body** to mirror other state. The `react-hooks/set-state-in-effect` lint rule flags it; the fix is almost always deriving.

Before/after conversions: `examples/effects-you-dont-need.md`.

## Step 2: write the effect correctly

- **One effect per concern.** A subscription and an analytics call that change for different reasons go in separate effects with separate dependencies.
- **Dependencies describe the code; you don't choose them.** Every reactive value the effect reads (props, state, values derived from them, functions defined in the component) belongs in the array. When the list feels wrong, change the code, not the list:
  - **Move objects and functions inside the effect** if only the effect uses them, and depend on the primitive fields they're built from.
  - **Hoist constants** that don't depend on props or state to module scope.
  - **Use functional updates** (`setItems((prev) => …)`) so the effect doesn't read the state it sets.
  - **Use `useEffectEvent`** (React 19.2+) or the latest-ref pattern for values the effect reads but shouldn't re-run for (`react-refs-closures`).
  - **Memoize at the source** (`useMemo`, `useCallback` in the parent or hook) as the last resort.
- **Never silence `react-hooks/exhaustive-deps`.** A suppression usually hides a stale closure that shows up later as a "random" bug.

### Loops from unstable dependencies

An object, array or function created during render is new every render. As a dependency it re-runs the effect on every render, and if the effect sets state, it loops:

```tsx
// Loop: `query` is a new object each render → effect → setRows → render → new `query` → …
const query = { status, page };
useEffect(() => {
  fetchRows(query).then(setRows);
}, [query]);
```

A synchronous loop at least crashes with "Maximum update depth exceeded". An async one like this is silent: it sends requests forever. Depend on the primitives (`[status, page]`) and build the object inside the effect. More patterns: `examples/dependencies-and-loops.md`.

## Step 3: release everything you acquire

A cleanup runs before every re-run of its effect, and once more on unmount. Every effect that acquires something must return one that releases it:

| Acquired | Released by |
|---|---|
| `setTimeout`, `setInterval` | `clearTimeout`, `clearInterval` |
| `addEventListener` | `removeEventListener` with the **same function and the same `capture` flag**, or `{ signal }` and one `controller.abort()` |
| Store, emitter or SDK subscription | The unsubscribe function it returned |
| `WebSocket`, `EventSource`, `BroadcastChannel` | `close()` |
| `IntersectionObserver`, `ResizeObserver`, `MutationObserver` | `disconnect()` |
| `requestAnimationFrame`, `requestIdleCallback` | `cancelAnimationFrame`, `cancelIdleCallback` |
| `fetch` or other async work | `AbortController.abort()`, or an ignore flag |
| A `Worker` the component created | `terminate()` |
| Web Animations started in the effect | `animation.cancel()` |
| A third-party widget (map, editor, chart, player) | Its `destroy()`/`dispose()` method |
| `URL.createObjectURL(blob)` | `URL.revokeObjectURL(url)` |

- **StrictMode runs setup → cleanup → setup on mount in development.** If that double run causes a visible problem (two connections, doubled listeners), the cleanup is missing or incomplete. Fix the cleanup; don't add a "has run" ref.
- **Leaks grow with navigation.** A missing cleanup leaks once per mount: memory climbs as users open and close screens, and a handler fires N times after N visits.
- **Not every leak lives in an effect.** Module-level caches keyed by objects (use a `WeakMap` or a bounded cache), stores or event emitters that keep component callbacks, DOM nodes saved in module variables, and widgets created in handlers and never destroyed all outlive the component.

Diagnosis with heap snapshots, plus a full widget example: `examples/cleanup-and-leaks.md`.

## Purity: what React may run twice

React may call these more than once, discard the result, or replay them. StrictMode calls them twice in development to expose impurity:

- component bodies (render);
- state initializers (`useState(() => …)`, `useReducer`'s `init`);
- updater functions (`setItems((prev) => …)`);
- reducers;
- `useMemo` callbacks.

None of them may fetch, log analytics, start timers, write to refs or module variables, or mutate their inputs. An updater that pushes into `prev` adds the item twice in development and corrupts state in production. Side effects go in event handlers or effects.

## Timing

- `useEffect` runs after React commits. It usually runs after the browser paints, but effects caused by a discrete input (a click or key press) are flushed before the next paint. Don't rely on either for visual correctness.
- Measure-and-adjust work that must not flash belongs in `useLayoutEffect` (`react-layout-portals`).
- Effects don't run during server rendering.

## Review checklist

- [ ] Every effect synchronizes with an external system; derived values, resets and event logic don't use effects.
- [ ] No effect chains, and no synchronous `setState` mirroring other state.
- [ ] Dependency arrays are complete without suppressions; object and function dependencies are built inside the effect or stabilized at the source.
- [ ] Each effect releases what it acquires: timers, listeners (same function and capture flag), subscriptions, observers, sockets, workers, animations, widgets, object URLs, in-flight requests.
- [ ] Render, initializers, updaters and reducers are pure.
- [ ] Subscriptions to external stores use `useSyncExternalStore`.
- [ ] One-time app initialization isn't tied to a component's mount.

## Examples

- `examples/effects-you-dont-need.md`: a shipping calculator rebuilt without its effect chain, a selection that survives list changes, a parent notified from the handler, and an external store read with `useSyncExternalStore`.
- `examples/dependencies-and-loops.md`: object, array and function dependencies that loop or over-fire, with each fix, plus updaters that mutate state.
- `examples/cleanup-and-leaks.md`: a live dashboard widget that acquires a socket, an interval, an observer, a chart and object URLs, with complete cleanup, and finding leaks with heap snapshots.

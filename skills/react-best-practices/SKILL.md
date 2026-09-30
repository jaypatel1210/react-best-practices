---
name: react-best-practices
description: Senior-level React guidance for writing, reviewing, refactoring and debugging React components (React 18/19, Next.js, Vite, Remix, React Native). Use it whenever you write or modify React code (JSX/TSX, hooks, components), review a React PR or file, or investigate a React problem such as slow or laggy UI, too many re-renders, flicker, stale or lost state, list and key bugs, modal or tooltip z-index issues, data-fetching waterfalls or race conditions, crashes and blank screens. Provides the core rendering mental model, a symptom-to-fix map, default rules for new code and a code-review checklist, and routes to the focused react-* skills (rerenders, memoization, reconciliation, composition, context, refs-closures, layout-portals, data-fetching, error-handling) for depth.
license: MIT
---

# React Best Practices

Build React UIs that are fast by construction and correct under change. This entry skill holds the mental model and the rules that apply to almost every task. Load a focused skill (listed at the end) when a task needs depth; each has worked examples.

## Workflow

1. **Read the project context before writing code.** Check `package.json` and the build config for:
   - **React version.** 19 changes several idioms (`ref` as a prop, `<Context value>`, `use`, Actions). 19.2 adds `useEffectEvent` and `<Activity>`. See `references/modern-react.md`.
   - **React Compiler** (`babel-plugin-react-compiler`, `reactCompiler` in `next.config`, the compiler in a Vite/Babel config). When it is on, don't hand-write `useMemo`/`useCallback`/`memo` in new code.
   - **Rendering model.** Next.js App Router (Server Components, `"use client"` boundaries), Remix/React Router loaders, a client-only SPA, or React Native (no DOM, so skip CSS and portal advice).
   - **Libraries already in use** for data (TanStack Query, SWR, Apollo), state (Redux, Zustand, Jotai), and UI primitives (Radix, React Aria, MUI). Work with them rather than re-implementing what they do.
   - **Conventions** such as lint rules and design-system patterns. Follow the codebase's idioms unless they cause a bug.
2. **Classify the problem** with the symptom map below, then load the matching focused skill.
3. **Fix the cause rather than the symptom.** Structural fixes (where state lives, how components compose, what identity elements have) beat patches (`memo` everywhere, `z-index: 9999`, `setTimeout`).
4. **Verify.** For performance, measure before and after (the `react-rerenders` skill covers measuring). For behavior bugs, reproduce first, then confirm the fix, ideally with a test.
5. **Explain the fix in one or two sentences** in terms of the mental model, so the team can apply it elsewhere.

## The mental model

Almost every rule in these skills follows from these facts:

1. **A re-render starts only from a state change.** That means a `useState`/`useReducer` setter, a context value change, or an external-store subscription (Redux, Zustand, `useSyncExternalStore`). Props never trigger a re-render on their own; a parent re-rendering does.
2. **Re-rendering a component re-renders everything it renders.** The whole subtree runs again whether or not props changed. Re-renders flow down, never up.
3. **`<Child />` only creates an object (an element).** Creating it is nearly free. Rendering happens only when some component returns it. If a component returns the *same element object* as last time (for example, one it received through `children`), React skips that subtree.
4. **`memo(Component)` is what makes props matter.** The component is skipped when every prop is `Object.is`-equal to last time. One unstable prop (an inline object, array, function, or JSX, including `children`) and it re-renders anyway.
5. **Identity is position + type (+ key).** Same type in the same place means the same instance, and state is kept. A different type or key destroys the old instance (state, DOM, effects) and mounts a new one.
6. **Every function created during render closes over that render's props and state.** This covers handlers, effect bodies, `useCallback`/`useMemo` callbacks, and functions stored in refs. Caching a function without refreshing it produces a *stale closure*.
7. **Refs are mutable boxes that survive re-renders and never cause one.** Read and write them in effects and event handlers, not during render.
8. **`useEffect` usually runs after the browser paints; `useLayoutEffect` runs before paint and blocks it.** Neither runs during server rendering.
9. **Every context consumer re-renders when the provider's `value` changes identity.** This happens even when it reads only an unchanged part of the value.
10. **Error boundaries catch errors thrown while rendering, in lifecycle methods and in effects of their descendants.** They do not catch errors from event handlers or async callbacks.
11. **A portal moves DOM nodes, not the React tree.** Context, state and synthetic events follow the React tree. CSS, native DOM events and form submission follow the DOM.

## Symptom map

| Symptom | Likely cause | Load |
|---|---|---|
| Typing, scrolling, dragging, or opening a dialog feels laggy | State high in the tree re-renders heavy siblings; state hidden in a custom hook re-renders its host | `react-rerenders` |
| `memo`/`useMemo`/`useCallback` everywhere but still slow; a memoized child still re-renders | Unstable props: inline objects, JSX children, spread props, unstable hook return values | `react-memoization` |
| Input keeps old text after switching to another item; state "leaks" between items | Same component type at the same position is reused | `react-reconciliation` |
| Input loses focus on every keystroke; a subtree flickers or remounts each render | Component or HOC result created inside another component; unstable `key` | `react-reconciliation` |
| List rows show the wrong data or state after sort, insert or delete | Index or unstable keys | `react-reconciliation` |
| Component keeps growing configuration props (`iconName`, `iconColor`, `showX`) | Configuration where composition fits better | `react-composition` |
| One context update re-renders half the app | Unmemoized provider value; state and actions mixed in one context | `react-context` |
| Callback, interval, subscription or memoized child sees old props or state | Stale closure | `react-refs-closures` |
| Debounce fires for every keystroke, just later | Debounced function re-created on each render | `react-refs-closures` |
| Parent needs `focus()`, `scrollTo()` or `open()` on a child | Imperative API through refs | `react-refs-closures` |
| UI flashes or jumps right after mount; layout depends on measured size | `useEffect` where `useLayoutEffect` is needed; SSR first paint | `react-layout-portals` |
| Modal or tooltip clipped, off-center, or under the header despite a huge z-index | Stacking-context or containing-block trap | `react-layout-portals` |
| Page reveals nested spinners one after another | Request waterfall | `react-data-fetching` |
| Wrong content flashes after fast navigation or typing | Race between requests | `react-data-fetching` |
| One error blanks the whole app; async errors vanish silently | Missing error boundaries; async errors not surfaced | `react-error-handling` |

## Defaults for new code

Apply these without being asked whenever you write React code. Each focused skill explains the reasoning and the exceptions.

- **Colocate state; keep fast-changing state in leaves.** Put state in the lowest component that needs it. Isolate high-frequency state (input text, scroll or pointer position, timers, animation progress, window size) in small components so heavy siblings don't re-render. → `react-rerenders`
- **Wrap, don't own.** When a stateful component must surround heavy content, accept that content as `children` or an element prop instead of rendering it directly. → `react-rerenders`
- **Know what your hooks hold.** State inside a custom hook re-renders whichever component calls it, even if the value is never used. Store coarse values (a breakpoint name, not the raw pixel width). → `react-rerenders`
- **Derive during render.** Don't copy props or computed values into state and sync them with an effect.
- **Define components at module scope.** Never define them inside another component's body, and never create HOC-wrapped components during render. → `react-reconciliation`
- **Take keys from data identity.** Use stable IDs for dynamic lists. Index keys are acceptable only for static, stateless lists, and random keys never are. Use `key` deliberately to reset a subtree. → `react-reconciliation`
- **Memoize for a reason, not by default.** Legitimate reasons: the value is a prop of a `memo` component, a hook dependency (here or downstream), a context value, or a measured expensive computation. Follow an explicit codebase convention if one exists; with React Compiler, don't hand-memoize. → `react-memoization`
- **Memoize context values; split state and actions into separate contexts** when their consumers differ. → `react-context`
- **Give callbacks a stable identity that still reads fresh state** with the latest-ref pattern, or with `useEffectEvent` for effect-only logic on React 19.2+. Don't silence the hooks lint rule. → `react-refs-closures`
- **Create debounced and throttled functions once per component instance**, and have them call the latest callback. Keep the input's own state update immediate. → `react-refs-closures`
- **Give every effect that fetches a cleanup** (abort or ignore stale results). Start independent requests in parallel, and prefer the project's data library or framework loader. → `react-data-fetching`
- **Render overlays through a portal or the native top layer** (`<dialog>`, `popover`). Reuse the codebase's overlay primitives when they exist. → `react-layout-portals`
- **Use `useLayoutEffect` for measure-then-adjust layout**, with an SSR-safe first render. → `react-layout-portals`
- **Place error boundaries at the root and around independent regions**, and handle async and event-handler errors explicitly. → `react-error-handling`

## Reviewing React code

When asked to review, audit or sanity-check React code, work through `references/review-checklist.md`. For the expected output shape, see `examples/code-review-walkthrough.md`.

- Report findings ordered by impact. Give each one a location, a concrete failure scenario ("type in the filter → the chart re-renders on every keystroke"), and the fix.
- Separate **bugs** (wrong behavior, lost data, crashes) from **performance** (cost on a hot path) from **maintainability**. Skip style nits unless asked.
- Report only rules that are actually violated. If the code is fine, say so.

## Performance priorities

Tackle performance in this order, stopping when the problem is gone:

1. **Measure** on a production build with CPU throttling, and find which interaction is slow and which components render.
2. **Restructure**: move state down, pass children, split contexts, fix keys, fix remounts.
3. **Do less work**: virtualize long lists, defer non-urgent rendering with `useDeferredValue` or `startTransition`, lazy-load heavy parts.
4. **Memoize precisely** where a measured hot path remains, or rely on React Compiler.

Memoization is last because it is the easiest to break silently and the hardest to maintain.

## Focused skills

| Skill | Covers |
|---|---|
| `react-rerenders` | Re-render model, moving state down, children/element props for performance, state hidden in hooks, deriving state, measuring |
| `react-memoization` | When `memo`/`useMemo`/`useCallback` help, how they break, lists, expensive calculations, React Compiler |
| `react-reconciliation` | Type/position/key identity, list keys, state reset with `key`, components defined inside components, conditional wrappers |
| `react-composition` | Children, slots (elements as props), render props, `cloneElement`, compound components, HOCs, hooks; API design |
| `react-context` | Provider patterns, memoized values, state/actions split, reducers, selector patterns, external stores |
| `react-refs-closures` | Refs vs state, DOM refs, imperative handles, stale closures, latest-ref pattern, debounce/throttle (tested hooks included) |
| `react-layout-portals` | `useLayoutEffect` and flicker, SSR-safe measurement, stacking contexts, portals, overlays |
| `react-data-fetching` | Loading sequence design, waterfalls, parallel requests, data providers, prefetching, libraries, Suspense, race conditions |
| `react-error-handling` | Error boundary placement, what boundaries miss, async errors, reset/retry, reporting (tested boundary included) |

If a focused skill isn't installed, the rules in this file and `references/review-checklist.md` still cover the essentials.

## References

- `references/review-checklist.md`: the full review checklist, grouped by area, with severities.
- `references/modern-react.md`: React 18 → 19 → 19.2 changes, React Compiler, Server Components, and how each changes the advice.
- `examples/code-review-walkthrough.md`: a realistic component reviewed end to end, showing the expected output format.

Code examples in these skills use TypeScript. For JavaScript projects, drop the type annotations.

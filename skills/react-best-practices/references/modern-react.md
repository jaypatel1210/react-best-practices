# Modern React: What Changed and How It Affects the Advice

Check the project's React version (`package.json`, lockfile) and build setup before applying version-specific idioms. When a project is on an older version, use the older idiom rather than upgrading React as a side effect.

## Contents

1. [React 18](#react-18)
2. [React 19](#react-19)
3. [React 19.2](#react-192)
4. [React 19.3](#react-193)
5. [React Compiler](#react-compiler)
6. [Server Components](#server-components)
7. [Quick translation table](#quick-translation-table)

## React 18

- **Automatic batching**: state updates inside promises, timeouts and native handlers are batched like those in React event handlers. Several `setState` calls in one tick cause one render. It requires `createRoot`; apps still on `ReactDOM.render` keep React 17 behavior. Under `createRoot`, `unstable_batchedUpdates` wrappers are redundant.
- **Concurrent features**: `startTransition`/`useTransition` mark updates as non-urgent, and `useDeferredValue` lets a value lag behind during heavy renders. These are the tools for "typing is slow because the list is expensive" (`react-rerenders`).
- **StrictMode in development** simulates an unmount and remount on mount (keeping state and DOM), so effects run setup → cleanup → setup. It exposes missing cleanups (fetch races, subscriptions, timers). Don't work around it with "has run" refs.
- **New hooks**: `useId` (stable IDs that match between server and client), `useSyncExternalStore` (subscribing to external stores, the basis for selector-based state libraries), `useInsertionEffect` (for CSS-in-JS libraries, and useful for keeping a latest-callback ref updated early).
- The warning "Can't perform a React state update on an unmounted component" was removed. Its absence doesn't mean late responses are harmless: stale responses on a *still-mounted* component are the real race-condition bug.

## React 19

- **`ref` is a regular prop for function components.** `forwardRef` isn't needed in new code, and is expected to be deprecated eventually. Read `ref` from props and pass it to the element. On React 18, keep using `forwardRef`.
- **Ref callbacks can return a cleanup function**, called when the element detaches. Prefer it over handling `null` in the callback.
- **Context as a provider**: `<ThemeContext value={theme}>` works directly. `<ThemeContext.Provider>` still works.
- **`use(resource)`** reads a context or a promise. `use(Context)` behaves like `useContext`, but may be called conditionally. `use(promise)` suspends until the promise resolves, but the promise must come from outside render (a cache, a loader, or a Server Component). A promise created during a Client Component's render is new every time.
- **`use` can't be called inside `try/catch`.** A rejected promise read with `use` goes to the nearest error boundary instead.
- **Actions**: async functions passed to `startTransition`, plus `useActionState`, `useOptimistic`, `useFormStatus` and `<form action={fn}>`.
  - Errors thrown in an action run with `useTransition`'s `startTransition` propagate to the nearest error boundary, so handle expected failures inside the action.
  - With the standalone `startTransition`, React reports the error with `window.reportError` instead.
  - State updates after an `await` inside an action need their own `startTransition` wrapper to stay part of the transition.
- **Error reporting**: React no longer re-throws errors. Uncaught errors go to `window.reportError`, and caught ones to `console.error`. `createRoot`/`hydrateRoot` accept `onCaughtError`, `onUncaughtError` and `onRecoverableError` for centralized reporting. Error boundaries are still class components.
- **Suspense pre-warming**: when a component suspends, React commits the nearest fallback immediately and pre-renders the suspended siblings afterwards. Data fetched *inside* those children therefore starts later than you might expect. Start requests before rendering (loaders, prefetching) so Suspense doesn't turn into a waterfall.
- **Removed legacy APIs**: string refs, `propTypes`, `defaultProps` on function components (use default parameters), legacy context, and `ReactDOM.render`/`hydrate`/`findDOMNode`/`unmountComponentAtNode`. `forwardRef` is listed among the legacy APIs.
- **TypeScript**: `useRef` requires an argument (`useRef<HTMLDivElement>(null)`), and a ref callback must not implicitly return a value (use a block body).
- **StrictMode** also double-invokes ref callbacks on mount, and reuses the first-render result of `useMemo`/`useCallback` during the double render.
- **Better hydration errors**: mismatches report a diff. Fix the cause (render-time `window` checks, dates, random values) rather than suppressing the warning.
- **`useDeferredValue(value, initialValue)`** accepts an initial value, which is useful for showing a cheap first render.
- **Document metadata and resources**: `<title>`, `<meta>` and `<link>` rendered anywhere are hoisted into `<head>` (stylesheets need a `precedence` prop), and `react-dom` exports `preconnect`, `prefetchDNS`, `preload`, `preloadModule`, `preinit` and `preinitModule` for resource hints that dedupe and stream early (`react-loading-performance`).

## React 19.2

- **`useEffectEvent`**: a function that always sees the latest props and state and is excluded from effect dependencies.
  - Call it only from inside effects (`useEffect`, `useLayoutEffect`, `useInsertionEffect`), including callbacks those effects register, or from other Effect Events.
  - Don't pass it to child components or hooks, and don't call it during render. Its identity intentionally changes on every render, and the hooks lint rules flag misuse.
  - For stable callbacks passed as props, use the latest-ref pattern (`react-refs-closures`).
- **`<Activity mode="visible" | "hidden">`**: keeps a hidden subtree's state and DOM while hiding it. Its effects are cleaned up while hidden and re-created when it becomes visible. Use it for tabs or panels that should keep their state without staying active (`react-reconciliation`).
- **Performance tracks** in Chrome DevTools' Performance panel show React scheduler and component work alongside browser activity, in development and profiling builds (`react-rerenders/references/measuring.md`).

## React 19.3

- **`<ViewTransition>`** (with `addTransitionType`) for animating between UI states with the browser's View Transitions API, and **Fragment refs**, are stable. A `<ViewTransition>` animates only for updates in `startTransition`, `useDeferredValue`, Actions or Suspense reveals; urgent updates commit without animation. Patterns and the `flushSync` fallback for older versions: `react-animation`.
- Check the release notes before relying on newer APIs, and follow the version in the project's lockfile.

## React Compiler

A build-time plugin that memoizes components and hooks automatically. It's stable, can be adopted incrementally, and supports React 17 and 18 through a runtime package and target option.

- **With the compiler on**: don't hand-write `useMemo`/`useCallback`/`memo` in new code. Keep existing memoization unless removing it is the task. Fix Rules of React violations, which make the compiler skip a component.
- **Unchanged by the compiler**: what re-renders when state changes, context semantics, identity and keys, closures, effects, data fetching.
- Details: `react-memoization/references/react-compiler.md`.

## Server Components

In frameworks with Server Components (such as the Next.js App Router):

- **Data fetching moves to the server**, which removes the client-side "JS → render → effect → fetch" waterfall. Start independent requests before awaiting them, and stream slow parts behind `<Suspense>` (`react-data-fetching`).
- **Client Components (`"use client"`) are the interactive leaves.** Keep that boundary low, and keep state in the smallest client component that needs it. This is the same colocation rule as "move state down".
- **Server Components can be passed as `children` to Client Components.** This is "wrap, don't own" at the architecture level: a client wrapper (a scroll container, tabs, a modal) can host server-rendered content without turning it into client code or re-rendering it.
- **Context, state, effects and refs exist only in Client Components.** Put providers in a client component near the root and render server content inside them through `children`.
- **Server Components are not SSR.** SSR still ships a component's code and hydrates it; a Server Component ships no component code and never hydrates or re-renders on the client. Everything imported from a `"use client"` module becomes client code, so a Client Component can't import a Server Component; it receives server content through `children` or props.
- **Guard server-only modules** with `import 'server-only'`, so importing one from client code fails the build instead of leaking secrets.
- **Server Functions** (`"use server"`, formerly called Server Actions) are public HTTP endpoints. Validate input and check authorization inside each one, whatever the calling component checks.

## Quick translation table

| Task | React 18 | React 19+ |
|---|---|---|
| Accept a ref in a function component | `forwardRef((props, ref) => …)` | `function C({ ref, ...props })` |
| Provide context | `<Ctx.Provider value={v}>` | `<Ctx value={v}>` (`.Provider` still works) |
| Read context conditionally | Not allowed with `useContext` | `use(Ctx)` |
| Read the latest props in an effect without re-running it | Latest-ref pattern | `useEffectEvent` (19.2+) |
| Keep hidden UI's state without it running | CSS hiding, or lift state | `<Activity mode="hidden">` (19.2+) |
| Report all render errors centrally | Boundary `componentDidCatch` | Root `onCaughtError` / `onUncaughtError` (plus boundaries) |
| Memoization | Manual (see rules) | Manual, or React Compiler |

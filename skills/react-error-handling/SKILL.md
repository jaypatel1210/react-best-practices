---
name: react-error-handling
description: Make React apps resilient to errors, covering where to place error boundaries, what they do and do not catch, handling errors from event handlers, effects, promises and fetch, re-throwing async errors into the nearest boundary, retry and reset, and error reporting. Use when adding error boundaries or fallback UI, when one failing widget blanks the whole page, when errors are silently swallowed, when integrating Sentry or other logging, or when choosing between try/catch, react-error-boundary and framework error files. Includes a tested ErrorBoundary and a useThrowToBoundary hook.
license: MIT
---

# Error Handling in React

Every app ships bugs. The goal is to keep a failure **local**: the broken widget shows a helpful fallback, the rest of the page keeps working, the error gets reported, and the user can retry.

## Why it matters

An error thrown during rendering that no error boundary catches unmounts the **entire** React root, and users get a blank page. One bad API response in a sidebar widget, or a bug in a third-party component, can take down the whole app. Error boundaries are the only way to contain render-time errors.

## What catches what

| Where the error is thrown | Caught by an error boundary? | Handle it with |
|---|---|---|
| Rendering (component body, JSX evaluation) | Yes | A boundary |
| Lifecycle methods, and effect callbacks (`useEffect`/`useLayoutEffect`) | Yes | A boundary |
| Event handlers (`onClick`, `onSubmit`, …) | No | `try/catch`, then local error UI or re-throw into the boundary |
| Async code: promise callbacks, `await` after the effect returned, `setTimeout`, subscriptions | No | `.catch`/`try/catch`, then local UI or re-throw |
| A rejected promise read with `use(promise)` (React 19) | Yes | A boundary (next to the `<Suspense>` that handles loading) |
| Actions run with `startTransition` from `useTransition` (React 19) | Yes, the thrown error or rejected promise reaches the nearest boundary | A boundary, or catch expected failures inside the action |
| The standalone `startTransition` (imported from `react`) | No, React reports it with `window.reportError` | Catch inside the action |
| Server rendering | No, it's handled by the server/framework | Framework error handling |
| The boundary's own render | No, it goes to the next boundary up | Nest boundaries |

## Placement strategy

- **Root boundary**: always. It shows a full-page fallback ("Something went wrong", reload, support link) and reports the error.
- **Route or page boundaries**: a failing page keeps the app shell (navigation, header) usable. In frameworks these are built in: Next.js `error.tsx` per route segment plus `global-error.tsx`; React Router and Remix route `ErrorBoundary`/`errorElement`.
- **Region boundaries around independent widgets**: dashboards' cards, charts, feeds, comment sections, third-party embeds, rich editors, anything rendering untrusted or unusual data. The fallback should fit the region's size ("Couldn't load revenue chart. Retry").
- **Not around every component.** Too many boundaries fragment the UI into half-broken pieces and duplicate fallback code. Put them where a user would say "this part is broken, but the rest works".

## Implementing boundaries

Error boundaries must be class components; React doesn't offer a hook for creating one. Options:

- **`react-error-boundary`**, a widely used library: `<ErrorBoundary FallbackComponent onError resetKeys>` plus `useErrorBoundary()` → `showBoundary(error)`.
- **`assets/error-boundary.tsx`**, a dependency-free, tested implementation with `fallback`, `fallbackRender({ error, resetErrorBoundary })`, `onError`, `onReset` and `resetKeys`, plus `useThrowToBoundary()`.

A good boundary does four things:

1. **Renders a fallback that fits** the region and explains what happened in user terms, not a stack trace.
2. **Reports** via `componentDidCatch`/`onError` (`error`, `info.componentStack`) to Sentry, Datadog or your logger. React 19 doesn't re-throw errors anymore: uncaught ones go to `window.reportError`, and caught ones to `console.error`. Wire `createRoot(el, { onCaughtError, onUncaughtError, onRecoverableError })` into your reporting so nothing depends on console output.
3. **Offers recovery**: a retry button that resets the boundary (and refetches or clears the failing cache entry first), or `resetKeys` that reset it automatically when the route or entity changes.
4. **Doesn't retry blindly.** Resetting straight back into the same error loops. Reset after the cause can plausibly have changed: user intent, new data, a new route.

## Errors boundaries can't see

**Event handlers**: handle the error where it happens.

```tsx
const onExport = async () => {
  try {
    await exportReport(reportId);
    toast.success('Export started');
  } catch (err) {
    report(err);
    toast.error('Export failed. Please try again.'); // expected, recoverable → local UI
  }
};
```

**Unexpected async errors** that should show the region's fallback: re-throw them into React's render cycle, and the nearest boundary catches them.

```tsx
const throwToBoundary = useThrowToBoundary(); // assets/error-boundary.tsx
useEffect(() => {
  loadWidgetConfig(widgetId).then(setConfig).catch(throwToBoundary);
}, [widgetId, throwToBoundary]);
```

It works because a state updater function runs during React's render of that component. Throwing inside it is a render error, which boundaries catch. `react-error-boundary`'s `showBoundary(error)` does the same thing.

**Data libraries** can route errors to boundaries for you: TanStack Query `throwOnError` or `useSuspenseQuery`; SWR `suspense: true`.

**Global safety net**: `window.addEventListener('unhandledrejection', …)` and `'error'` listeners, or your monitoring SDK's defaults, catch anything that slipped through. They're a last line for reporting, not a UI strategy.

## Pitfalls

- **`try/catch` around JSX or hooks doesn't work.** `try { return <Child /> } catch {}` creates an element; `Child` renders later, outside the `try`. Wrapping `useEffect(...)` in `try` doesn't catch errors inside the effect either. Put `try/catch` *inside* effects and handlers, and use boundaries for render errors.
- **`setState` inside a `catch` in the render body** loops forever, because setting state during render re-renders, which throws again. Let a boundary handle it, or return fallback UI directly.
- **Fetch errors are values, not exceptions.** `fetch` resolves on 404/500. Check `res.ok` and throw, or the "error" renders as empty data.
- **Swallowed errors**: `catch {}` or `catch (e) { console.log(e) }` with no UI and no reporting. Every catch should either recover, show something, or report (usually two of the three).
- **Leaking internals**: never render raw `error.message` from servers or stack traces to users. Show a friendly message, and send details to logging.
- **Resetting without fixing**: a retry that re-renders the same failing input with the same cached data fails again. Invalidate the cache or refetch in `onReset`.

## Checklist

- [ ] A root boundary with reporting and a reload option.
- [ ] Route or page boundaries (framework error files where available).
- [ ] Boundaries around independent, risky regions, with fallbacks sized to fit.
- [ ] Event-handler and async errors are either handled locally (expected errors) or re-thrown to a boundary (unexpected ones).
- [ ] `res.ok` checked on every fetch.
- [ ] Recovery: `resetKeys` or a retry that also refetches or clears the failing data.
- [ ] No raw error details shown to users; all errors reported with component stacks.

## Examples

- `examples/boundary-placement.md`: a dashboard with root, route and widget boundaries, retry with refetch, `resetKeys` on navigation, and reporting.
- `examples/async-and-event-errors.md`: handler errors with local UI, promise errors re-thrown to a boundary, callback wrappers, and TanStack Query integration.

## Assets

- `assets/error-boundary.tsx`: `ErrorBoundary` (`fallback`, `fallbackRender`, `onError`, `onReset`, `resetKeys`) and `useThrowToBoundary()`. Copy it into the project (for example `src/components/error-boundary.tsx`). It needs React 18+, has no dependencies, and is covered by the repository's `tests/`.

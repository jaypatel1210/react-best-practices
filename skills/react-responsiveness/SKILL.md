---
name: react-responsiveness
description: Keep React apps responsive to input (good INP) by keeping the main thread free, covering how long tasks delay clicks and typing, marking non-urgent updates with useTransition, startTransition and useDeferredValue, keeping the current screen instead of Suspense fallbacks during navigation, automatic batching and flushSync, breaking up long JavaScript tasks with scheduler.yield and fallbacks, coalescing continuous events into one update per animation frame, deferring background work to idle time, moving heavy computation into Web Workers, and passive or delegated event listeners. Use when clicks, typing, tab switches or drags feel delayed or freeze the page, when INP or long tasks are reported, when processing large data on the client, when pointer, scroll or resize handlers are janky, or when choosing between debouncing, transitions, chunking and workers. Includes tested frame-throttling and task-yielding helpers.
license: MIT
---

# Responsiveness: Fast Feedback for Every Interaction

JavaScript, React rendering, style, layout and paint share one main thread. While a task runs, clicks and keystrokes wait in line. Any task over 50 ms is a *long task*, and users start noticing delays around 100 ms. Interaction to Next Paint (INP) should stay at or below 200 ms at the 75th percentile.

## Where interaction time goes

An interaction's latency has three parts. Find the big one before fixing anything:

1. **Input delay**: the main thread is busy with *other* work when the user acts (hydration, timers, third-party scripts, a big effect). Break that work up, defer it, or move it off the thread.
2. **Processing**: your event handlers, plus the React render and commit they trigger. Keep the urgent update small, mark the rest non-urgent, and move heavy computation out.
3. **Presentation delay**: style, layout and paint of the result. A huge DOM (`react-large-lists`) or forced layout (`react-animation`) makes this part long.

Record the interaction in the DevTools Performance panel with CPU throttling. For field data, the `web-vitals` attribution build breaks INP into these three parts and names the slow element (`react-loading-performance/references/core-web-vitals.md`).

## Pick the tool

| What blocks | Tool |
|---|---|
| A state update re-renders a large subtree, so typing or clicking stalls | `useTransition` / `startTransition` or `useDeferredValue`: React renders it interruptibly |
| A navigation or tab switch replaces the screen with a Suspense fallback | Run the navigation in a transition |
| One JavaScript computation takes more than 50 ms (parsing, sorting, diffing, filtering tens of thousands of items) | Chunk it and yield, or move it to a Web Worker |
| Continuous events (pointer, scroll, resize) update visuals | One update per animation frame, or no React render at all (refs, CSS) |
| Work nobody is waiting for (analytics, prefetching, cache warming) | Idle time |
| One request per keystroke | Debounce (`react-refs-closures`) |

## Transitions and deferred values

- **Urgent updates** (typing, clicking, pressing) render without interruption. **Transition updates** render in the background: React yields to the browser every few milliseconds and throws the work away if newer input arrives.
- **`useTransition`** returns `[isPending, startTransition]`. Wrap the *expensive* update, and use `isPending` for quiet feedback (dim the old content, a spinner in the tab).
- **`useDeferredValue(value)`** gives a copy of a value that lags behind during heavy renders. Use it when you don't own the setter, or want one state for both the input and the expensive consumer. Worked example: `react-rerenders/examples/unavoidable-heavy-renders.md`.
- **Never put a controlled input's own value in a transition.** The field would lag and drop characters. Update the input urgently, and the expensive consumer through a transition or a deferred value.
- **The expensive part must be skippable.** The deferred render only helps if the heavy component is `memo`-wrapped (or compiled by React Compiler) and its props are stable, so the urgent render can skip it.
- **Transitions interrupt between components, not inside one.** A single component that computes for 300 ms, or a slow event handler, still blocks. Split the component, memoize the computation, or move it out (chunks or a worker).
- **They don't reduce requests.** A transition is not a debounce.
- **Keep the current screen instead of a fallback.** When an update inside a transition suspends, React keeps showing the already-visible content (with `isPending` set) rather than replacing it with the nearest Suspense fallback. Routers run navigations this way. Boundaries that appear for the first time still show their fallback.

```tsx
function ReportTabs() {
  const [tab, setTab] = useState<Tab>('summary');
  const [isPending, startTransition] = useTransition();
  return (
    <>
      <TabBar
        value={tab}
        onChange={(next) => startTransition(() => setTab(next))} // keep the old tab until the new one is ready
      />
      <div className="report-body" aria-busy={isPending}>
        <Suspense fallback={<ReportSkeleton />}>
          <ReportPanel tab={tab} />
        </Suspense>
      </div>
    </>
  );
}
```

React 19 accepts async functions in `startTransition` (Actions). State updates after an `await` inside one need their own `startTransition` wrapper (`react-best-practices/references/modern-react.md`).

## Batching and `flushSync`

- **React 18+ batches every state update made in the same task**, in handlers, timeouts, promises and native listeners alike, into one render (with `createRoot`; legacy `ReactDOM.render` roots batch only inside React events). Updates on either side of an `await` may render separately, so don't rely on batching across one.
- **Updates from discrete input (clicks, key presses) render synchronously** before the next paint, unless they're in a transition. A slow click handler plus a big synchronous re-render is the classic poor-INP click.
- **`flushSync(() => setState(x))` forces an immediate render and commit.** Use it only when code must see the updated DOM right away: scrolling to or focusing an item you just added, measuring it, or an API that needs the DOM changed inside its callback (`document.startViewTransition`, printing). It's costly and defeats batching. It can also force already-visible content back to a Suspense fallback, and may run pending effects first. Called during render or inside an effect, it warns and doesn't flush.

## Break up long tasks

- **Yield inside long loops** with `yieldToMain()` from `assets/yield-to-main.ts`. It uses `scheduler.yield()` where supported (Chromium 129+, Firefox 142+), whose continuation runs ahead of other tasks of the same priority, and a fresh task elsewhere (Safari).
- **`runInChunks(items, work, { budgetMs, signal })`** from the same file processes a collection in short slices and stops when its `AbortSignal` fires.
- **In components, run chunked work from an event handler or effect,** abort it on unmount or when its inputs change, and set state once with the result (or in a few progress steps, not per item).
- **Let feedback paint before unavoidable work.** Setting "Processing…" and then running a 500 ms loop in the same task shows nothing: the browser paints only after the task ends, and `flushSync` updates the DOM without painting it. Start the work in a later task (yield first, `requestAnimationFrame(() => setTimeout(run))`), then chunk it or send it to a worker.
- **Yield only at safe points.** Between chunks, other code, including React renders, can run and change state. Don't yield in the middle of work that must be consistent.
- `navigator.scheduling.isInputPending()` is Chromium-only and no longer recommended; yield on a time budget instead.

## One update per frame

- **Browsers usually deliver `pointermove`, `scroll`, `resize` and `wheel` at most once per frame** (extra pointer samples are available through `getCoalescedEvents()`). Coalescing still pays off when several listeners or sources update the same thing, when a handler reads layout or does real work, and to run that work right before paint.
- **Coalesce them** with `useFrameThrottledCallback` from `assets/use-frame-throttled-callback.ts`: the latest call runs once, just before the next paint. Pass plain values (coordinates, sizes), not the event object.
- **Better still, keep per-frame visuals out of React.** Write `transform` or a CSS variable through a ref during the gesture, and commit the final value to state on `pointerup`. See `examples/frame-aligned-updates.md`.
- **Animation frames pause in background tabs.** Don't use them for timers or non-visual work.

## Idle time

- **`requestIdleCallback(fn, { timeout })`** runs `fn` when the browser has nothing else to do. Pass a `timeout` so it eventually runs on busy pages, and work in slices while `deadline.timeRemaining()` (never more than 50 ms) leaves a margin. When `deadline.didTimeout` is true, `timeRemaining()` is 0: do one small unit and reschedule.
- **Good fits:** batching analytics, prefetching likely-next routes or data, warming caches, non-critical initialization after load.
- **Not for visible updates, and not for work the user is waiting on.** Idle callbacks can run late or never. Avoid layout reads and DOM writes in them; DOM writes belong in `requestAnimationFrame`.
- **Safari doesn't ship it** enabled, so fall back to `setTimeout`. Cancel pending callbacks with `cancelIdleCallback` on unmount.

## Web Workers

- **Use a worker** for CPU-heavy work that doesn't need the DOM: parsing large files, building search indexes, aggregating big datasets, diffing, image processing, syntax highlighting.
- **Create it once** (module scope, or lazily by its owner), not per render, and terminate it when its owner unmounts. Bundlers understand `new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })`.
- **Messages are copied** (structured clone) on both sides. Transfer `ArrayBuffer`s (`postMessage(buffer, [buffer])`), keep large data inside the worker, and return only what the UI renders.
- **Treat responses like fetches:** ignore stale results (tag requests with an ID), and listen for the Worker's `error` event; a `try/catch` around `postMessage` never sees errors thrown inside it.
- **A busy worker can't hear "cancel".** Messages queue until its current job ends, so `worker.terminate()` is the only hard stop. Add a watchdog for jobs that can run away.
- **Workers aren't free:** startup takes tens of milliseconds and memory. Work under ~16 ms usually belongs on the main thread.

Full walkthrough: `examples/long-tasks-and-workers.md`.

## Event listeners

- **React already delegates.** For events that bubble, it attaches one listener per event type at the root, so an `onClick` per row costs a closure, not a DOM listener. (Non-bubbling events such as `scroll` and media events are attached to the element.) That closure matters only when rows are `memo`-wrapped: pass one stable handler that takes the row ID, or read `data-id` from `event.target.closest('[data-id]')` in a single handler on the list.
- **Native listeners on many elements** (non-React code, third-party widgets) should be delegated to a container, too.
- **React registers `touchstart`, `touchmove` and `wheel` as passive**, so `event.preventDefault()` in `onWheel` or `onTouchMove` doesn't stop scrolling. When you must cancel scrolling, add a native listener with `{ passive: false }` through a ref, and keep it cheap.
- **Remove native listeners on unmount.** One `AbortController` can remove several at once: `addEventListener(type, fn, { signal })`.

## Review checklist

- [ ] Expensive re-renders triggered by input run in a transition or read a deferred value, the heavy consumer is memoized, and no controlled input's value is updated inside `startTransition`.
- [ ] Navigations and tab switches that can suspend run in transitions.
- [ ] No synchronous JavaScript over ~50 ms in handlers, effects or render: it's chunked with yields or runs in a worker.
- [ ] Continuous-event handlers update at most once per frame, or write styles directly and commit on gesture end.
- [ ] `flushSync` appears only where the updated DOM must be read or handed to an API immediately.
- [ ] Workers are created once, keep or transfer large data, ignore stale responses and are terminated by their owner.
- [ ] Idle callbacks have a timeout and a Safari fallback; native listeners are removed on unmount.

## Examples

- `examples/transitions-and-suspense.md`: a report viewer with tab switches that keep the old content, urgent versus transition state for controls, a deferred "group by" over an expensive table, and deferred search over suspending results.
- `examples/long-tasks-and-workers.md`: importing a 60,000-row CSV, first chunked with yields and coarse progress, then moved into a worker with transferred buffers, cancellation, a watchdog and stale-result guards.
- `examples/frame-aligned-updates.md`: a draggable playhead that writes styles through a ref every frame and commits on release, one canvas redraw per frame from several event sources, and idle-time analytics with a Safari fallback.

## Assets

| File | API |
|---|---|
| `assets/use-frame-throttled-callback.ts` | `useFrameThrottledCallback(fn)` returns a stable function that runs the latest `fn` at most once per animation frame, with `.cancel()`, `.flush()`, `.isPending()` |
| `assets/yield-to-main.ts` | `yieldToMain()` yields to the browser; `runInChunks(items, work, { budgetMs, signal })` processes a collection in short tasks |

Both are typed and dependency-free, and are covered by the repository's `tests/`. The hook requires React 18+ and passes the React Compiler lint rules.

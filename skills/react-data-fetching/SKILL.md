---
name: react-data-fetching
description: Fetch data in React without waterfalls or race conditions, covering designing the loading sequence, starting requests in parallel, lifting fetches or using data providers, prefetching, choosing between raw fetch, TanStack Query, SWR, framework loaders and Server Components, Suspense, cancelling with AbortController, and ignoring stale responses. Use when writing or reviewing useEffect data fetching, when a page loads slowly with nested spinners, when content flashes or shows the wrong item after fast navigation or typing, or when handling loading and error states for requests.
license: MIT
---

# Data Fetching: Waterfalls, Parallelism and Race Conditions

Fast re-renders can't save a page whose data arrives late, or out of order. Most fetching problems come from *when* requests start and *which* response wins, not from the library used.

## Choose the layer first

1. **Framework data loading** for route-level data: Server Components in the Next.js App Router, Remix or React Router loaders, TanStack Router loaders. Requests start before or outside rendering, often in parallel, and often on the server.
2. **A client data library** for anything beyond "fetch once": TanStack Query, SWR, RTK Query, or Apollo/Relay/urql for GraphQL. These provide caching, deduplication, retries, cancellation, background refresh and pagination.
3. **Raw `fetch` in effects** only for simple one-off cases, or when the project deliberately avoids dependencies.

The fundamentals below apply to all three. No library prevents a waterfall that the component structure creates.

## Design the loading sequence before coding

- **Decide the order of arrival**: what the user must see first (the primary content), what can arrive later, and what each placeholder looks like.
- **Reveal in reading order** (top-left to bottom-right), and reserve space with correctly sized skeletons so content doesn't shift.
- **Avoid "popcorn" loading**, where many independent spinners resolve in random order. Group parts that belong together under one loading state.
- **Optimize the time to meaningful content**, not only the total load time. Loading everything first and showing it at once can be the fastest total and still feel the slowest.

## Lifecycle facts that create waterfalls

- A component's effects run only after it mounts, and a child mounts only when its parent renders it.
- `const reviews = <Reviews />` placed before `if (!product) return <Spinner />` does **not** mount `Reviews`. Creating an element doesn't render it.
- So when a parent fetches and shows a spinner, the child starts fetching only after the parent's data arrives. Each level adds a full round trip: that's a waterfall.
- `await getA(); await getB();` inside one effect is also a waterfall when the two requests are independent.

## Fix waterfalls

1. **Start independent requests together.**
   - `Promise.all` when the UI needs all of them before showing anything.
   - Separate promises, each with its own state update, to reveal parts as they arrive.
2. **Start them as early as possible**: in route loaders, in the component that renders all the consumers, in data providers mounted near the top, or by prefetching on intent (hover, focus, route preload) through the data library's query client.
3. **Lift where the fetch *starts*, not where the data renders.** Data providers (a context per resource, or the library's query cache) start requests at the top and let deeply nested consumers read the result without props drilling.
4. **Nest requests only for real dependencies.** When request B needs A's result (a user ID from the session), chain them explicitly (`enabled: !!userId` in TanStack Query). Otherwise run them side by side (`useQueries`, `useSuspenseQueries`, or several queries in the same component).
5. **In Server Components**, start the promises before awaiting them (or use `Promise.all`), and stream slower parts behind Suspense boundaries.

## Browser limits and priorities

- **Connection limits.** Over HTTP/1.1, browsers open about 6 connections per origin, and extra requests queue. HTTP/2 and HTTP/3 multiplex requests over one connection, but bandwidth and server concurrency still apply.
- **Keep the critical path short.** Don't fire analytics, prefetches of rarely-used data, or other low-value requests ahead of the page's critical data. `fetch(url, { priority: 'low' })` is a hint in browsers that support it.
- **Module-level fetches** (`const p = fetch(...)` at import time, outside any component) start before React renders. They're useful for data a route needs immediately, or inside lazily-loaded modules whose code loads only when needed. Elsewhere they're a hazard:
  - they run whether or not the component ever renders;
  - they can't use props or be cancelled;
  - they compete with critical requests.

## Race conditions

When a component fetches based on something that changes (an `id`, a query, a page, a tab), responses can arrive out of order. The last response to *resolve* wins, not the last one *requested*, so users see the previous item's data or a flash of wrong content.

Fix it in the effect's cleanup:

- **`AbortController`** (preferred for `fetch`): abort the previous request. That also saves bandwidth. Ignore the rejection your own abort causes. Check `controller.signal.aborted`, which works for any abort reason; `err.name === 'AbortError'` holds only when `abort()` is called without a reason.
- **An ignore flag**, which works for any promise (SDK calls, IndexedDB, workers): `let ignore = false; … if (!ignore) setData(d); return () => { ignore = true; };`.
- **Compare against the latest ID** stored in a ref, when you can't touch the promise chain.
- **Remount with `key`** as a last resort. It works, but resets all state and re-runs every effect below it.

Related points:

- **On-demand requests from event handlers** (search-as-you-type, "load more"): keep the in-flight request's controller in a ref and abort it before starting the next one.
- **StrictMode's double effect run in development is expected.** With a correct cleanup, the first request is aborted or ignored. Don't "fix" the double request with a ref guard or by removing StrictMode.
- **`async`/`await` changes the syntax, not the race.**

## Errors and loading states

- **`fetch` resolves on HTTP errors.** Check `response.ok` and throw a useful error; only network failures and aborts reject.
- **Render explicit loading, error and empty states.** Never let a failure look like "no results".
- **Keep existing data visible during refetches**, with a subtle indicator, instead of swapping in a spinner. Swapping unmounts the content and loses scroll position and input (see `react-reconciliation`).
- **Send unexpected failures to an error boundary** when the component can't render without the data. See `react-error-handling`; TanStack Query's `throwOnError` and `useSuspenseQuery` do this.

## Suspense

- **Suspense moves loading declarations up into boundaries.** Components that aren't ready suspend, and the nearest `<Suspense fallback>` renders instead.
- **It doesn't parallelize anything by itself.** If a parent suspends and its child starts fetching only when it renders, that's still a waterfall. Start requests early (loaders, prefetching, promises passed down from Server Components).
- **React 19 commits the fallback immediately** and pre-renders suspended siblings afterwards. Requests started *inside* suspending children begin later than in React 18, which is one more reason to start them before rendering.
- **`use(promise)` needs a promise created outside render**, from a cache, a loader, or a Server Component. `use(fetch(url))` inline in a Client Component creates a new promise on every render.
- **Place boundaries to match the loading sequence**: one boundary around content that should appear together, separate boundaries around independent regions.

## Checklist

- [ ] Independent requests start in parallel, as early as the data is known to be needed.
- [ ] No parent-then-child fetch chains unless the child truly depends on the parent's result.
- [ ] Every effect-based fetch cleans up (abort or ignore); handler-based fetches abort the previous request.
- [ ] `response.ok` is checked, errors are surfaced, and loading, error and empty states are rendered.
- [ ] Existing data stays visible during refetches.
- [ ] The project's data library or framework loader is used rather than hand-rolled caching.
- [ ] Module-level fetches are limited to critical route data or lazily-loaded chunks.

## Examples

- `examples/waterfalls.md`: a product page fixed four ways (`Promise.all`, independent promises, data providers, library prefetching), with the timing of each.
- `examples/race-conditions.md`: an invoice viewer with fast tab switching, fixed with `AbortController`, an ignore flag, and a latest-ID check; plus search requests triggered from handlers.

## References

- `references/library-patterns.md`: how each pattern maps to TanStack Query, SWR, Next.js Server Components and route loaders.

# Fetching Patterns Mapped to Libraries and Frameworks

The patterns in `SKILL.md` are library-independent. This table shows how each maps to common tools. Always check which versions and conventions the project uses before copying an API.

## Contents

1. [TanStack Query](#tanstack-query)
2. [SWR](#swr)
3. [Next.js App Router (Server Components)](#nextjs-app-router-server-components)
4. [Route loaders (React Router, Remix, TanStack Router)](#route-loaders-react-router-remix-tanstack-router)
5. [Raw fetch checklist](#raw-fetch-checklist)

## TanStack Query

| Pattern | TanStack Query |
|---|---|
| Parallel requests | Several `useQuery` calls in the same component, or `useQueries({ queries: [...] })`, or `useSuspenseQueries` |
| Dependent request (a real dependency) | `useQuery({ ..., enabled: !!userId })` |
| Start before rendering (route or intent) | Fire and forget: `queryClient.prefetchQuery(options)`. Block on critical data: `await queryClient.ensureQueryData(options)`. In recent v5 releases both are deprecated in favor of `queryClient.query(options)` (use `.catch(() => {})` for fire-and-forget, and `staleTime: 'static'` to mirror `ensureQueryData`). Use whichever the installed version supports without deprecation warnings |
| Share results without props drilling | The query cache: call `useQuery` with the same key anywhere, deduplicated automatically |
| Race conditions | Handled: results are keyed by `queryKey`. Pass `signal` from the query function context to `fetch` so obsolete requests are actually cancelled: `queryFn: ({ signal }) => fetch(url, { signal })` |
| Keep old data while the key changes | `placeholderData: keepPreviousData` |
| Errors to an error boundary | `throwOnError: true` (or a function), or `useSuspenseQuery` |
| Suspense | `useSuspenseQuery` inside `<Suspense>` boundaries; prefetch to avoid suspense waterfalls |
| Derived data | `select` with a stable function reference |
| Check HTTP status | Your `queryFn` must throw on `!res.ok`; the library can't know a 404 is an error |

Define query options once and reuse them, so keys and functions stay consistent between prefetching and components:

```ts
export const invoiceQuery = (id: string) =>
  queryOptions({
    queryKey: ['invoice', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/invoices/${id}`, { signal });
      if (!res.ok) throw new Error(`Invoice ${id}: ${res.status}`);
      return (await res.json()) as Invoice;
    },
  });
```

## SWR

| Pattern | SWR |
|---|---|
| Parallel requests | Several `useSWR` calls in the same component |
| Dependent request | A conditional key: `useSWR(userId ? `/api/users/${userId}` : null, fetcher)` |
| Prefetch | `preload(key, fetcher)` before render (on hover or at route level) |
| Deduplication and sharing | Same key → shared cache and deduped requests |
| Keep previous data | `keepPreviousData: true` |
| Suspense and error boundaries | `suspense: true` (throws to boundaries) |
| HTTP errors | The fetcher must throw on `!res.ok` |

## Next.js App Router (Server Components)

- **Fetch on the server**, in the Server Component that needs the data. Rendering on the server removes the client-side waterfall of "download JS → render → effect → fetch".
- **Parallelize by starting promises before awaiting them:**

  ```tsx
  export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const productP = getProduct(id);
    const reviewsP = getReviews(id);       // started, not awaited
    const product = await productP;        // block only on what the top of the page needs
    return (
      <>
        <ProductDetails product={product} />
        <Suspense fallback={<ReviewsSkeleton />}>
          <Reviews reviewsPromise={reviewsP} /> {/* streamed in when ready */}
        </Suspense>
      </>
    );
  }
  ```

  A Client Component can receive the promise and read it with `use(reviewsPromise)`. A Server Component can simply `await` it.
- **Nested async components each awaiting their own data** form a server-side waterfall. The same rules apply: start early, run in parallel, and put Suspense boundaries where streaming helps.
- **Deduplicate** identical requests within a render with React's `cache()` for non-`fetch` data sources. Follow the project's Next.js version docs for `fetch` caching semantics, because they have changed between major versions.
- Parameter shapes like `params` being a promise differ between Next.js versions. Match the project.

## Route loaders (React Router, Remix, TanStack Router)

- A loader runs before the route renders, and loaders of nested routes run **in parallel**. Put each route's data in its own loader rather than fetching in components after render.
- Return promises for non-critical data and render them with the router's deferred or await utilities (or `use`) behind Suspense, so critical data blocks and the rest streams.
- Combine loaders with a query cache (TanStack Query's `ensureQueryData` inside the loader) to get both early start and client-side caching.

## Raw fetch checklist

When writing fetching by hand:

- [ ] `AbortController` (or an ignore flag) in the effect cleanup.
- [ ] `if (!res.ok) throw …` before parsing.
- [ ] Loading, error and empty states rendered explicitly.
- [ ] `AbortError` ignored, and real errors surfaced (state or boundary).
- [ ] Independent requests started together.
- [ ] No module-level fetches in eagerly-loaded code, unless they're route-critical.
- [ ] Consider whether you're re-implementing a cache. If so, use a library.

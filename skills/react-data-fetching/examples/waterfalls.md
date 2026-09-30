# Example: Untangling a Request Waterfall

A product page shows product details (~800 ms), customer reviews (~1,500 ms) and "customers also bought" recommendations (~1,200 ms).

## The waterfall

Each component fetches its own data and shows a spinner until it arrives:

```tsx
function ProductPage({ productId }: { productId: string }) {
  const product = useJson<Product>(`/api/products/${productId}`);
  if (!product) return <PageSkeleton />;
  return (
    <>
      <ProductDetails product={product} />
      <Reviews productId={productId} /> {/* mounts only after the product arrives */}
    </>
  );
}

function Reviews({ productId }: { productId: string }) {
  const reviews = useJson<Review[]>(`/api/products/${productId}/reviews`);
  if (!reviews) return <ReviewsSkeleton />;
  return (
    <>
      <ReviewList reviews={reviews} />
      <Recommendations productId={productId} /> {/* mounts only after the reviews arrive */}
    </>
  );
}
```

Timeline: product 0→800 ms, then reviews 800→2,300 ms, then recommendations 2,300→3,500 ms. The page is complete after **3.5 s**, although no request depends on another. The longest request alone takes 1.5 s.

`useJson` is a small effect-based hook, with cleanup, used for illustration:

```tsx
function useJson<T>(url: string): T | undefined {
  const [data, setData] = useState<T>();
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        return res.json() as Promise<T>;
      })
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') console.error(err); // real apps: error state or boundary
      });
    return () => controller.abort();
  }, [url]);
  return data;
}
```

## Fix 1: all together with `Promise.all`

Use this when the page should appear at once:

```tsx
function useProductPageData(productId: string) {
  const [data, setData] = useState<{ product: Product; reviews: Review[]; recs: Product[] }>();
  useEffect(() => {
    const controller = new AbortController();
    const get = <T,>(url: string) =>
      fetch(url, { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${url}`);
        return r.json() as Promise<T>;
      });

    Promise.all([
      get<Product>(`/api/products/${productId}`),
      get<Review[]>(`/api/products/${productId}/reviews`),
      get<Product[]>(`/api/products/${productId}/recommendations`),
    ])
      .then(([product, reviews, recs]) => setData({ product, reviews, recs }))
      .catch((err) => { if (err.name !== 'AbortError') console.error(err); });

    return () => controller.abort();
  }, [productId]);
  return data;
}
```

Everything appears at **1.5 s**, the slowest request, instead of 3.5 s. The trade-off is that nothing appears before that, even though the product details were ready at 800 ms.

## Fix 2: parallel start, independent reveal

Start all requests at once, but store each result separately so each part renders as soon as its data arrives:

```tsx
function ProductPage({ productId }: { productId: string }) {
  // All three hooks run in the same component, so all three effects start in the same commit.
  const product = useJson<Product>(`/api/products/${productId}`);
  const reviews = useJson<Review[]>(`/api/products/${productId}/reviews`);
  const recs = useJson<Product[]>(`/api/products/${productId}/recommendations`);

  if (!product) return <PageSkeleton />;
  return (
    <>
      <ProductDetails product={product} />                                {/* ~800 ms */}
      {reviews ? <ReviewList reviews={reviews} /> : <ReviewsSkeleton />}  {/* ~1,500 ms */}
      {recs ? <RecommendationRail items={recs} /> : <RailSkeleton />}     {/* ~1,200 ms */}
    </>
  );
}
```

This keeps the progressive reveal of the original, with a total of 1.5 s instead of 3.5 s. Each arrival re-renders `ProductPage`, three renders in all, so keep this component light, or move each piece behind its own small component or provider.

## Fix 3: data providers, to start at the top and read anywhere

Fix 2 moved fetching into the page and forces it to pass data down. Data providers keep the *start* of each request at the top while letting any descendant read the result:

```tsx
const ReviewsContext = createContext<Review[] | undefined>(undefined);

function ReviewsProvider({ productId, children }: { productId: string; children: React.ReactNode }) {
  const reviews = useJson<Review[]>(`/api/products/${productId}/reviews`);
  return <ReviewsContext.Provider value={reviews}>{children}</ReviewsContext.Provider>;
}
export const useReviews = () => useContext(ReviewsContext);

// Same pattern for ProductProvider and RecommendationsProvider.

function ProductRoute({ productId }: { productId: string }) {
  return (
    <ProductProvider productId={productId}>
      <ReviewsProvider productId={productId}>
        <RecommendationsProvider productId={productId}>
          <ProductPage /> {/* all three requests started when the providers mounted */}
        </RecommendationsProvider>
      </ReviewsProvider>
    </ProductProvider>
  );
}

function ReviewList() {
  const reviews = useReviews(); // deep in the tree, no props drilling
  if (!reviews) return <ReviewsSkeleton />;
  return <ul>{/* ... */}</ul>;
}
```

The values are the fetched data (or `undefined`), which change only when requests resolve, so each context changes about once. Consumers of one resource don't re-render when another resolves. For more than a handful of resources, or for caching across pages, this is what a data library does for you (Fix 4).

## Fix 4: with a data library, prefetch at the route

With TanStack Query, components keep their colocated `useQuery` calls. Start the requests before the component tree renders:

```tsx
// Route loader (TanStack Router, React Router, or a click/hover handler for intent-based prefetch)
export function loadProductRoute(queryClient: QueryClient, productId: string) {
  // Start all three in parallel. Await only what must block the first paint.
  queryClient.prefetchQuery(reviewsQuery(productId));
  queryClient.prefetchQuery(recommendationsQuery(productId));
  return queryClient.ensureQueryData(productQuery(productId));
}

// Recent TanStack Query v5 releases deprecate prefetchQuery/ensureQueryData in favor of queryClient.query(options).
// Use the API the installed version supports; the pattern (start early, in parallel) is the same.

// Components stay colocated. They find the requests already in flight or cached.
function Reviews({ productId }: { productId: string }) {
  const { data, isPending, error } = useQuery(reviewsQuery(productId));
  // ...
}
```

Without a router loader, you can still avoid the waterfall by calling all three `useQuery` hooks (or `useQueries`) in `ProductPage` instead of in nested components that mount later.

## Fix 5: prefetch in a lazily-loaded module

For a heavy panel that loads with `React.lazy`, starting its fetch at module scope is acceptable, because the module (and so the fetch) loads only when the panel is about to render:

```tsx
// RecommendationsPanel.tsx, loaded via lazy(() => import('./RecommendationsPanel'))
const recsPromise = fetch('/api/personalized-recs').then((r) => r.json());

export default function RecommendationsPanel() {
  const recs = use(recsPromise); // React 19; suspends until resolved
  return <RecommendationRail items={recs} />;
}
```

Don't do this in modules imported eagerly by the main bundle. The request would fire on every page load, whether or not the panel is shown, and compete with critical requests. It also can't depend on props, and it runs only once per page load, with no refetch or cache invalidation. Prefer the library prefetch in Fix 4 for anything dynamic.

## Choosing between the fixes

| Need | Fix |
|---|---|
| Show everything at once | `Promise.all` (1), or one Suspense boundary around parallel queries |
| Progressive reveal in a chosen order | Parallel start with independent state (2), or separate Suspense boundaries |
| Consumers deep in the tree | Data providers (3), or a data library's cache (4) |
| Caching, dedupe, refetch, pagination | A data library (4) |
| Route-critical data | A route loader or prefetch (4), or a framework loader or Server Component |

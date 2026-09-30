# Example: Placing Error Boundaries in a Dashboard App

## Layout

```
App
├── AppShell (top nav, side nav)
│   └── Routes
│       ├── /overview  → OverviewPage
│       │   ├── RevenueChart      (charting library, API data)
│       │   ├── ActivityFeed      (user-generated content)
│       │   └── PartnerWidget     (third-party embed)
│       └── /settings  → SettingsPage
```

## Boundaries

```tsx
import { ErrorBoundary } from './components/error-boundary';

// 1. Root: last line of defense
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary
    fallback={<FullPageError />} // "Something went wrong" + reload button + support link
    onError={(error, info) => monitoring.captureException(error, { extra: { componentStack: info.componentStack } })}
  >
    <App />
  </ErrorBoundary>,
);

// 2. Route level: a broken page keeps the shell usable
function AppShell() {
  const location = useLocation();
  return (
    <Layout nav={<SideNav />}>
      <ErrorBoundary
        resetKeys={[location.pathname]} // navigating away from a broken page resets it
        fallbackRender={({ resetErrorBoundary }) => <PageError onRetry={resetErrorBoundary} />}
        onError={reportError}
      >
        <Routes />
      </ErrorBoundary>
    </Layout>
  );
}

// 3. Region level: independent widgets fail independently
function OverviewPage() {
  return (
    <Grid>
      <WidgetBoundary title="Revenue">
        <RevenueChart />
      </WidgetBoundary>
      <WidgetBoundary title="Activity">
        <ActivityFeed />
      </WidgetBoundary>
      <WidgetBoundary title="Partner insights">
        <PartnerWidget />
      </WidgetBoundary>
    </Grid>
  );
}

function WidgetBoundary({ title, children }: { title: string; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  return (
    <ErrorBoundary
      onError={reportError}
      onReset={() => queryClient.resetQueries({ queryKey: ['widget', title] })} // retry with fresh data
      fallbackRender={({ resetErrorBoundary }) => (
        <Card title={title}>
          <p>We couldn't load this section.</p>
          <button onClick={resetErrorBoundary}>Retry</button>
        </Card>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
```

What each layer buys:

| Failure | Without boundaries | With them |
|---|---|---|
| `PartnerWidget` throws on an unexpected payload | Whole app blank | One card says "couldn't load", and the rest works |
| A bug on `/settings` | Whole app blank | The settings area shows `PageError`, the nav still works, and navigating away resets |
| A bug in `AppShell` itself | Whole app blank | `FullPageError` with reload, and the error is reported |

## Retry that actually retries

`resetErrorBoundary()` re-renders the children. If they read the same cached, failing data, they fail again immediately. Clear or refetch in `onReset` (as above), or make the retry change an input, such as a key or a new request.

## Resetting on navigation

`resetKeys={[location.pathname]}` resets the route boundary when the path changes, but only if the boundary is *already* showing its fallback. The bundled boundary ignores key changes that happen in the same update as the error, so navigating *to* a broken page doesn't cause a reset loop.

## Framework equivalents

- **Next.js App Router**: an `error.tsx` file in a route segment is that segment's boundary (a Client Component receiving `error` and `reset`); `global-error.tsx` covers the root layout. Use component-level boundaries inside pages for widgets.
- **React Router / Remix**: export an `ErrorBoundary` from a route module (or set `errorElement`). Loader and action errors land there too.
- **Region boundaries** are still regular components inside those pages.

## Reporting

- Include `info.componentStack` from `onError`/`componentDidCatch`. It shows *where* in the tree the error happened, which a JavaScript stack often doesn't.
- On React 19, `createRoot(container, { onCaughtError, onUncaughtError, onRecoverableError })` gives one global place to report caught, uncaught and hydration-recoverable errors.
- Deduplicate and rate-limit on the reporting side. A render error inside a list can fire once per item.

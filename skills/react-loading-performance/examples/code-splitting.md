# Example: Splitting a Project-Management App

A single-page app has three routes: Board (the landing screen), Timeline (a Gantt chart library) and Reports (charts and a spreadsheet export). Cards open a comment editor built on a rich-text library, and boards can be exported to PDF. Everything ships in one 1.1 MB entry chunk, so the board, which needs a fraction of it, waits for all of it.

## Step 1: split by route

With a router that supports route-level lazy loading, let it load each route's code *and* data together:

```tsx
// React Router (data mode): each module exports `Component` and, optionally, `loader`
const router = createBrowserRouter([
  {
    path: '/',
    Component: AppShell,
    HydrateFallback: AppShellSkeleton,
    children: [
      { index: true, lazy: () => import('./routes/board') },
      { path: 'timeline', lazy: () => import('./routes/timeline') },
      { path: 'reports', lazy: () => import('./routes/reports') },
    ],
  },
]);
```

The router fetches a route's module when navigation starts and runs its loader as soon as the module arrives, before rendering. Frameworks (Next.js, React Router framework mode, TanStack Router with automatic code splitting) do the equivalent without any code.

Without a router that does this, use `lazy` and Suspense, and put the boundary inside the shell so navigation and header stay visible:

```tsx
const TimelinePage = lazy(() => import('./routes/TimelinePage'));
const ReportsPage = lazy(() => import('./routes/ReportsPage'));

function AppShell() {
  return (
    <>
      <TopNav />
      <Suspense fallback={<PageSkeleton />}>
        <Outlet />
      </Suspense>
    </>
  );
}
```

Two rules make this version behave:

- **`lazy` at module scope**, never inside a component.
- **Navigate in a transition** (routers do this). On later navigations, React keeps the current page visible until the next route's chunk loads, instead of flashing `PageSkeleton`.

## Step 2: split by interaction

The comment editor appears only when someone clicks "Add comment". It's the largest library left in the Board chunk.

```tsx
const loadCommentEditor = () => import('./CommentEditor');
const CommentEditor = lazy(loadCommentEditor);
const preloadCommentEditor = () => void loadCommentEditor().catch(() => {});

function CardComments({ cardId }: { cardId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  return isEditing ? (
    <Suspense fallback={<EditorPlaceholder rows={4} />}>
      <CommentEditor cardId={cardId} onDone={() => setIsEditing(false)} />
    </Suspense>
  ) : (
    <button
      className="comment-placeholder"
      onPointerEnter={preloadCommentEditor}
      onFocus={preloadCommentEditor}
      onClick={() => setIsEditing(true)}
    >
      Add a comment…
    </button>
  );
}
```

- **Preload on intent.** Hover and focus usually come 100–300 ms before the click, which is often enough to hide the download completely.
- **`EditorPlaceholder` has the editor's height**, so the card doesn't jump when the real editor replaces it.
- **The `.catch`** stops a failed preload from becoming an unhandled rejection. If the chunk truly can't load, the render throws, and the error boundary around the board shows a retry.

PDF export doesn't render anything, so it doesn't need `lazy` at all:

```tsx
async function handleExport(board: Board) {
  setIsExporting(true);
  try {
    const { exportBoardPdf } = await import('./export/pdf'); // the PDF library loads here, once
    await exportBoardPdf(board);
  } finally {
    setIsExporting(false);
  }
}
```

## Step 3: check that the split actually happened

Open the bundle report again. Common reasons a "lazy" library is still in the main chunk:

- **Another static import pulls it in.** A shared `components/index.ts` that re-exports `CommentEditor`, imported by the board for an unrelated `Avatar`, drags the editor back into the board chunk. Import `Avatar` from its own file, or make the shared package side-effect free (`examples/trimming-the-bundle.md`).
- **The split point is too low.** Lazy-loading a small `<GanttToolbar>` while the timeline route statically imports `gantt-lib` elsewhere saves nothing. Split at the module that imports the heavy library.
- **A vendor chunk rule** bundles every `node_modules` package into one chunk loaded on the first page. Group vendors by when they're needed: the framework in one chunk that rarely changes, route-only libraries left with their routes. (In Vite 7 and earlier this is `build.rollupOptions.output.manualChunks`; Vite 8 moved chunk grouping to Rolldown's options, so check the version's docs. In webpack it's `optimization.splitChunks`.)

Stable, content-hashed chunks also help repeat visits: a deploy that changes Reports doesn't invalidate the cached Board and framework chunks.

## Step 4: recover from failed chunk loads

After a deploy, users with the old page open request chunk files that no longer exist. Dynamic imports fail with errors like "Failed to fetch dynamically imported module" (Vite) or `ChunkLoadError` (webpack).

```ts
// main.tsx (Vite): reload to pick up the new deploy's HTML
window.addEventListener('vite:preloadError', (event) => {
  const lastReload = Number(sessionStorage.getItem('chunk-reload-at') ?? 0);
  if (Date.now() - lastReload < 10_000) return; // just reloaded: let the error boundary handle it
  event.preventDefault(); // stop Vite from throwing; we're reloading instead
  sessionStorage.setItem('chunk-reload-at', String(Date.now()));
  window.location.reload();
});
```

- The timestamp prevents a reload loop when the failure isn't caused by a deploy (an offline user, a blocked CDN): a second failure right after a reload goes to the error boundary.
- Keep the previous deploy's assets on the CDN for a while, so most old pages never hit this.
- `React.lazy` caches a rejected import: once a lazy component fails, rendering it again throws the same error. Recovery means a page reload or a newly created lazy component, not a re-render. Pair lazy regions with an error boundary whose fallback offers "Reload" (`react-error-handling`).

## Result

| Chunk | Before | After |
|---|---|---|
| Entry (shell + Board) | 1.1 MB | 310 KB |
| Timeline route | | 260 KB, on navigation |
| Reports route | | 240 KB, on navigation |
| Comment editor | | 180 KB, preloaded on hover or focus |
| PDF export | | 210 KB, on click |

(Minified sizes; check compressed sizes against your budget.) First load ships under a third of the original JavaScript, and nothing the user clicks waits on a cold download.

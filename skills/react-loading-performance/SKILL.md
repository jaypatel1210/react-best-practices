---
name: react-loading-performance
description: Make React apps load fast, covering bundle analysis and tree-shaking, route- and interaction-level code splitting with React.lazy and Suspense, preloading chunks on intent, resource hints and the React 19 resource APIs (preload, preinit, preconnect), images (LCP priority, lazy loading, responsive srcset, reserved dimensions), web fonts (font-display, preloading, fallback metrics), render-blocking scripts and styles, third-party scripts, and the load-time Core Web Vitals (LCP and CLS). Use when a page is slow to show its main content, when the JavaScript bundle is large, when adding lazy loading or dynamic import(), when adding images, fonts or third-party scripts, when Lighthouse or field data reports poor LCP or CLS, or when reviewing imports of heavy libraries.
license: MIT
---

# Loading Performance: Ship Less, Start the Critical Path First

A page load is a chain of dependencies: HTML, then the CSS and JavaScript it references, then data, images and fonts. Every link that starts late, or carries bytes the first screen doesn't need, pushes back the moment users see what they came for. This skill decides **what goes into the first load** and **when each resource starts**.

Interaction speed after load (INP, long tasks) belongs to `react-responsiveness`. Data waterfalls belong to `react-data-fetching`.

## Measure first

- **Core Web Vitals, judged at the 75th percentile of real page loads:**

  | Metric | Good | Poor | Measures |
  |---|---|---|---|
  | LCP (Largest Contentful Paint) | ≤ 2.5 s | > 4 s | When the main content appears |
  | CLS (Cumulative Layout Shift) | ≤ 0.1 | > 0.25 | How much visible content jumps |
  | INP (Interaction to Next Paint) | ≤ 200 ms | > 500 ms | Responsiveness; see `react-responsiveness` |

- **Lab tools explain, field data decides.** Lighthouse and the DevTools Performance panel (with network and CPU throttling) show *why* a load is slow. Field data (CrUX, or your own RUM with the `web-vitals` library) shows *whether* users actually suffer.
- **Split LCP into its four parts** before fixing it: time to first byte, resource load delay (how late the LCP resource was discovered), resource load duration, and element render delay. Fix the largest part.
- Setup and attribution: `references/core-web-vitals.md`.

## Rule 1: Know what's in the bundle

- **Look before you cut.** Open a bundle report (`rollup-plugin-visualizer`, `webpack-bundle-analyzer`, `@next/bundle-analyzer`, `source-map-explorer`) and start with the entry chunk: it blocks the first render of every page. Usual suspects: date libraries with every locale, the CommonJS `lodash`, icon sets imported through one index file, charts, editors, maps and PDF libraries in the main chunk, and duplicate package versions.
- **Tree-shaking needs ES modules and side-effect-free code.** It fails with CommonJS packages, with dynamic access on `import * as ns`, and with barrel files that re-export modules with side effects. Import the specific module path (`lodash-es/debounce`), or use the framework's barrel optimization (`optimizePackageImports` in Next.js).
- **Declare `"sideEffects"` in your own packages** (monorepo libraries, design systems): `false`, or a list of the files that must run on import, such as `["*.css", "./src/polyfills.ts"]`. Without it, bundlers keep every module a barrel re-exports. With `false` but no list, global CSS and polyfills silently disappear.
- **Prefer the platform** over a dependency: `Intl` formatters, `structuredClone`, `URLSearchParams`, `AbortSignal.timeout()`, `Array.prototype.toSorted`.
- **Keep server-only code on the server.** Server Component code never ships to the client, so keep `"use client"` boundaries at interactive leaves.
- **Guard the budget in CI** (`size-limit`, bundler size warnings), so a single import can't silently add 200 KB.

Step-by-step fixes: `examples/trimming-the-bundle.md`.

## Rule 2: Split by route first, then by interaction

- **Route-level splitting is the largest win for the least risk.** Frameworks do it for you (Next.js, React Router framework mode, TanStack Router's automatic splitting). In a hand-rolled SPA, lazy-load each route.
- **Then split heavy parts the first screen doesn't show:** dialogs and drawers, editors, charts below the fold, admin-only panels, rarely opened tabs, anything behind a click.
- **Don't split small or always-visible components.** Each chunk costs a request and a loading state.
- **`lazy` rules:**
  - Call `lazy` at module scope. Inside a component it creates a new component type on every render, which remounts the subtree and loses its state (`react-reconciliation`).
  - `lazy` expects a default export. For a named export: `lazy(() => import('./Chart').then((m) => ({ default: m.Chart })))`.
  - Wrap it in a `<Suspense>` whose fallback has the size of the real content, placed around the lazy region only, so everything outside it remains on screen.
  - Navigations and tab switches should run in a transition (`startTransition`, which most routers use). React then keeps the current screen visible until the new chunk is ready instead of flashing a fallback.
  - Chunks can fail to load, for example after a deploy removes the old files, or on a flaky connection. Put an error boundary with a reload action around lazy regions (`react-error-handling`).

## Rule 3: Start downloads on intent, not on render

A lazy chunk starts downloading when React first renders the component, which is usually right *after* the click that needs it. Start it earlier:

```tsx
const loadInvoiceEditor = () => import('./InvoiceEditor');
const InvoiceEditor = lazy(loadInvoiceEditor);

function EditInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button onPointerEnter={loadInvoiceEditor} onFocus={loadInvoiceEditor} onClick={() => setIsOpen(true)}>
        Edit invoice
      </button>
      {isOpen && (
        <Suspense fallback={<EditorSkeleton />}>
          <InvoiceEditor invoiceId={invoiceId} onClose={() => setIsOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
```

- The module loader caches `import()` by URL, so the early call and `lazy`'s later call share one request.
- A preload that fails becomes an unhandled rejection. In real code, call `loadInvoiceEditor().catch(() => {})` from the handlers; the render path still reports a real failure to the nearest error boundary.
- Other good moments: when the browser is idle after load, when a link scrolls into view, or when a route is the likely next step.
- **Start the data with the code.** Prefetch the editor's query in the same handler (`queryClient.prefetchQuery`), or the chunk arrives and then waits for its data. See `react-data-fetching`.

## Rule 4: Tell the browser what matters

| Hint | Use it for | Watch out |
|---|---|---|
| `preconnect` | A critical cross-origin host used early (API, image CDN, font host) | Two or three origins at most; `crossOrigin` for CORS fetches such as fonts |
| `preload` | A critical resource discovered late: an LCP image referenced from CSS or JS, a font file | URL, `as`, `crossorigin` and `type` must match the real request, or the file downloads twice; an unused preload wastes bandwidth and logs a warning |
| `modulepreload` | JavaScript modules needed soon | Prefer it to `preload as="script"` for ES modules; Vite already adds these for a chunk's dependencies |
| `prefetch` | Resources for a likely *next* navigation | Low priority, and off by default in Safari; for next-route code, calling `import()` on intent or idle works everywhere |
| `fetchPriority` | Raising the LCP image; lowering offscreen carousel slides | A hint, not a guarantee |

**React 19** exports `preconnect`, `prefetchDNS`, `preload`, `preloadModule`, `preinit` and `preinitModule` from `react-dom`. Call them from a component or an event handler; React dedupes them, puts them in `<head>`, and sends them early during streaming SSR. It also hoists `<title>`, `<meta>` and `<link>` rendered anywhere into `<head>` (stylesheets only when they have a `precedence` prop). Details: `references/resource-hints.md`.

## Rule 5: Images

- **Reserve the space.** Always set `width` and `height` (the intrinsic ratio) or CSS `aspect-ratio`. An image without dimensions pushes content down when it arrives, which counts as layout shift.
- **Lazy-load only below the fold.** `loading="lazy"` on the LCP image delays the most important resource on the page. Give the hero image `fetchPriority="high"`, and leave the rest to load lazily.
- **Make the LCP image discoverable in the HTML.** A hero that is a CSS background, or an `<img>` rendered only after JavaScript and data load, starts late. Server-render it as an `<img>`, or `preload` it.
- **Serve the right size and format.** Use `srcSet` with `sizes` that matches the rendered width, so phones don't download desktop images, plus AVIF or WebP through an image CDN or `<picture>`.
- **Use the framework's image component** when there is one, and tell it which image is the LCP; it can't know. With `next/image` on Next.js 16+, give the hero `loading="eager"` or `fetchPriority="high"` (`priority` is deprecated there; Next.js 15 and earlier use `priority`).
- React 19 knows the `fetchPriority` prop. Older versions may warn about it; use the lowercase attribute there.

## Rule 6: Fonts

- **Self-host WOFF2 files**, or let a tool do it (`next/font`). A third-party font stylesheet adds a connection and a request chain before any font byte arrives.
- **Pick `font-display` on purpose.** Without it, most browsers hide text for up to about 3 seconds. `swap` shows fallback text immediately and swaps later, which can shift layout; `optional` uses the web font only if it arrives almost at once, so it never shifts.
- **Preload only the one or two files the first screen uses**, with `crossorigin` even on the same origin: fonts are always fetched in CORS mode.
- **Match the fallback's metrics** (`size-adjust` and the `*-override` descriptors on a local fallback `@font-face`) so the swap barely moves text. `next/font`, Fontaine and Capsize compute them.
- **Load less:** subset, limit weights, and prefer one variable font over many static files.

## Rule 7: Keep the critical path short

- **Render-blocking resources:** CSS in `<head>` blocks rendering by design, so keep first-load CSS small and avoid `@import` chains. Use `defer` or `type="module"` for your scripts and `async` for independent third-party ones, never a plain `<script src>` in `<head>`.
- **Third-party scripts** (analytics, chat, tag managers, A/B testing) often cost more than the app. Load them after the page is interactive or on first interaction (`next/script` with `lazyOnload`), and budget them. Anti-flicker snippets that hide the page until an A/B script loads delay LCP directly.
- **Render the first screen on the server** (SSR or static generation) so the LCP element is in the HTML. Hydration then costs main-thread time in proportion to client JavaScript; Server Components shrink it, and `<Suspense>` streaming keeps slow data from holding back the shell.
- **Don't fetch above-the-fold content in `useEffect` after hydration.** LCP becomes "download JS, run it, fetch, render".

## Preventing layout shift (CLS)

- **Reserve space for everything that arrives late:** image dimensions, skeletons at the final size, `min-height` for ads and embeds, Suspense and lazy fallbacks the size of their content.
- **Don't insert content above what the user is reading** (banners, "new items" notices) unless it answers a user action.
- **Animate `transform`, not `top`, `height` or `margin`** (`react-animation`), and render the same layout on the server and the first client render (`react-layout-portals`).

## Review checklist

- [ ] The entry chunk holds nothing the first screen doesn't need; imports allow tree-shaking.
- [ ] Routes are split; heavy interaction-only UI is lazy (`lazy` at module scope, a sized `<Suspense>` fallback) and preloaded on intent with its data.
- [ ] The LCP image is in the server HTML, not lazy, with `fetchPriority="high"`, correct `srcSet`/`sizes`, and dimensions.
- [ ] Every image, embed, ad slot and late-loading section has reserved space.
- [ ] Fonts are self-hosted WOFF2 with a deliberate `font-display`; only first-screen fonts are preloaded, with `crossorigin`.
- [ ] Third-party scripts are async or deferred, loaded late where possible, and budgeted; preconnects are limited to a few origins.

## Examples

- `examples/code-splitting.md`: a project-management app split by route (with router-level lazy loading) and by interaction, preloading on intent, a library loaded inside a click handler, checking that the split worked, and recovering from failed chunk loads after deploys.
- `examples/images-and-fonts.md`: fixing a slow hero image step by step (discovery, priority, responsive sizes), images that don't shift layout, and fonts that swap without moving text.
- `examples/trimming-the-bundle.md`: reading a bundle report, replacing a date library with `Intl`, fixing lodash and icon imports, `"sideEffects"` in an internal package, browser targets, and size budgets in CI.

## References

- `references/core-web-vitals.md`: LCP, CLS and INP in depth, the `web-vitals` library with attribution, the Performance API (marks, measures, `PerformanceObserver`, long animation frames), and a cause-to-fix table for each metric.
- `references/resource-hints.md`: each hint and its React 19 API, making preloads match, `modulepreload`, head hoisting rules, critical CSS, and server-side hints.

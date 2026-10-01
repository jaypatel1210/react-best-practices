# Resource Hints and React 19's Resource APIs

## Contents

1. [Which hint for which job](#which-hint-for-which-job)
2. [Making preloads count](#making-preloads-count)
3. [React 19 resource APIs](#react-19-resource-apis)
4. [Critical CSS](#critical-css)
5. [Server-side hints](#server-side-hints)

## Which hint for which job

| Need | HTML | React 19 (`react-dom`) |
|---|---|---|
| Warm up a connection to a cross-origin host you'll use soon | `<link rel="preconnect" href="https://img.example-cdn.com">` | `preconnect(href, { crossOrigin })` |
| Resolve DNS for a less important host | `<link rel="dns-prefetch" href="…">` | `prefetchDNS(href)` |
| Fetch a critical resource the parser would find late | `<link rel="preload" href="…" as="image \| font \| style \| script \| fetch">` | `preload(href, { as, … })` |
| Fetch and compile an ES module needed soon | `<link rel="modulepreload" href="…">` | `preloadModule(href)` |
| Fetch *and apply* a stylesheet or script now | `<link rel="stylesheet">` / `<script async>` | `preinit(href, { as: 'style', precedence } \| { as: 'script' })`, `preinitModule(href)` |
| Fetch something for a likely next navigation | `<link rel="prefetch" href="…">` | No helper; call `import()` on intent or idle instead |

**`preconnect`** saves DNS lookup, TCP and TLS setup: one to three round trips on the first request to an origin. That's 100–500 ms on mobile networks. Each open connection also costs the browser, so keep it to the two or three origins the first screen needs (API, image CDN, font host). Origins used later get `dns-prefetch`.

**`modulepreload` vs `preload as="script"`:** for ES modules, use `modulepreload`. It fetches with the module's CORS mode, stores the result in the module map, and may compile it early. A plain script preload can use different request settings and end up downloading the module twice. Vite already emits `modulepreload` links for a chunk's dependencies.

**`prefetch`** is low priority and only for *future* navigations. Safari turns it off by default, so for the next route's JavaScript, calling the route's `import()` on hover, focus or idle works in every browser.

**Speculation rules** (`<script type="speculationrules">`) can prefetch or fully prerender likely next pages in multi-page apps. They're Chromium-only; unsupporting browsers ignore them.

## Making preloads count

A preload only helps if the later request matches it exactly. Otherwise the browser downloads the resource twice and warns that the preload went unused.

- **Same URL**, including query strings and the exact `srcset` candidate.
- **Same `as`**: `as="font"` for fonts, `as="image"` for images, `as="style"` for stylesheets.
- **Same CORS mode:** fonts are always fetched with CORS, so font preloads need `crossorigin` even on the same origin. `fetch()` requests with credentials need matching `crossorigin` settings.
- **Same type:** `type="font/woff2"` lets browsers skip formats they can't use.
- **Responsive images:** preload with `imagesrcset` and `imagesizes` that match the `<img>`, so the browser picks the same candidate.

Preload only what the first screen needs and the parser would find late: the LCP image if it's referenced from CSS or JavaScript, the one or two fonts above the fold, or a critical stylesheet linked from deep in the document. Everything preloaded competes for early bandwidth with everything else.

## React 19 resource APIs

```tsx
import { preconnect, preload, preinit } from 'react-dom';

function ProductHero({ product }: { product: Product }) {
  // Called during render: on the server they become <link> tags in <head>, sent early when streaming.
  // On the client they're inserted into <head> if not already present.
  preconnect('https://img.example-cdn.com');
  preload(product.heroUrl, { as: 'image', fetchPriority: 'high', imageSrcSet: product.heroSrcSet, imageSizes: '100vw' });
  return <img src={product.heroUrl} srcSet={product.heroSrcSet} sizes="100vw" width={1600} height={900} alt="" />;
}

function onChartTabIntent() {
  preinit('/vendor/chart-theme.css', { as: 'style', precedence: 'default' }); // from an event handler
}
```

- **Dedupe:** calling the same hint from several components produces one tag.
- **Where to call:** in the render of the component that needs the resource, or in the event handler that predicts the need. They're not hooks, so they can be conditional.
- **Hoisting:** React 19 also moves `<title>`, `<meta>` and `<link>` elements rendered anywhere into `<head>`. Exceptions stay in place: `<meta itemProp>`, and `<link>` elements with `itemProp`, `onLoad` or `onError`. A `<link rel="stylesheet">` is hoisted and deduped only with a `precedence` prop, and then a Suspense boundary that contains it waits for the stylesheet before revealing its content.
- **`async` scripts** rendered as `<script async src>` anywhere in the tree are deduped and loaded once.

## Critical CSS

For a fast first paint, inline the CSS the first screen needs and load the rest without blocking:

- Frameworks and build tools handle this: SSR frameworks inline or link per-route CSS; for prerendered SPAs, `beasties` (the maintained successor to `critters`) extracts critical CSS at build time.
- The classic trick (`<link rel="stylesheet" media="print" onload="this.media='all'">`) needs a string `onload` attribute in the HTML document. JSX can't express it, and a React `onLoad` handler only attaches after hydration, too late to help. Put it in the HTML shell template or let the framework do it.
- CSS-in-JS libraries with SSR support extract the styles used during server rendering into the HTML; without that setup, styles arrive only after hydration and the page flashes unstyled.

## Server-side hints

- **`Link` response headers** (`Link: <https://cdn.example.com>; rel=preconnect`) reach the browser before the HTML body.
- **103 Early Hints** let a CDN or server send those `Link` headers while the page is still being generated, so connections and critical downloads start during server think-time. Support differs between browsers, CDNs and hosting platforms, and between `preconnect` and `preload` hints; check yours before relying on it.

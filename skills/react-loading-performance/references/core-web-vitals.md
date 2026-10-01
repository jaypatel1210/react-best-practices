# Core Web Vitals and the Performance API

## Contents

1. [The three metrics](#the-three-metrics)
2. [Supporting metrics](#supporting-metrics)
3. [Measuring real users](#measuring-real-users)
4. [The Performance API](#the-performance-api)
5. [Cause-to-fix table](#cause-to-fix-table)

## The three metrics

Each is judged at the **75th percentile** of page loads, separately for mobile and desktop.

| Metric | Good | Needs improvement | Poor |
|---|---|---|---|
| LCP | ≤ 2.5 s | ≤ 4 s | > 4 s |
| INP | ≤ 200 ms | ≤ 500 ms | > 500 ms |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |

### LCP: Largest Contentful Paint

- **What counts:** the largest image (including `<image>` in SVG, video posters and CSS `url()` backgrounds) or block of text rendered in the viewport. The browser updates the candidate as larger content renders, and stops at the first user input.
- **Its four parts:** time to first byte → resource load delay (how long after TTFB the LCP resource started downloading) → resource load duration → element render delay (from download finished to painted). For a text LCP, only the first and last apply.
- **React specifics:** in a client-rendered app, LCP can't happen before the JavaScript has downloaded and rendered, so SSR or static generation is usually the biggest single win. With streaming SSR, keep the LCP element in the shell, not behind a slow Suspense boundary.

### INP: Interaction to Next Paint

- **What counts:** clicks, taps and key presses (not hover or scroll). The reported value is close to the slowest interaction of the visit; on pages with many interactions, one outlier per 50 interactions is ignored.
- **Its three parts:** input delay (main thread busy when the user acted), processing (event handlers, plus the React render they trigger), presentation delay (style, layout and paint of the result).
- **React specifics:** updates from discrete events render synchronously before the next paint unless they're in a transition. Interactions during hydration wait for hydration. See `react-responsiveness`.
- INP replaced First Input Delay as a Core Web Vital in March 2024.

### CLS: Cumulative Layout Shift

- **Each shift scores** impact fraction (the share of the viewport affected) × distance fraction (the distance moved, relative to the viewport).
- **Shifts are grouped into session windows:** shifts less than 1 s apart, in a window of at most 5 s. CLS is the score of the *worst* window, not a lifetime total.
- **Not counted:** shifts within 500 ms of a discrete user input (an expanding accordion the user clicked), and changes made with `transform`.
- **React specifics:** a layout fix-up in `useLayoutEffect` happens before paint and never shows a shifted frame; the same fix in `useEffect` can be painted first and count. Size Suspense and lazy fallbacks like their content.

### Browser support

LCP and INP are reported by Chromium, Firefox and Safari (since Safari 26.2, December 2025). CLS is reported only by Chromium-based browsers, so CLS field data reflects Chromium users only.

## Supporting metrics

- **TTFB** (good ≤ 0.8 s): server, CDN and redirect time. It sets a floor under every other metric.
- **FCP** (good ≤ 1.8 s): first text or image painted. Useful for diagnosis, not a Core Web Vital.
- **TBT** (lab only): total time beyond 50 ms per long task between FCP and load. Lighthouse's proxy for INP; Time to Interactive was removed from Lighthouse scoring in v10.

## Measuring real users

```ts
// report-web-vitals.ts: import once, at app start
import { onCLS, onINP, onLCP, type Metric } from 'web-vitals/attribution';

function send(metric: Metric) {
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating, // 'good' | 'needs-improvement' | 'poor'
    id: metric.id,
    page: location.pathname,
    attribution: metric.attribution, // trim before sending if payload size matters
  });
  if (!navigator.sendBeacon?.('/analytics/vitals', body)) {
    fetch('/analytics/vitals', { method: 'POST', body, keepalive: true });
  }
}

onLCP(send);
onINP(send);
onCLS(send);
```

What attribution gives you:

- **LCP:** `target` (a selector for the element), `timeToFirstByte`, `resourceLoadDelay`, `resourceLoadDuration`, `elementRenderDelay`.
- **INP:** `interactionTarget`, `interactionType`, `inputDelay`, `processingDuration`, `presentationDelay`, `longAnimationFrameEntries`, and `longestScript` (which script ran longest).
- **CLS:** `largestShiftTarget`, `largestShiftValue`, `largestShiftTime`.

Notes:

- Metrics are reported when they're final, often when the page is hidden. Don't wait for `unload`; `sendBeacon` handles delivery.
- In Next.js, `useReportWebVitals` from `next/web-vitals` wires this up in a client component near the root.
- Aggregate by page template (product page, search page) rather than by full URL, and look at the 75th percentile.

## The Performance API

**User Timing** marks your own operations, and they appear in the DevTools Performance panel's *Timings* track:

```ts
performance.mark('import:start');
await importTransactions(file);
performance.mark('import:end');
const { duration } = performance.measure('import', 'import:start', 'import:end');
```

- Call it from event handlers and effects, never during render (render can run more than once).
- `performance.measure(name, { start, end, detail })` accepts an options object; `detail` carries custom data.
- Clear long-lived entries with `performance.clearMarks()` / `clearMeasures()`.

**`PerformanceObserver`** receives entries as they're recorded. Some types (`event`, `layout-shift`, `largest-contentful-paint`, `long-animation-frame`, `longtask`) are only available through an observer:

```ts
// Not in TypeScript's DOM typings yet; declare the fields you use.
type LongAnimationFrame = PerformanceEntry & {
  blockingDuration: number;
  scripts: { sourceURL: string; invoker: string; duration: number; forcedStyleAndLayoutDuration: number }[];
};

useEffect(() => {
  if (!PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) return;
  const observer = new PerformanceObserver((list) => {
    for (const frame of list.getEntries() as LongAnimationFrame[]) {
      if (frame.blockingDuration > 100) reportSlowFrame(frame);
    }
  });
  observer.observe({ type: 'long-animation-frame', buffered: true }); // buffered: include entries from before this ran
  return () => observer.disconnect();
}, []);
```

- **Long Animation Frames** (Chromium 123+) are the successor to `longtask` entries. Each entry has `duration`, `blockingDuration`, time spent in style and layout, and a `scripts` list with each script's `sourceURL`, `invoker` and `forcedStyleAndLayoutDuration`. That points directly at the code behind a slow interaction.
- **`longtask`** entries (Chromium only) say a task was long, but little about why.
- Observe once (at app start, or in one effect at the root), and disconnect in cleanup.
- React's own `<Profiler>` and Performance tracks measure component work; they don't write User Timing entries (`react-rerenders/references/measuring.md`).

## Cause-to-fix table

| Metric | Cause | Fix |
|---|---|---|
| LCP | Hero rendered only after JS and a client fetch | SSR/SSG or Server Components; data from a loader |
| LCP | Hero is a CSS background or chosen in JS | `<img>` in the HTML, or `preload` it |
| LCP | Hero has `loading="lazy"`, or competes with other images | Remove lazy; `fetchPriority="high"` |
| LCP | Oversized image | `srcSet`/`sizes`, AVIF/WebP, an image CDN |
| LCP | Render-blocking CSS and scripts | Smaller critical CSS; `defer`/`async`; fewer third-party scripts |
| LCP | Slow TTFB | Caching, CDN, streaming SSR, fewer redirects |
| INP | Long tasks when the user acts (hydration, third parties) | Code-split, defer third parties, yield (`react-responsiveness`) |
| INP | Expensive synchronous re-render after the input | Move state down, transitions, deferred values, `memo` |
| INP | Heavy computation in handlers | Chunk, or move to a worker |
| INP | Large DOM, forced layout | Virtualize (`react-large-lists`); batch reads and writes (`react-animation`) |
| CLS | Images, ads, embeds without reserved space | `width`/`height`, `aspect-ratio`, `min-height` |
| CLS | Web font swap | Fallback metric overrides, `font-display: optional` |
| CLS | Content inserted above what's being read | Reserve space; overlays; insert on user action |
| CLS | Layout switched after hydration | Same markup on server and first client render (`react-layout-portals`) |
| CLS | Animating `top`, `height`, `margin` | Animate `transform` |

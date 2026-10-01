---
name: react-large-lists
description: Render long lists, tables, feeds and long pages in React without jank, covering when to paginate, virtualize or let the browser skip offscreen work, windowing with TanStack Virtual, react-window or react-virtuoso (fixed and measured row sizes, overscan, keys, scroll containers, row state, accessibility and find-in-page trade-offs), CSS content-visibility with contain-intrinsic-size, IntersectionObserver for lazy mounting, infinite scroll and impressions, and CSS containment. Use when a list, grid or table with hundreds or thousands of items is slow to render, scroll or filter, when building infinite scroll or a feed, when a long page with many heavy sections is slow, or when reviewing code that maps a large array into JSX. Includes a tested useInView hook.
license: MIT
---

# Large Lists and Long Pages: Render What's on Screen

A list costs what React renders and the browser lays out, not what the user can see. Ten thousand rows mean ten thousand component renders, DOM nodes and layout boxes, even when twenty fit on screen. Before making each row cheaper, reduce how many rows exist.

## Choose the strategy

| Situation | Strategy |
|---|---|
| Up to a few hundred simple rows | Render them all; keep rows cheap (`memo` rows with stable props, see `react-memoization`) |
| Users browse results page by page | Server-side pagination or a "Load more" button: the cheapest and most accessible option |
| Thousands of rows in one scrolling view (tables, logs, chat history, large pickers) | Virtualization |
| A long page of heavy but finite sections (docs, settings, dashboards, long articles) | `content-visibility: auto` |
| An endless feed | Infinite scroll with a sentinel, virtualized once it grows |
| Heavy widgets far below the fold (charts, maps, embeds) | Mount them on approach with `IntersectionObserver` |

Profile the slow interaction first (`react-rerenders/references/measuring.md`). Time spent rendering rows calls for fewer rows. Time in *Layout* or *Recalculate Style* points to DOM size or CSS.

## Virtualization

A virtualizer renders only the rows inside the viewport plus a small buffer, positions them inside a spacer as tall as the full list, and swaps rows as the user scrolls.

- **Use a library**, and the one the project already has: TanStack Virtual (headless, lists, grids, window scrolling), react-window (simple, fixed or variable sizes), react-virtuoso (variable heights, chat, grouped lists).
- **Give it a bounded scroll container** (`height` or `max-height` with `overflow: auto`), or use window-scrolling mode. A virtualizer can't window a list whose container grows with its content.
- **Fixed row sizes are the fast path.** For variable sizes, let the library measure rendered rows (TanStack Virtual's `measureElement`) and provide an `estimateSize` close to the average, or the scrollbar jumps as rows get measured.
- **Keys come from data IDs, not the virtual index** (`getItemKey` in TanStack Virtual). Index keys make React reuse one row's instance for another row as you scroll (`react-reconciliation`).
- **Keep overscan modest** (a few rows each way). It hides blank gaps during fast scrolling; too much brings the rendering cost back.
- **Memoize rows and keep their props stable.** Scrolling re-renders the list component whenever the window moves. `memo` rows mean only newly visible rows actually render.
- **Rows unmount when they scroll away.** Keep row state (expanded, selected, draft edits) in the parent or a store, keyed by ID, or it resets.
- **Scroll with the virtualizer's API** (`scrollToIndex`). The target row may not exist in the DOM, so `element.scrollIntoView` can't reach it.

Know the trade-offs. Browser find-in-page can't find rows that aren't rendered. Screen readers only see rendered rows, so expose the real size with `aria-rowcount` and `aria-rowindex` on grids, or `aria-setsize` and `aria-posinset` on lists. Printing and crawlers see a fragment. When these matter more than speed, paginate or use `content-visibility`.

## `content-visibility: auto`

`content-visibility: auto` lets the browser skip style, layout and paint for an element's contents while it's far from the viewport, and do that work as it approaches.

- **Always pair it with `contain-intrinsic-size`**, for example `contain-intrinsic-size: auto 480px`. Without a placeholder size, skipped sections collapse, and the scrollbar lurches as each one renders. `auto` makes the browser remember the last rendered size.
- **Apply it to large, independent blocks** (page sections, cards, long list items), not to tiny elements, and not to what's visible on load.
- **It saves browser work, not React work.** Components still render and mount, and the DOM stays in memory, which is why anchor links and the accessibility tree keep working, and find-in-page does in most browsers. It fits dozens of heavy sections; it doesn't replace virtualization for ten thousand rows.
- **Pause work in skipped sections** (canvas drawing, animations, polling) with the `contentvisibilityautostatechange` event, whose `skipped` flag says whether the section is being skipped.
- **It adds containment, even while visible.** The element always gets layout, style and paint containment (plus size containment while skipped). Paint containment clips anything that overflows the box, such as shadows, badges and dropdowns, and makes the element the containing block for `position: fixed` descendants. Render overlays in a portal (`react-layout-portals`).
- **Support:** Baseline since September 2025. Safari 18 to 25 apply it, but find-in-page doesn't search skipped content there. Browsers without it render normally, so it's a safe progressive enhancement.

## `IntersectionObserver`

Use it to mount heavy sections as they approach, trigger infinite scroll, record impressions, pause offscreen video or animation, and highlight the active section.

- **For plain images and iframes, use `loading="lazy"`** (Baseline since late 2023): it's the browser's built-in observer. Reach for `IntersectionObserver` for components, such as charts, maps, embeds and feeds.
- **Prefer it to scroll listeners.** A scroll handler that calls `getBoundingClientRect` runs for every scroll event and can force layout when mixed with style changes. Observer callbacks are asynchronous and batched by the browser.
- **Start early with `rootMargin`** (`'300px 0px'`) so content is ready when it scrolls in, and use `threshold` for "at least half visible" rules such as impressions.
- **Set `root` to the scroll container** when the list scrolls inside an element. With the viewport as root, the container still clips its targets, so a `rootMargin` meant to start loading early has no effect.
- **Disconnect on unmount**, and stop observing after the first hit for one-shot work (lazy mounting, impressions).
- **Reserve space** for content mounted later (`min-height`), or it shifts layout, and a zero-height sentinel may sit permanently in view.
- **Many targets:** one observer can watch many elements. For hundreds of targets, share an observer per option set (as `react-intersection-observer` does) instead of creating one per element.

`assets/use-in-view.ts` wraps this for components:

```tsx
function LazyRevenueChart(props: RevenueChartProps) {
  const [ref, inView] = useInView<HTMLDivElement>({ rootMargin: '300px 0px', once: true });
  return (
    <div ref={ref} style={{ minHeight: 320 }}>
      {inView ? <RevenueChart {...props} /> : null}
    </div>
  );
}
```

## Infinite scroll

- **Put a sentinel after the last item** and request the next page when it enters an expanded root margin. With TanStack Query, drive it from `useInfiniteQuery` (`fetchNextPage`, `hasNextPage`, `isFetchingNextPage`).
- **Guard the trigger:** skip it while a page is loading, when there are no more pages, and after an error. Show a retry button instead of re-firing in a loop.
- **Virtualize once the list grows.** Trigger the next page from the last virtual item's index instead of a DOM sentinel.
- **Keep it usable:** a "Load more" button as a keyboard and assistive-tech alternative, scroll position restored on back navigation, and footer links available elsewhere, because an endless list makes the footer unreachable.

## CSS containment for busy widgets

React skipping a render doesn't stop the browser from recalculating layout around a DOM change. `contain: content` (layout, paint and style containment) on a self-contained widget that updates often, such as a socket-fed status panel, a chat panel or a card in a grid, keeps its internal changes from invalidating the rest of the page. It has the same side effects as `content-visibility` (clipping, a containing block for fixed-position descendants), and a contained box without a fixed size still pushes its neighbors when its own size changes. Details: `react-animation/references/rendering-pipeline.md`.

## Review checklist

- [ ] Lists that can grow past a few hundred rows are paginated or virtualized.
- [ ] Virtualized lists have a bounded scroll container, data-ID keys, fixed or measured sizes, modest overscan and memoized rows.
- [ ] Row state lives outside the rows, keyed by ID.
- [ ] Long pages of heavy sections use `content-visibility: auto` with `contain-intrinsic-size`.
- [ ] Visibility checks use `IntersectionObserver`, not scroll listeners; observers are disconnected, and `rootMargin` starts work early.
- [ ] Infinite scroll can't fire duplicate or looping requests, and has error and end states.
- [ ] Lazily mounted content has reserved space.

## Examples

- `examples/virtualized-table.md`: a 20,000-row audit log virtualized with TanStack Virtual, from fixed to measured row heights, with a sticky header, lifted row state, jump-to-row and accessibility attributes.
- `examples/infinite-feed.md`: an activity feed with `useInfiniteQuery`, a sentinel observed with `useInView`, request guards, error recovery, and switching to virtualization as it grows.
- `examples/long-pages.md`: a long settings page with `content-visibility`, its clipping and scrollbar pitfalls, and lazily mounted embeds.

## Assets

- `assets/use-in-view.ts`: `useInView(options)` returns `[ref, inView]`. Options: `root`, `rootMargin`, `threshold`, `once`, `initialInView`. It's a callback ref, so it follows conditionally rendered elements. Requires React 18+, has no dependencies, and is covered by the repository's `tests/`.

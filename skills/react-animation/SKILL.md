---
name: react-animation
description: Smooth animations and cheap style and layout work in React, covering which CSS properties trigger layout, paint or only compositing, choosing what drives an animation (CSS, the Web Animations API, per-frame JavaScript through refs, a motion library), will-change and layer costs, forced synchronous layout and layout thrashing (including across layout effects), FLIP for reorders and size changes, View Transitions with document.startViewTransition and React's ViewTransition component, prefers-reduced-motion, and the runtime cost of CSS-in-JS for dynamic styles. Use when an animation, transition, drag or scroll effect stutters, when animating list reorders, layout changes or page and tab transitions, when the Performance panel shows long Layout, Recalculate Style or Paint work, or when styles change on every render (styled-components, Emotion, inline style objects driven by state).
license: MIT
---

# Animation and Styling Performance

Smooth motion needs a new frame every 16.7 ms on a 60 Hz screen, or 8.3 ms at 120 Hz, and that budget is shared with React rendering, your handlers and the browser's own work. Two decisions set the cost of any animation: **which property changes**, and **what drives the change**.

## Which properties are cheap

After a style change, the browser recalculates styles, then may redo **layout** (geometry), **paint** (pixels) and **compositing** (assembling layers):

| Changing… | Costs |
|---|---|
| Size, position, margins, fonts, flex or grid layout (`width`, `height`, `top`, `left`, `padding`, `font-size`) | Layout, paint and compositing |
| Colors, backgrounds, shadows, border radius, outlines | Paint and compositing |
| `transform` (including `translate`, `scale`, `rotate`) and `opacity` | Compositing only |

- **Animate `transform` and `opacity`.** Move with `translate` instead of `top`/`left`. Grow with `scale` instead of `width`/`height` (counter-scale children whose text would stretch). Fade a pseudo-element that carries a big shadow instead of animating the blur.
- **Declarative compositor animations survive a busy main thread.** A CSS or Web Animations API animation of `transform` or `opacity` keeps running while React renders, hydrates or garbage-collects. Anything that needs layout, paint or per-frame JavaScript freezes. That's why loading indicators shown during heavy work must be CSS or WAAPI animations of those two properties.
- **Animating layout properties is sometimes fine:** a small, isolated element (ideally inside `contain: layout paint`), for a short time. It's never fine on large containers or on many elements at once.
- `filter` and `clip-path` are composited in some browsers and some cases only. Measure before relying on them.

Property tables, layer costs and DevTools workflows are in `references/rendering-pipeline.md`.

## Pick the driver

| Motion | Driver |
|---|---|
| State-to-state changes (hover, open, selected, enter and exit) | CSS transitions or keyframes, toggled by a class or data attribute |
| Imperative, interruptible or sequenced motion (shake on error, play, reverse, await completion) | The Web Animations API: `el.animate()` through a ref |
| Springs, physics, gestures, velocity, scroll-linked values | Per-frame JavaScript that writes styles **through refs**, or a motion library that does (Motion's motion values) |
| Reorders and layout changes | FLIP, or View Transitions |

**Never drive per-frame motion through React state.** Sixty `setState` calls per second re-render the component and its subtree sixty times per second, competing with the animation for the same frame. Write `transform` or a CSS custom property to the element in a `requestAnimationFrame` callback, and commit the final value to state when the gesture ends (`react-responsiveness` has a tested frame-throttling hook).

**Per-frame JavaScript must be frame-rate independent.** Use the timestamp passed to the `requestAnimationFrame` callback to compute the time since the last frame, and move by `velocity × elapsed`, so motion runs at the same speed on 60, 120 and 144 Hz screens and when frames drop. Clamp the elapsed time when a background tab comes back, or objects jump. Don't animate with `setInterval`: it isn't aligned with the display refresh, so motion judders.

**Web Animations API in React:** start animations from event handlers or effects through a ref, keep the returned `Animation`, and `cancel()` it in the effect's cleanup. Persist the end state by setting the final style (or calling `commitStyles()` then `cancel()`), rather than leaving `fill: 'forwards'` animations alive, because those keep overriding later style changes.

## `will-change` and layers

- Composited elements get their own layer. Layers are created by running `transform`/`opacity` animations, `will-change`, 3D transforms, and by overlapping another composited layer, which can multiply them unexpectedly.
- **Each layer costs memory**: roughly width × height × devicePixelRatio² × 4 bytes. A 1000 × 1000 element on a 2× display is about 16 MB.
- Add `will-change: transform` shortly before an animation that would otherwise stutter on its first frame, and remove it afterwards. Don't put it on many elements or leave it in a stylesheet "for performance".
- `will-change: transform` (or `filter`) also creates a stacking context and a containing block for fixed-position descendants, and `will-change: opacity` creates a stacking context. These are the same traps that break overlays (`react-layout-portals`).

## Avoid forced layout

Reading a layout value after a style or DOM write forces the browser to lay out synchronously, mid-script:

- Reads that force layout: `offsetWidth`/`offsetHeight`/`offsetTop`, `clientWidth`, `scrollWidth`, `scrollTop`, `getBoundingClientRect()`, `getComputedStyle()`, `innerText`, `focus()`, and others.
- **Alternating reads and writes over N elements costs N layouts in one frame (thrashing).** Read everything first, then write everything:

```tsx
useLayoutEffect(() => {
  const cards = [...gridRef.current!.querySelectorAll<HTMLElement>('[data-card]')];
  const tallest = Math.max(...cards.map((card) => card.scrollHeight)); // all reads
  cards.forEach((card) => card.style.setProperty('--row-height', `${tallest}px`)); // all writes
}, [items]);
```

- **The React version of thrashing:** many components each measuring and adjusting themselves in their own `useLayoutEffect` (a per-row "measure me" hook). React runs all layout effects in one commit, so the reads and writes interleave across components. Measure once in the parent, let CSS do it (grid, `subgrid`, container queries), or use `ResizeObserver`, which reports sizes after layout without forcing one.
- The Performance panel marks forced reflows and points to the line of JavaScript that caused each one.

## FLIP: animating layout changes

CSS can't animate an element moving to a new slot after a reorder, a filter or a layout switch, because no animated property changes. FLIP turns that move into a transform:

1. **First:** record each element's rectangle before the change.
2. **Last:** after React commits the change, in `useLayoutEffect` (before paint), record the new rectangles.
3. **Invert:** apply a transform that puts each element back where it was.
4. **Play:** animate that transform to `none`, ideally with `el.animate()`.

Rules: key elements by stable data IDs (with index keys the DOM nodes don't move, so nothing animates; see `react-reconciliation`), skip the animation for reduced-motion users, and cancel running animations before measuring. Prefer a library that already handles interruptions, scroll and nested transforms when the project allows one (Motion's `layout` prop, auto-animate, GSAP Flip), or View Transitions. A full implementation is in `examples/flip-and-view-transitions.md`.

## View Transitions

The browser captures an image of the current UI, applies your DOM update, captures the result, and animates from one capture to the other through pseudo-elements you can style (`::view-transition-old(name)`, `::view-transition-new(name)`). Elements with a `view-transition-name` morph between their old and new position and size; the rest of the page cross-fades.

- **React 19.3+:** wrap content in `<ViewTransition>`. It activates only for updates inside `startTransition`, `useDeferredValue`, Actions, or a Suspense boundary revealing its content; urgent updates don't animate. `name` pairs a shared element across the change, and `enter`, `exit`, `update` and `share` take CSS class names (or a map per transition type). Call `addTransitionType('forward')` inside `startTransition` to pick a direction-specific animation.
- **Older React, or code outside React:** `document.startViewTransition(() => flushSync(() => setState(next)))`. Without `flushSync`, React hasn't committed the update when the callback returns, so the "new" snapshot shows the old UI.
- **Names must be unique** among captured elements. A duplicate skips the animation (the DOM update still happens), so build names from IDs.
- **Keep the update fast.** Rendering is paused between snapshots, so fetch data *before* starting the transition, not inside it.
- **Mind the count.** Each named element is captured separately, and morphing groups animate size, which is layout work. Name only the elements that need to travel.
- **Support:** same-document view transitions are Baseline since October 2025. Feature-detect `document.startViewTransition` and fall back to an instant update. Cross-document transitions (`@view-transition { navigation: auto }`) work in Chromium and Safari but not Firefox.

## Respect reduced motion

Honor `prefers-reduced-motion: reduce`: remove large movement, parallax and zooms, and keep short fades if they help understanding. Do it in CSS (`@media (prefers-reduced-motion: reduce)`), or read it in JavaScript with `matchMedia` through `useSyncExternalStore` (`react-rerenders/examples/hooks-that-hide-state.md` has a `useMediaQuery`) and skip `el.animate()` and View Transitions.

## Dynamic styles and CSS-in-JS

Runtime CSS-in-JS (styled-components, Emotion, the `css` prop) serializes and hashes styles during render, and inserts a new rule for every distinct value it sees. Rules are never removed. Choose the technique by how often a value changes:

| Value changes… | Technique |
|---|---|
| Never | A static class or a style object at module scope |
| Between a few variants (size, tone, state) | One class per variant, picked by lookup or a data attribute |
| Continuously (a drag offset, a progress percentage, a resizable width) | One static rule that reads `var(--x)`, plus `style={{ '--x': value }}` |
| Every animation frame | Skip React: write it through a ref, or use a CSS or WAAPI animation |

- **Interpolating a continuous value** (`${(p) => p.$width}px`) creates one class per value. The stylesheet grows without limit and style recalculation slows down. styled-components warns once a component generates more than 200 classes.
- **Hoist static styles** out of components. A `css` object or `styled` call inside a component body redoes the work each render (and `styled` in render also remounts, see `react-reconciliation`).
- **Runtime CSS-in-JS works only in Client Components.** In the Next.js App Router it needs a style registry for SSR. Build-time options (CSS Modules, Tailwind, vanilla-extract, Linaria, Panda, StyleX) have no runtime cost and turn dynamic values into custom properties.

## Review checklist

- [ ] Animations change `transform` and `opacity`, not layout properties of large or numerous elements.
- [ ] Nothing animates by calling `setState` every frame; per-frame values go through refs, CSS or WAAPI.
- [ ] Indicators shown during heavy work are CSS or WAAPI animations of `transform`/`opacity`.
- [ ] `will-change` is temporary and rare.
- [ ] Layout reads and writes are batched; no per-item measure-and-adjust layout effects.
- [ ] Reorder animations use stable keys and FLIP or View Transitions; WAAPI animations are cancelled in cleanup.
- [ ] View transitions use unique names, start after data is ready, and are feature-detected.
- [ ] Reduced motion is respected.
- [ ] Continuously changing style values use custom properties or inline styles, not new CSS-in-JS classes per value.

## Examples

- `examples/choosing-what-to-animate.md`: an expanding panel, a toast, a spinner that keeps spinning during a heavy render, an error shake with WAAPI and cleanup, and reduced motion.
- `examples/flip-and-view-transitions.md`: a re-sorting leaderboard animated with FLIP, then a grid/list layout switch and paged navigation with `<ViewTransition>`, with a fallback for older React.
- `examples/dynamic-styles.md`: a resizable column and a progress bar moved from per-value CSS-in-JS classes to custom properties, variants by lookup, and frame-rate values through refs.

## References

- `references/rendering-pipeline.md`: what each stage costs, which properties trigger it, layer memory, containment, and how to read the DevTools Performance, Rendering and Layers tools.

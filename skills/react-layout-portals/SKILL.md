---
name: react-layout-portals
description: Build measured UI and overlays correctly in React, covering useLayoutEffect versus useEffect for DOM measurement and flicker, SSR and hydration-safe measurement, CSS positioning, stacking contexts and containing blocks, and portals for modals, tooltips, dropdowns, popovers and toasts. Use when UI flickers or jumps right after mount, when size or position depends on real DOM measurements, when a modal or tooltip is clipped, mispositioned or hidden under other content (z-index not working), when events or form submits behave oddly inside a portal, or when building any overlay component.
license: MIT
---

# Measured UI and Overlays: `useLayoutEffect`, Stacking Contexts, Portals

This skill covers the web (`react-dom`). On React Native, use the platform `Modal` or a portal library, and skip the CSS sections.

## Measure before paint

Some layouts can only be decided after the browser measures real sizes:

- a chip list that shows "+3 more";
- a toolbar that moves overflowing actions into a menu;
- a tooltip that flips when it would leave the viewport;
- auto-growing text areas;
- scroll restoration.

The flow is always: render, measure the DOM, set state, re-render adjusted.

- **With `useEffect`**, the browser usually paints the first, unadjusted render, then the adjusted one. Users see a flash or jump, especially on slow devices.
- **With `useLayoutEffect`**, React runs the effect after DOM mutations but *before the browser paints*. State updates inside it are processed synchronously before paint, so the user sees only the final layout.
- **The cost:** layout effects block painting. Keep them small: read the measurements you need, compute, set state. Never fetch or do heavy work there. Everything that doesn't affect the first visible frame belongs in `useEffect`, or in no effect at all.
- **Re-measure with `ResizeObserver`** on the element rather than listening for window resize. Containers change size when fonts load, sidebars collapse, or content changes.
- **Batch reads before writes.** Reading layout (`getBoundingClientRect`, `offsetWidth`) after writing styles in a loop forces repeated synchronous layout.
- **Prefer CSS when it can do the job**: flex-wrap with overflow, container queries, `line-clamp`, `text-overflow`, CSS anchor positioning where supported. CSS doesn't flicker, works with SSR, and costs no JavaScript.

## SSR and hydration

- **Effects don't run on the server**, including layout effects. In SSR apps, users first see the *unmeasured* render, until JavaScript loads and hydrates, so the flicker returns.
- **Decide what the server should render**: an acceptable default layout (the first N items, a skeleton, or the measured part hidden). Adjust on the client.
- **For client-only content, switch after mount.** Render a fallback on the server *and* on the first client render, then the real thing:

  ```tsx
  const emptySubscribe = () => () => {};
  function useIsClient() {
    return useSyncExternalStore(emptySubscribe, () => true, () => false);
  }
  ```

- **Never branch on `typeof window !== 'undefined'` in render** (or on `localStorage`, `navigator`, `Date.now()`, random values) to produce different markup. The server HTML and the first client render will differ, causing hydration errors and mismatched content.
- **Framework escape hatches:** Next.js `dynamic(() => import('./Widget'), { ssr: false })` for client-only widgets.

## Why overlays break

- **`position: absolute` is relative to the nearest positioned ancestor**, not the page. A modal "centered" with `absolute` ends up centered in whichever container happens to have `position: relative`.
- **`position: fixed` is relative to the viewport, unless an ancestor forms a containing block for it.** This happens with:
  - `transform`, `translate`, `rotate`, `scale` or `perspective`;
  - `filter` or `backdrop-filter`;
  - `contain: layout|paint|strict|content`;
  - `content-visibility: auto`;
  - `will-change` naming one of those.

  The "fixed" element then positions and scrolls relative to that ancestor.
- **Clipping.** An ancestor with `overflow: hidden|auto|scroll|clip` clips descendants whose containing block is inside it. Positioned elements escape only if their containing block lies outside the overflow container.
- **Stacking contexts.** `z-index` only competes within one stacking context. New contexts are created by (among others):
  - a positioned element with a `z-index` other than `auto`;
  - `position: fixed` or `sticky`;
  - `opacity < 1`;
  - `transform`, `filter`, `backdrop-filter`, `perspective`, `clip-path`, `mask`;
  - `isolation: isolate`, `mix-blend-mode`;
  - `will-change` naming one of those;
  - flex or grid items with a `z-index`;
  - `contain: layout|paint`.

  If an ancestor's stacking context sits below a sibling (a sticky header with `z-index: 10`, say), nothing inside it can rise above that sibling. `z-index: 999999` doesn't help.
- **Common real-world traps:** sticky headers with `z-index`, sidebars animated with `transform`, cards with hover transforms, scroll containers with `overflow: auto`.

## Portals

`createPortal(children, domNode)` renders into another DOM node, usually `document.body` or a dedicated `#overlay-root`. That escapes ancestors' stacking contexts, clipping and containing blocks.

**React behavior follows the React tree:**

- The portal re-renders with its parent, reads the parent's context, and unmounts with it.
- **Synthetic events bubble through React ancestors, not DOM ancestors.** A click inside a portaled menu reaches `onClick` handlers on the components above it, such as a table row that opened the menu. Stop propagation at the overlay root if that's unwanted.

**DOM behavior follows the DOM:**

- CSS descendant selectors (`.card .menu`) and inherited styles from the original parent don't apply. Style the overlay directly, and define design tokens at `:root`.
- Native listeners on ancestors (`addEventListener`) don't see events from inside the portal.
- `contains`, `closest` and `parentElement` from the trigger's container don't find the portal's content. Click-outside logic must also check the portal node.
- **Form submission is native.** A submit button inside a portal doesn't submit a `<form>` that wraps the trigger. Put the `<form>` inside the overlay.
- Focus order and screen readers follow the DOM. Move focus into the overlay, trap it for modals, restore it on close, and set ARIA roles and labels.

**On the server,** `document` doesn't exist. Create portals only on the client, after mount or when the overlay opens.

## The top layer: the platform alternative

A `<dialog>` opened with `showModal()`, and an element with the `popover` attribute when shown, are rendered in the browser's **top layer**. That puts them above everything, regardless of `z-index` and stacking contexts, and they aren't clipped by ancestors. A modal `<dialog>` also makes the rest of the page inert and closes on Esc. They stay inside your component's DOM, so no portal is needed.

Browser support, as of 2026:

- A modal `<dialog>` is widely available.
- The Popover API is Baseline (newly available since early 2025). Check the project's support targets.
- CSS anchor positioning ships in current Chromium, Safari and Firefox, but isn't Baseline yet. Use it as a progressive enhancement, with a JavaScript positioning fallback.

## Build or reuse?

Overlays are deceptively hard: focus trapping, scroll locking, Esc and outside-click handling, collision-aware positioning, animations, accessibility. If the project has a UI library or headless primitives (Radix, React Aria, Headless UI, Ark, MUI, or Floating UI for positioning), use them. Hand-roll only simple overlays, following the checklist below.

## Overlay checklist

- [ ] Rendered through a portal (to `body` or `#overlay-root`) or in the top layer.
- [ ] Positioned against the viewport, or from the trigger's `getBoundingClientRect()` measured in `useLayoutEffect`. Recomputed on scroll and resize while open.
- [ ] Styled without relying on ancestor selectors; tokens available at `:root`.
- [ ] Clicks inside don't trigger unwanted ancestor handlers; outside-click detection includes the portal node.
- [ ] Any `<form>` lives inside the overlay.
- [ ] Focus moves in, is trapped for modals, and returns to the trigger on close. Esc closes. ARIA roles and labels are set.
- [ ] SSR-safe: no `document` access during server render.

## Examples

- `examples/measure-before-paint.md`: a "+N more" chip list with `useLayoutEffect` and `ResizeObserver`, a tooltip that flips, and SSR-safe defaults.
- `examples/portals-and-overlays.md`: the stacking-context trap in a real layout, a portal modal, the event-bubbling surprise, forms, click-outside, and native `<dialog>`.

## References

- `references/positioning-and-stacking.md`: a CSS cheat sheet for positioning, containing blocks, clipping and stacking contexts, with DevTools debugging steps.

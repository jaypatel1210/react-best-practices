# CSS Positioning, Containing Blocks, Clipping and Stacking: Cheat Sheet

## Contents

1. [Positioning schemes](#positioning-schemes)
2. [Containing blocks](#containing-blocks)
3. [Clipping by overflow](#clipping-by-overflow)
4. [Stacking contexts](#stacking-contexts)
5. [Debugging in DevTools](#debugging-in-devtools)
6. [Decision guide for overlays](#decision-guide-for-overlays)

## Positioning schemes

| `position` | In normal flow? | Positioned relative to | Typical use |
|---|---|---|---|
| `static` (default) | Yes | — | Everything |
| `relative` | Yes (space kept) | Its own normal position | Offsets; making an element the anchor for absolute children |
| `absolute` | No | The containing block: nearest ancestor with `position` other than `static` (or a transform/filter/… ancestor) | Badges, dropdowns *inside* a positioned wrapper |
| `fixed` | No | The viewport, unless an ancestor forms a containing block for fixed elements | Viewport-level overlays (if no such ancestor) |
| `sticky` | Yes, until the threshold | The nearest scrolling ancestor | Sticky headers and table heads |

## Containing blocks

An element's containing block decides what its `top`/`left`/`width: 100%` mean.

- **For `absolute`**: the nearest ancestor with `position` other than `static`, or any ancestor that also forms a fixed containing block (below).
- **For `fixed`**: the viewport, *unless* an ancestor has any of:
  - `transform` or `perspective` other than `none` (also the individual `translate`, `rotate`, `scale` properties);
  - `filter` or `backdrop-filter` other than `none`;
  - `contain` of `layout`, `paint`, `strict` or `content`;
  - `content-visibility: auto`;
  - `will-change` naming one of the properties above.

  Then `fixed` behaves like `absolute` relative to that ancestor, and scrolls with it.

## Clipping by overflow

- `overflow: hidden | auto | scroll | clip` on an element clips its content. For positioned descendants, only those whose containing block is the overflow element or something inside it get clipped.
- An `absolute` child of an `overflow: hidden` element *escapes* the clip if its containing block is further up, meaning the overflow element and everything between them are unpositioned. It *is* clipped once the overflow element (or an element inside it) is positioned.
- A `fixed` element escapes overflow clipping unless a containing-block-forming ancestor (transform, filter, …) sits inside the overflow container.

## Stacking contexts

Painting order is decided per stacking context. `z-index` compares only elements in the same context. A child can never be painted above something its ancestor context is below.

Common ways to create a stacking context:

- the root element (`<html>`);
- `position: absolute | relative` with `z-index` other than `auto`;
- `position: fixed | sticky`;
- flex or grid items with `z-index` other than `auto`;
- `opacity` below 1;
- `transform`, `translate`, `rotate`, `scale`, `perspective`, `filter`, `backdrop-filter`, `clip-path`, or `mask` other than `none`;
- `mix-blend-mode` other than `normal`;
- `isolation: isolate`;
- `contain: layout | paint | strict | content`;
- `container-type: size | inline-size`;
- `will-change` naming a property that creates a stacking context;
- elements in the top layer (modal `<dialog>`, open popovers, fullscreen elements) and their `::backdrop`.

Top-layer elements are painted as if they were children of the root, above everything else. Their containing block is the viewport, and ancestors' `overflow`, `opacity`, `transform` or stacking contexts don't affect them. That's why `<dialog>.showModal()` and `popover` escape every trap described above.

Within one stacking context, from back to front:

1. The context's background and borders.
2. Descendants with negative `z-index`.
3. Non-positioned block content.
4. Floats.
5. Inline content.
6. Positioned descendants with `z-index: auto` or `0`, in DOM order.
7. Positive `z-index`, in ascending order.

## Debugging in DevTools

1. **Find the overlay's ancestors.** Select the overlay in Elements and walk up the tree. For each ancestor, look for `transform`, `filter`, `opacity`, `will-change`, `position` + `z-index`, `overflow` and `contain` in the Computed pane.
2. **Use the Layers panel** (Chrome: More tools → Layers) or the 3D view (Edge) to see stacking and compositing layers.
3. **Experiment:** temporarily untick suspicious properties on ancestors. If the overlay jumps into place, you found the context or containing block that traps it.
4. **Check scroll containers:** an ancestor with `overflow: auto` plus `position: relative` clips absolutely positioned popups.

## Decision guide for overlays

| Overlay | Recommended approach |
|---|---|
| Modal dialog | `<dialog>` + `showModal()`, a portal to `body`, or the UI library's Dialog |
| Dropdown, menu, select listbox | The UI library's primitive; otherwise a portal plus `position: fixed` from the trigger's rect (Floating UI for collisions), or `popover` |
| Tooltip | Portal plus fixed positioning measured in `useLayoutEffect`, or a library; CSS anchor positioning where supported |
| Toasts and notifications | One portaled region at the end of `body` (or `popover="manual"`) |
| In-flow badge or inline expandable panel | No portal: `position: absolute` inside a `position: relative` wrapper, or normal flow |

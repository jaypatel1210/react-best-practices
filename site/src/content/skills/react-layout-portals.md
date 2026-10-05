---
title: "Layout and portals"
headline: "Measure before the browser paints, and render overlays where no ancestor can trap them."
description: "Stop flicker with useLayoutEffect, measure safely with SSR, and build modals, tooltips and menus that escape stacking contexts, clipping and portal event surprises."
group: ui
rules:
  - "Measure-then-adjust layout belongs in useLayoutEffect, which runs before the browser paints."
  - "Keep layout effects small: read, compute, set state. Everything else goes in useEffect."
  - "Render the same markup on the server and on the first client render, then switch to the measured layout."
  - "z-index only competes inside one stacking context, so no number can lift an overlay out of a trapped ancestor."
  - "A transform, filter or contain on an ancestor makes it the containing block for position: fixed."
  - "Render overlays through a portal, or in the browser's top layer with dialog or popover."
  - "A portal moves the DOM, not the React tree: synthetic events still bubble to React ancestors."
prompts:
  - "The modal is hidden under the sticky header, even with z-index 9999."
  - "This tooltip flashes in the wrong spot before it moves into place."
  - "Clicking an item in the row's dropdown also opens the row."
  - "Build a popover that flips below the button when there's no room above."
---

Some UI can only be laid out after the browser measures it: a chip list that collapses into "+3", a toolbar that moves overflowing actions into a menu, a tooltip that flips when it would leave the screen. This skill teaches Claude to measure and adjust in `useLayoutEffect`, so users never see the unadjusted frame, to re-measure with `ResizeObserver` when the container changes size, and to give server-rendered pages an acceptable layout before any JavaScript runs.

It also explains why overlays break. Claude checks what an overlay's ancestors do to it: a `transform` that captures `position: fixed`, an `overflow` that clips it, a stacking context that caps its `z-index`. Then it renders the overlay through a portal, or as a native `<dialog>` or `popover`, instead of escalating `z-index`.

Portals bring their own surprises, because React and the DOM disagree about where the content lives. The skill walks Claude through each one: clicks that bubble to a row's handler, click-outside checks that miss the portal, forms that don't submit, and styles that stop matching. When the project already has overlay primitives, Claude uses them, since focus trapping and collision-aware positioning are easy to get wrong.

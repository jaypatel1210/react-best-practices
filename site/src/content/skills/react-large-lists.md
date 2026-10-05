---
title: "Large lists"
headline: "Render what's on screen: virtualize long lists, let the browser skip offscreen sections, and load more without loops."
description: "Render long lists, tables and feeds without jank: virtualization, content-visibility for long pages, lazy mounting with IntersectionObserver, and guarded infinite scroll."
group: speed
rules:
  - "A list costs what React renders and the browser lays out, not what fits on screen."
  - "Past a few hundred rows in one view, paginate or virtualize."
  - "A virtualizer needs a bounded scroll container, data-ID keys, fixed or measured sizes and modest overscan."
  - "Rows unmount when they scroll away, so keep row state in the parent, keyed by ID."
  - "For long pages of heavy sections, pair content-visibility: auto with contain-intrinsic-size."
  - "Use IntersectionObserver, not scroll listeners, and start early with rootMargin."
  - "Guard infinite scroll on loading, end and error states, and keep a Load more button."
prompts:
  - "This audit log has 20,000 rows and takes seconds to render. Can you virtualize it?"
  - "Our infinite feed sometimes loads the same page twice."
  - "The settings page has 40 sections and scrolling stutters."
---

Ten thousand rows mean ten thousand component renders, DOM nodes and layout boxes, even when twenty fit on screen. This skill teaches Claude to reduce how many rows exist before trying to make each row cheaper, and to choose the right strategy for the shape of the data: pagination, virtualization, `content-visibility`, or mounting on approach.

When Claude virtualizes, it uses the library the project already has, such as TanStack Virtual, react-window or react-virtuoso, with a bounded scroll container, keys from data IDs, memoized rows, lifted row state and the ARIA attributes that tell assistive technology the list's real size. It's upfront about the trade-offs too: find-in-page, printing and screen readers see only the rendered rows.

For long pages that must stay fully in the DOM, Claude reaches for CSS containment and fixes what it breaks, such as clipped dropdowns and jumpy scrollbars. For feeds, it builds infinite scroll that can't fire duplicate or looping requests, with error, end and keyboard-friendly states. A tested `useInView` hook ships with the skill.

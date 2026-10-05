---
title: "Animation"
headline: "Animate what the compositor can run on its own, and keep React state out of every frame."
description: "Smooth React animation: animate transform and opacity, keep per-frame updates out of state, animate reorders with FLIP or View Transitions, and avoid CSS-in-JS churn."
group: ui
rules:
  - "Animate transform and opacity. Width, height, top and left trigger layout on every frame."
  - "Never drive per-frame motion through setState. Use CSS, the Web Animations API, or refs in requestAnimationFrame."
  - "Indicators shown during heavy work must be CSS or Web Animations API animations of transform or opacity."
  - "Read all layout values first, then write all styles, so the browser lays out once per frame."
  - "Animate reorders with FLIP or View Transitions, and key the items by stable IDs."
  - "Give continuously changing style values a CSS custom property, not a new CSS-in-JS class."
  - "Honor prefers-reduced-motion, and keep will-change temporary and rare."
prompts:
  - "This accordion stutters when it opens. Can you make it smooth?"
  - "The loading spinner freezes while the report renders."
  - "Animate the leaderboard rows when their rank changes."
  - "Resizing a table column with styled-components is slow."
---

A smooth animation needs a new frame every 16.7 ms on a 60 Hz screen, and React rendering, your handlers and the browser's own work all compete for that budget. This skill teaches Claude to settle two questions for every animation: which property changes, and what drives the change. It moves motion onto `transform` and `opacity`, which the browser can composite without layout or paint, and it picks CSS, the Web Animations API or ref-driven frame callbacks over a `setState` call on every frame.

For layout changes that CSS can't animate directly, such as a list re-sorting or a grid switching to a list, Claude reaches for FLIP or View Transitions, using `<ViewTransition>` on React 19.3+ and a `flushSync` fallback on older versions. It also looks for forced synchronous layout, where reads and writes interleave across rows or across layout effects, and batches them.

The skill covers the cost of styling too. Runtime CSS-in-JS inserts a new rule for every distinct value it sees, so Claude moves continuously changing values into CSS custom properties and keeps static styles at module scope. Throughout, it honors `prefers-reduced-motion` and keeps `will-change` temporary.

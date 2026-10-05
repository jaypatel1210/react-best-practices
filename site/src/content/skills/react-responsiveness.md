---
title: "Responsiveness and INP"
headline: "Keep the main thread free, so every keystroke, click and drag gets an answer in the next frame."
description: "Keep React apps responsive to input: transitions and deferred values, tab switches without fallbacks, chunked long tasks, Web Workers and one update per frame."
group: speed
rules:
  - "An urgent update renders before the next paint. Keep it small, and mark the expensive part as a transition or a deferred value."
  - "Never put a controlled input's own value in a transition. The field updates urgently, and the heavy consumer lags."
  - "A deferred render only helps if the heavy component can skip the urgent render: memo it, or let the React Compiler do it."
  - "Run tab switches and navigations that can suspend in a transition, so the current screen stays up instead of a fallback."
  - "Any JavaScript task over 50 ms blocks input. Chunk it with yields, or move it to a Web Worker."
  - "During drags and scrolls, update visuals at most once per frame, through a ref, and commit to state on release."
  - "Transitions interrupt between components, not inside one, and they don't reduce network requests."
prompts:
  - "Typing in the product filter lags behind my keystrokes. Can you fix it?"
  - "Importing a big CSV freezes the page. How do I keep it responsive?"
  - "Our INP is over 300 ms on the dashboard. Where is the time going?"
  - "Dragging the timeline playhead stutters."
---

Every click, key press and drag waits for the main thread, which also runs your JavaScript, React's renders, and the browser's style, layout and paint. This skill teaches Claude to find where an interaction's time goes (input delay, processing or presentation) and to fix the part that's actually slow, aiming for an Interaction to Next Paint of 200 ms or less.

For expensive renders, Claude splits urgent from non-urgent work with `useTransition`, `startTransition` and `useDeferredValue`, keeps the current screen on tab switches instead of a Suspense fallback, and makes sure the heavy component can skip the urgent render. For heavy JavaScript, it breaks long tasks into slices that yield, or moves them into a Web Worker with transferred buffers, cancellation and stale-result guards.

For continuous input such as pointer moves, scrolls and resizes, Claude keeps per-frame visuals out of React and commits once at the end. It knows which tool fits which delay: a debounce cuts requests, a transition reorders rendering, a worker moves computation, and none of them replaces the others. Tested helpers for yielding and frame throttling ship with the skill.

---
title: Re-renders
headline: Keep fast-changing state away from slow components, using composition before memo.
description: "Why React components re-render and how to stop the ones that don't need to: move state down, pass children, and audit the state hidden in custom hooks."
group: rendering
rules:
  - "A re-render starts from a state change, and it re-renders everything the component renders."
  - "Keep high-frequency state (input text, scroll, pointer, timers) in small leaf components."
  - "When a stateful wrapper must surround heavy content, accept that content as children."
  - "A custom hook's state belongs to the component that calls it, even if the value goes unused."
  - "Derive values during render instead of syncing them into state with an effect."
  - "Measure with the Profiler first. A 0.3 ms re-render isn't worth fixing."
prompts:
  - "Typing in the search box on the dashboard is laggy, can you fix it?"
  - "Why does this whole page re-render when I open a dropdown?"
  - "Should I wrap these components in memo?"
---

Most React performance problems come from re-rendering too much, in the wrong place. This skill teaches Claude to fix them by changing **where state lives** and **which component creates which elements**, before reaching for `memo`, `useMemo` or `useCallback`.

Structural fixes are the durable kind. They can't be broken by someone adding an inline prop next month, and they usually make the code simpler. Memoization comes last, after measuring, and only where a hot path remains.

When the expensive render genuinely depends on the changing value, the skill hands off to deferred rendering, virtualization or precise memoization, and explains which one fits.

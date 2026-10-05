---
title: "Refs and closures"
headline: "Know when a value belongs in a ref, and keep callbacks from reading stale state."
description: "Refs versus state, DOM refs and imperative handles, stale closures in intervals and subscriptions, and debounce and throttle that work, with tested hooks."
group: state
rules:
  - "If a value is rendered or passed as a prop, now or later, it's state. Otherwise a ref is fine."
  - "Don't read or write ref.current during render, except to initialize it lazily."
  - "A function that's kept, by a listener, a timer, a memo child or a debouncer, sees the values of the render that created it."
  - "Prefer complete dependency lists and functional updates. A suppressed exhaustive-deps warning usually hides a stale closure."
  - "Use useEffectEvent (React 19.2+) for logic called from effects, and a latest-ref callback for props and older versions."
  - "Create a debounced or throttled function once per component, have it call the latest callback, and cancel it on unmount."
prompts:
  - "This callback keeps using old state. Can you find the stale closure?"
  - "My setInterval counter goes to 1 and stops. What's wrong?"
  - "The debounced search still sends a request on every keystroke."
  - "Should this value be a ref or state?"
---

Refs and closures cause some of React's most confusing bugs: a counter that sticks at 1, a socket handler that filters with yesterday's settings, a debounce that fires on every keystroke, a number that updates only when you click something else. This skill teaches Claude the mental model behind all of them: every render creates functions that capture that render's values, and a ref changes without telling React.

With it, Claude decides between a ref and state with two questions, keeps `ref.current` out of render, uses callback refs for elements that mount later, and exposes small imperative handles such as `focus()` instead of boolean props that fire once.

For stale closures, Claude works through the fixes in order: complete dependency lists, functional updates, moving logic into event handlers, `useEffectEvent` on React 19.2 and later, and the latest-ref pattern. It debounces and throttles with hooks that are created once and always call the latest callback, using the repository's tested `useLatestCallback`, `useDebouncedCallback` and `useThrottledCallback`.

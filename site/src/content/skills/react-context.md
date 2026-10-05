---
title: "Context"
headline: "Share state through context without re-rendering every consumer on every change."
description: "Use React Context without the re-render tax: memoize provider values, split state from actions, select slices, and know when to move to a store with selectors."
group: state
rules:
  - "When a provider's value changes identity, all of its consumers re-render, and memo on a consumer doesn't stop it."
  - "Memoize the provider value by default, and keep every function in it stable."
  - "Let the provider own its state and render children, so only consumers re-render when it changes."
  - "Split contexts by domain and by update frequency, and give actions a context of their own."
  - "Write actions with functional updates or dispatch, so they never depend on state."
  - "Move busy state that many components read in slices to a store with selectors, and server data to a data cache."
prompts:
  - "Every component that uses our settings context re-renders when anything changes. Can you fix it?"
  - "Can you split this AppContext so the buttons that only dispatch actions stop re-rendering?"
  - "Should this shared state be a context or a Zustand store?"
---

Context delivers data to any descendant without threading props through every layer, and used well it **saves** renders, because the components in between never re-render. Used carelessly, one change re-renders every consumer in the app. This skill teaches Claude the handful of facts that decide which of the two you get.

With it, Claude builds providers that own their state and render `children`, memoizes provider values with stable functions, and splits contexts so components that only trigger changes never re-render because of them. It writes actions with functional updates or a reducer's `dispatch`, so the actions context is created once.

When a component needs one slice of busy shared state, Claude knows that destructuring and `useMemo` can't narrow a context subscription. It reaches for a further split, a memoized inner component, or an external store read through `useSyncExternalStore` or a library such as Zustand, and it keeps server data in a data-fetching cache instead of context.

---
title: "Composition and API design"
headline: "Let callers decide what to render and components decide where, with slots, render props and hooks."
description: "Design React component APIs that stay small: children and slots instead of config props, render props for owned state, hooks for logic, and HOCs done safely."
group: state
rules:
  - "Use children for the primary content and named element props (slots) for secondary regions."
  - "A prop that only configures an inner element, like iconColor, should be a slot or a render prop."
  - "Give slot content defaults with CSS first, then render-prop arguments. Use cloneElement last, with the caller's props winning."
  - "Share stateful logic with a hook, unless it needs an element the abstraction owns or a value that changes many times a second."
  - "Pass only the part that reads a fast-changing value through a render prop, and the rest as children."
  - "Apply HOCs at module scope, pass every prop and the ref through, call intercepted callbacks, and set displayName."
prompts:
  - "This Button keeps growing props like iconName and iconColor. Can you redesign its API?"
  - "Should this scroll logic be a hook or a render-prop component?"
  - "Our analytics HOC broke onClick on every button it wraps. What's wrong?"
---

A good component API lets the caller decide **what** to render and the component decide **where and how**. This skill teaches Claude to design React components that way: `children` for the main content, element props for named regions, render props when the content needs state the component owns, compound components for parts that work together, and custom hooks for logic without UI.

With it, Claude replaces configuration props that only forward to an inner element with slots, gives slot content defaults through CSS or explicit render-prop arguments rather than `cloneElement` overrides, and picks between a hook and a render-prop component by asking which component owns the state and which elements it creates.

It also knows where the older patterns still fit. Higher-order components remain the right tool for cross-cutting behavior such as click analytics, impression tracking or keyboard shielding, and Claude writes them to pass props and refs through, call the handlers they intercept, and stay at module scope so nothing remounts.

---
title: "Memoization"
headline: "Memoize only where a comparison benefits, keep every prop of a memo component stable, and let the compiler handle the rest."
description: "When React.memo, useMemo and useCallback prevent work, when they're noise, and the quiet ways memo breaks: inline props, JSX children, hook values and comparators."
group: rendering
rules:
  - "Memoization keeps a reference stable so that a comparison elsewhere succeeds. With nothing comparing it, it's pure cost."
  - "A memo component skips a render only when every prop is equal, so one inline object, arrow function or JSX child defeats it."
  - "Memoize a value only for a memo prop, a hook dependency, a shared hook's return value, a context value or a measured expensive calculation."
  - "Give list rows primitive props and one stable handler that takes the row's ID."
  - "Never write a custom comparison that ignores function props. The child ends up calling a stale callback."
  - "Measure a calculation before memoizing it, on a production build with CPU throttling."
  - "With React Compiler on, write plain code and leave existing memoization alone unless removing it is the task."
prompts:
  - "This component is wrapped in memo but still re-renders. Can you find out why?"
  - "Review the useMemo and useCallback calls in this file and remove the ones that don't help."
  - "Starring one row re-renders the whole list. How do I fix that?"
  - "We turned on React Compiler last week. What should we do with our existing useMemo calls?"
---

Memoization is a precision tool with a narrow job. This skill teaches Claude what `memo`, `useMemo` and `useCallback` actually do: keep a reference stable so that a comparison somewhere else succeeds, either a `memo` props check or a hook's dependency array. Claude memoizes only when such a comparison exists or a measurement shows an expensive calculation, and it removes the rest in review.

When a `memo` component still re-renders, Claude checks every prop instead of guessing: inline objects and arrow functions, JSX passed as `children`, spread props, values returned by custom hooks, default parameters and derived arrays. It fixes stability at the source, with module constants, functional updates, ID-taking handlers for list rows and latest-value callbacks, and it never hides an unstable callback behind a comparator that leaves the child calling stale code.

Before any of that, Claude checks whether the project uses React Compiler. If it does, Claude writes plain code and fixes the rule violations that make the compiler skip components. Either way, it tries composition from the `react-rerenders` skill first, because a re-render that never happens needs no memoization.

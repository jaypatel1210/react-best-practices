---
title: "Mental model and code review"
headline: "The mental model behind every React rule, and a review that applies it to your code."
description: "The entry skill: twelve facts about how React renders, a map from symptoms to causes, defaults for new code, and a review checklist ranked by severity."
group: core
rules:
  - "A re-render starts only from a state change, and it re-renders everything below the component that changed."
  - "Identity is type, position and key. Change any of them and React throws the old instance away."
  - "Every function made during render sees that render's values. Keep it without refreshing it and it goes stale."
  - "Use effects to synchronize with systems outside React, and release everything an effect acquires."
  - "A portal moves DOM nodes, not the React tree, so context and synthetic events still follow the components."
  - "Fix the cause, not the symptom: restructure before you memoize, and portal before you raise a z-index."
  - "Measure on a production build before and after a performance change."
  - "In review, rank findings by user impact: wrong data first, wasted work second, noise last."
prompts:
  - "Review this component before I open the PR."
  - "Can you audit this React file for bugs and performance problems?"
  - "We're on React 19 now. What should change in how we write components?"
  - "Something on this page re-renders too much. Where do I start?"
---

This is the skill Claude loads first for any React work, whether that's writing a component, reviewing a pull request or chasing a bug. It starts with the project rather than the code: which React version is installed, whether the React Compiler is on, whether there are Server Components, and which libraries the team already relies on. The version matters because React 19 and 19.2 changed several idioms, and the Compiler changes when hand-written memoization is worth writing.

From there, Claude classifies the problem by its symptom, fixes the cause instead of patching over it, verifies the result, and explains the fix in a sentence or two of the mental model, so the team can apply it elsewhere. Asked for a review, it works through a checklist grouped by area, reports only rules the code actually breaks, and ranks each finding as a bug, a cost on a hot path or a maintainability concern, each with a scenario someone can reproduce.

## The mental model

Almost every rule across the skills follows from twelve facts:

1. **Only a state change starts a re-render.** That means a `useState` or `useReducer` setter, a new context value, or an external store notifying its subscribers. Props never trigger a render on their own; a parent rendering does.
2. **When a component re-renders, everything it renders re-renders too,** whether or not their props changed. Renders flow down the tree, never up.
3. **Writing `<Child />` only creates an element, which is a plain object.** Rendering happens when a component returns it. When a component returns the very same element object as last time, such as one it received through `children`, React skips that subtree.
4. **`memo` is what makes props matter.** A memoized component skips its render only when every prop is `Object.is`-equal to the previous one, so a single inline object, function or JSX prop defeats it.
5. **An instance is identified by its type and position, plus its key.** Keep all three and React keeps the state. Change any one and React discards the old instance, with its state, DOM and effects, and mounts a new one.
6. **Every function created during a render sees that render's props and state.** That covers handlers, effect bodies, callbacks passed to `useCallback` or `useMemo`, and functions stored in refs. Keep one around without refreshing it and it reads stale values.
7. **Refs are mutable boxes.** They survive re-renders and changing them never causes one, so read and write them in effects and event handlers, not while rendering.
8. **`useEffect` usually runs after the browser paints; `useLayoutEffect` runs before paint and holds it back.** Effects caused by a click or key press are flushed before the next paint. Neither kind runs on the server, and effects exist to synchronize with systems outside React.
9. **Every context consumer re-renders when the provider's `value` changes identity,** even when the part it reads stayed the same.
10. **Error boundaries catch errors thrown while rendering, in lifecycle methods and in effects below them.** Errors from event handlers and async callbacks pass them by.
11. **A portal moves DOM nodes, not the React tree.** Context, state and synthetic events follow the React tree. CSS, native DOM events and form submission follow the DOM.
12. **React and the browser share one main thread.** A fast render can still produce a slow frame if it triggers heavy style, layout or paint work, and any task longer than 50 ms delays the next interaction.

## How it routes to the focused skills

The entry skill keeps the rules that apply almost everywhere and hands depth to fourteen focused skills. Its symptom map sends each problem to one of them: typing that lags goes to `react-rerenders`, an effect that loops goes to `react-effects`, a modal hidden under the header goes to `react-layout-portals`, and a stuttering animation goes to `react-animation`. Each focused skill carries worked examples, and several ship tested hooks. If a focused skill isn't installed, the rules here and the review checklist still cover the essentials.

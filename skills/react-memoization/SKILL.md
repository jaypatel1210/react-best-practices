---
name: react-memoization
description: Use React.memo, useMemo and useCallback correctly, including when memoization actually prevents work, when it is useless noise, and the non-obvious ways it silently breaks (spread props, values from custom hooks, inline objects, JSX children, default parameter arrays, custom comparators that cause stale closures). Use when adding, reviewing or removing useMemo, useCallback or memo, when a memoized component still re-renders, when optimizing a long list or an expensive calculation, or when the project uses React Compiler and you need to know what still matters.
license: MIT
---

# React Memoization: `memo`, `useMemo`, `useCallback`

Memoization is a precision tool with a narrow job. It keeps a reference stable between renders so that **a comparison somewhere else** succeeds: a `memo` props check, or a hook's dependency check. With no comparison that benefits, it's pure cost. With one unstable input, it silently does nothing. Try composition first (the `react-rerenders` skill); memoize what's left.

## Step 0: check for React Compiler

Look for `babel-plugin-react-compiler` in `package.json`, `reactCompiler` in `next.config.*`, or the compiler plugin in the Vite or Babel config.

If it's enabled:

- **Don't add `useMemo`, `useCallback` or `memo` in new code.** The compiler memoizes components, computed values, JSX and callbacks automatically, and more granularly than hand-written code.
- **Leave existing manual memoization alone** unless removing it is the task. Removing it can change what the compiler produces, so test when you do.
- **Keep manual memoization as an escape hatch** when a reference must stay stable, for example a value used as an effect dependency.
- **The rules below still matter** for components the compiler skips (code that breaks the Rules of React: mutating props or state during render, reading `ref.current` during render), for code outside the compiled scope, and for reasoning about effect dependencies.

Details are in `references/react-compiler.md`.

## What each tool does

- **`useMemo(compute, deps)`** runs `compute` on mount and whenever a dependency changes (compared with `Object.is`). Otherwise it returns the cached value.
- **`useCallback(fn, deps)`** returns the same function object until a dependency changes. It's equivalent to `useMemo(() => fn, deps)`.
  - The inline function is still *created* on every render; it's just discarded. `useMemo` is not cheaper than `useCallback`.
  - Never compute in the argument: `useCallback(makeHandler(config), [])` calls `makeHandler` on every render.
- **`memo(Component, arePropsEqual?)`** compares each prop with `Object.is` when the *parent* re-renders. If all are equal, it skips the component and its subtree. The component's own state updates and the contexts it reads still re-render it.
- **Already stable, no memoization needed:**
  - state setters and `dispatch`;
  - the ref object returned by `useRef`;
  - module-level constants;
  - values created once in a `useState(() => …)` initializer.

## When memoization pays off

Memoize a value or function only when at least one of these holds:

1. **It's a prop of a `memo` component**, and every other prop of that component is stable too.
2. **It's a hook dependency** of `useEffect`, `useLayoutEffect`, `useMemo` or `useCallback`, here or downstream (a child or custom hook that lists it in its deps).
3. **It's returned from a reusable custom hook.** Callers may do (1) or (2) with it, so shared hooks should return stable functions and objects.
4. **It's a context provider value.** See `react-context`.
5. **It's a measured expensive computation** that would otherwise re-run on renders where its inputs didn't change.

Otherwise don't add it, and remove it when reviewing. A `useCallback` whose function goes only to a `<button>` or to a non-`memo` component changes nothing. The child re-renders anyway because its parent re-rendered.

Wrap a component in `memo` only when all three hold:

- it re-renders often because of its parent;
- its render is measurably expensive;
- you can keep *all* of its props stable.

Place it at the root of a branch that doesn't read the changing value, so one check skips the whole branch, rather than on many leaves. A `memo` component with no props always passes its check (it still re-renders for its own state and the contexts it reads).

## How `memo` silently breaks

One unstable prop defeats the whole check. Look for:

| Prop | Why it's unstable | Fix |
|---|---|---|
| `style={{ … }}`, `options={[…]}` | New object or array each render | Module-level constant, or `useMemo` |
| `onChange={() => …}` | New function each render | `useCallback` with correct deps, or a latest-ref callback (`react-refs-closures`) |
| `children`, `icon={<Icon />}`, any JSX | Elements are new objects each render | `useMemo` the element, or don't `memo` this component |
| `{() => …}` as children (render prop) | New function each render | `useCallback` |
| `{...props}` spread from a parent | Stability depends on code you can't see | Pass explicit, primitive props |
| Values from custom hooks | Hooks often return fresh objects or inline functions | Memoize inside the hook; check its implementation |
| Default params `items = []`, `config = {}` | New value each render when the prop is omitted | Module-level `const EMPTY: Item[] = []` |
| `data.map(…)`, `list.filter(…)` passed as props | New array each render | `useMemo` the derived array |
| A memoized value with an unstable dependency | Cache busts every render | Fix stability at the top of the chain |
| Items from a fetch or JSON parse | Every response creates new objects, even for unchanged items, so every `memo` row re-renders after a refetch | Structural sharing (TanStack Query keeps unchanged parts identical by default), or merge by ID and keep the previous object when it's equal |

Two more ways `memo` looks broken:

- **The `memo` component reads a context** that changes. It re-renders regardless of props. See `react-context`.
- **Nested `memo`.** In `<MemoPanel><MemoChart /></MemoPanel>`, `MemoPanel` receives `children`, a new element on every render, so its `memo` never skips. Memoize the element instead: `const chart = useMemo(() => <Chart data={data} />, [data]);` then `<MemoPanel>{chart}</MemoPanel>`. The inner `memo` may no longer be needed at all.

## Custom comparison functions

`memo(Chart, (prev, next) => prev.data === next.data)` looks like a neat way to "ignore" an unstable `onPointClick`. It creates a bug instead. The child keeps the *first* callback it received, which closes over the first render's state, so clicks act on stale data. If you write `arePropsEqual`:

- Compare every prop, including functions.
- Avoid deep equality; it can cost more than the render you're skipping.

The better tool is almost always a stable callback that reads the latest state (the latest-ref pattern in `react-refs-closures`) plus the default `memo`.

## Stable references without memo hooks

- **Hoist static objects, arrays and option sets** to module scope.
- **Use functional updates** so callbacks don't depend on state: `setItems((prev) => [...prev, item])` lets the callback use `[]` deps.
- **Prefer `dispatch` from `useReducer`**, or a small action API built from it; it's stable.
- **Use `useState(() => createThing())`** for an object that must keep its identity for the component's lifetime. `useMemo` is documented as a performance hint that React may discard, so don't rely on it for correctness.
- **Use `useRef`** for mutable instances such as timers, subscriptions and SDK clients.

## Expensive calculations

- **Measure before memoizing.** Wrap the computation in `console.time` on a production build with CPU throttling, and compare with the component's render time in the Profiler. Sorting a few hundred items is usually far cheaper than rendering them as components. Fix the rendering first.
- **Know what `useMemo` buys.** It helps only on re-renders where its dependencies didn't change. On mount it adds work, and in a component that rarely re-renders it's overhead.
- **Consider alternatives**: normalize or sort once when data arrives, use store selectors, move work to a Web Worker, paginate or virtualize.

## Review checklist

- [ ] Each `useMemo`/`useCallback` has a consumer that compares (a `memo` prop, a hook dependency, a context value) or a measured cost.
- [ ] Each `memo` component has fully stable props: check `children` and other JSX, spreads, hook-derived values and default parameters.
- [ ] No `arePropsEqual` ignores function props.
- [ ] Dependency arrays are complete, with no lint suppressions (see `react-refs-closures` for stale-closure fixes).
- [ ] With React Compiler: no new manual memoization, and no Rules of React violations that make the compiler skip components.

## Examples

- `examples/broken-memo-and-fixes.md`: a dashboard chart whose `memo` is broken five different ways, fixed step by step; a custom hook that returns unstable values; useless `useCallback`s.
- `examples/memoized-lists.md`: fast lists with `memo` rows, stable handlers, primitive "is selected" props and correct keys.
- `examples/expensive-calculations.md`: deciding whether `useMemo` is worth it, with measurement, and moving work out of render entirely.

## References

- `references/react-compiler.md`: what the compiler does, how to detect it, how it changes each rule here, directives, and common bail-outs.

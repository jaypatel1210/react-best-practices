---
name: react-refs-closures
description: Refs, imperative component APIs, stale closures and debounce/throttle in React. Use when choosing between useRef and useState, accessing DOM nodes (focus, scroll, measure, click-outside), exposing methods such as focus() or open() from a component (ref as a prop, forwardRef, useImperativeHandle), when a callback, effect, interval, subscription or memoized child sees old props or state, when you need a stable callback that reads the latest state, or when debouncing or throttling search inputs, autosave, resize or scroll handlers. Includes tested hooks - useLatestCallback, useDebouncedCallback, useThrottledCallback.
license: MIT
---

# Refs, Imperative APIs, Closures and Debouncing

## Ref or state?

Ask two questions about the value:

1. Is it rendered, now or in the future?
2. Is it passed to another component as a prop, now or in the future?

If either answer is yes, use **state**. If both are no, a **ref** is appropriate: timer IDs, `AbortController`s, previous values for comparison, "is dragging" flags, DOM nodes, third-party instances (map, editor, player), and debug render counters.

- **Refs update synchronously and never trigger a render; state updates are scheduled and re-render.** A value kept in a ref but shown on screen updates only when *something else* re-renders, which makes an intermittent, confusing bug.
- **Don't read or write `ref.current` during render.** Render must be pure: React may render without committing, render twice in development, and React Compiler relies on purity. The one exception is lazy initialization: `if (ref.current === null) ref.current = createPlayer()`.

## DOM refs

- **`ref.current` is `null` during the first render** and stays `null` until React commits the element. Use it in effects and event handlers, never to decide what to render.
- **Use a callback ref for elements that mount later or change** (conditional content, list items): `ref={(node) => { … }}`. On React 19 a callback ref may return a cleanup function.
- **Typical uses:**
  - focus management;
  - `scrollIntoView`;
  - click-outside detection;
  - measuring (see `react-layout-portals` for measure-before-paint);
  - mounting non-React widgets.

## Passing refs to components

- **React 19+:** `ref` is a regular prop on function components.

  ```tsx
  function TextField({ ref, label, ...props }: TextFieldProps & { ref?: React.Ref<HTMLInputElement> }) {
    return <label>{label}<input ref={ref} {...props} /></label>;
  }
  ```

- **React 18 and earlier:** wrap the component in `forwardRef((props, ref) => …)`.
- **Any version:** a named prop such as `inputRef` also works and is explicit.
- **Don't trigger imperative actions with boolean props** (`shouldFocus`, `openNow`). They fire once, need resetting, and race with renders. Use a ref.

## Imperative handles

Expose a small, intention-revealing API instead of leaking the DOM node:

```tsx
useImperativeHandle(ref, () => ({
  focus: () => inputRef.current?.focus(),
  flagInvalid: () => setIsFlagged(true), // e.g. triggers a CSS shake animation via state
}), []);
```

Keep these rare. Props and callbacks cover most needs. Handles fit focus, scrolling, media playback, animation triggers and integration with non-React code. See `examples/refs-and-imperative-apis.md`.

## Closures and stale values

Every render creates new functions that capture *that render's* props and state. A function that's **kept** keeps reading the values from when it was created. That happens when it is:

- cached by `useCallback`/`useMemo` with incomplete deps;
- stored in a ref once;
- registered as a listener once;
- held by a `memo` child whose comparator ignores it;
- baked into a debounced wrapper.

Typical symptoms: a handler logs the initial state; an interval counter sticks at 1; a socket handler filters with old criteria; a memoized child submits old form values.

Fix in this order of preference:

1. **Complete dependency arrays.** Trust `react-hooks/exhaustive-deps`; a suppression comment usually hides a stale closure.
2. **Use functional updates** so the function doesn't read state: `setCount((c) => c + 1)`.
3. **Move the logic into the event handler** if it belongs to an interaction, not to "whenever X changes".
4. **Use `useEffectEvent` (React 19.2+)** for effects that need the latest values without re-running. Call the Effect Event only from inside effects; don't pass it to children or use it as an event handler.
5. **Use the latest-ref pattern** for stable callbacks passed to memoized children, subscriptions, timers and debouncers. It's in `assets/use-latest-callback.ts`:

```tsx
const latest = useRef(callback);
useInsertionEffect(() => { latest.current = callback; }); // update after every commit, before other effects
const [stable] = useState(() => (...args: Args) => latest.current(...args)); // created once
```

It works because the stable function captures the ref *object*, which never changes, and reads `.current` when called. Don't call the stable function during render.

## Debounce and throttle

- **Debounce**: run after calls stop for N ms. Use it for search-as-you-type, validation, and "resize finished".
- **Throttle**: run at most once per N ms, with a trailing call carrying the latest arguments. Use it for autosave while typing, drag and scroll tracking, and analytics.

Rules:

1. **Create the debounced function once per component instance.** Calling `debounce(fn, 300)` in the render body creates a new timer on every render, so every call still fires, just later.
2. **Keep the input's own state update immediate.** A controlled input whose `setValue` is debounced stops accepting keystrokes. Debounce only the expensive side effect.
3. **Read the latest props and state through a ref.** A wrapper created once captures the first render's values. Re-creating it when deps change resets the timer and turns it into a plain delay.
4. **Clean up on unmount.** Cancel pending calls, or flush them for autosave so the last edit isn't lost.
5. **Pair debounced requests with stale-response protection** (`AbortController` or an ignore flag). Debouncing reduces requests; it doesn't order responses. See `react-data-fetching`.
6. **For expensive rendering rather than network calls, prefer `useDeferredValue`** (`react-rerenders`).

Use `assets/use-debounced-callback.ts` and `assets/use-throttled-callback.ts`, or wrap the project's existing debounce (lodash, es-toolkit) with the same pattern: create it once with a stable wrapper that calls `latest.current`, and cancel on unmount.

## Assets (copy into the project, e.g. `src/hooks/`)

| File | API |
|---|---|
| `assets/use-latest-callback.ts` | `useLatestCallback(fn)` returns a stable function that calls the latest `fn` |
| `assets/use-debounced-callback.ts` | `useDebouncedCallback(fn, delayMs, { flushOnUnmount? })` returns a stable function with `.cancel()`, `.flush()`, `.isPending()` |
| `assets/use-throttled-callback.ts` | `useThrottledCallback(fn, intervalMs, { flushOnUnmount? })` returns leading plus trailing calls, with `.cancel()`, `.flush()`, `.isPending()` |

All three are typed and dependency-free, require React 18+, are tested on React 18 and 19 (in the repository's `tests/` folder), and pass the React Compiler lint rules.

The latest-ref pattern updates its ref in `useInsertionEffect`. React documents that hook for CSS-in-JS libraries, but it's used here only to refresh a plain ref before other effects run. The tests confirm children's layout effects and effects see the new callback.

## Examples

- `examples/refs-and-imperative-apis.md`: ref versus state decisions, a click-outside hook, a callback ref for measuring, and a form field exposing `focus()`/`flagInvalid()`.
- `examples/stale-closures.md`: interval, socket and memoized-child stale closures, with fixes (deps, functional updates, `useEffectEvent`, latest ref).
- `examples/debounce-and-throttle.md`: debounced search with abort, throttled autosave with flush on unmount, and why debounce-in-render degrades to a delay.

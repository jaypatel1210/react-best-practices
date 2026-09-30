---
name: react-rerenders
description: Find and fix unnecessary React re-renders with composition instead of memoization, by moving state down, passing slow subtrees as children or element props, isolating state hidden inside custom hooks, and deriving instead of syncing state. Use when a React screen feels slow, laggy or janky (typing, scrolling, dragging, resizing, opening a dialog), when asked why a component re-renders or how React re-rendering works, when state lives high in the tree, or before adding React.memo, useMemo or useCallback to fix performance. Also covers measuring renders with React DevTools and keeping input responsive with useDeferredValue or startTransition.
license: MIT
---

# React Re-renders: Diagnose and Fix with Composition

Most React performance problems come from re-rendering too much in the wrong place. The most durable fixes change **where state lives** and **which component creates which elements**. They need no memoization, can't be silently broken by a later edit, and usually make the code simpler.

## How re-rendering works

- **Triggers.** A component re-renders when:
  - its own state changes (a setter or `dispatch` with a new value);
  - a context it reads changes;
  - an external store it subscribes to changes;
  - its parent re-renders.
- **Propagation.** On re-render, React calls the component again, then re-renders every component in the JSX it returned, recursively, whatever their props. Ancestors are never re-rendered.
- **Props are not a trigger.** Reassigning a plain variable changes nothing on screen; only state does. Whether props changed matters only for components wrapped in `memo`.
- **Built-in bail-outs.** React skips work when:
  - a setter receives a value `Object.is`-equal to the current state (children are skipped);
  - a component returns the *same element object* as last time in a given position, which happens with elements received via props or `children`;
  - a `memo` component receives equal props.
- **Re-render ≠ DOM update.** React diffs the result and touches only DOM that changed. Re-rendering small components is cheap. It hurts when the subtree is large or does heavy work, and when it happens on high-frequency events (keystrokes, scroll, pointer moves, resize, animation frames).
- **Mounting costs more than re-rendering** (DOM creation, effects). An *accidental remount* is worse than any re-render; see the `react-reconciliation` skill.

## Diagnose before changing code

1. **Name the slow interaction**: "typing in the coupon field", "dragging the divider", "opening the share menu".
2. **Find the state that changes during it** and the component that owns it. It can hide in several places:
   - a `useState`/`useReducer` in the component itself;
   - a custom hook that holds state;
   - a context provider;
   - a store subscription.
3. **List what that component renders.** Split it into parts that read the changing state and parts that don't.
4. **Choose the fix.** If big parts don't read the state, restructure (fixes below). If they genuinely depend on it, make that work cheaper (defer, virtualize) or memoize precisely.
5. **Confirm with the Profiler.** See `references/measuring.md`. A re-render that takes 0.3 ms is not worth fixing.

## Fix 1: Move state down

When state is used by a small part of a big component, extract that state and the elements that use it into their own component. The big component no longer owns the state, so its other children stop re-rendering.

```tsx
// Before: typing re-renders OrderTimeline and InvoicePreview on every keystroke
function OrderPage({ order }: { order: Order }) {
  const [coupon, setCoupon] = useState('');
  return (
    <>
      <input value={coupon} onChange={(e) => setCoupon(e.target.value)} />
      <OrderTimeline events={order.events} />
      <InvoicePreview order={order} />
    </>
  );
}

// After: only CouponField re-renders while typing
function CouponField({ onApply }: { onApply: (code: string) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onApply(draft); }}>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} />
    </form>
  );
}
```

A useful pattern: keep **draft** state (every keystroke) local, and lift only the **committed** value (on submit or blur) to where the rest of the page needs it.

## Fix 2: Wrap, don't own (children and element props)

When the state must live in a component that *surrounds* heavy content (a scroll container, a resizable pane, a drag area, an animated wrapper), have that component accept the content as `children` or as element props instead of rendering it itself.

```tsx
function ScrollProgress({ children }: { children: React.ReactNode }) {
  const [progress, setProgress] = useState(0);
  return (
    <div
      className="scroller"
      onScroll={(e) => {
        const el = e.currentTarget;
        const max = el.scrollHeight - el.clientHeight;
        setProgress(max > 0 ? el.scrollTop / max : 0);
      }}
    >
      <ProgressBar value={progress} />
      {children}
    </div>
  );
}

// ArticleBody is created here, by the parent, so it does not re-render on scroll
<ScrollProgress>
  <ArticleBody article={article} />
</ScrollProgress>
```

**Why it works.** `<ArticleBody />` is an element object created by the *parent*. When `ScrollProgress` re-renders from its own state, `children` is still the same object, so React skips that subtree. `<ProgressBar />` is created inside `ScrollProgress`, so it is a new element each time and does re-render, which is exactly what should update. This holds for any prop that carries elements (`left={<Editor />}`, `footer={<Actions />}`), not only `children`.

The content re-renders only when the *parent* re-renders. That's correct: it depends on the parent's data.

## Fix 3: Know what state your hooks hide

A custom hook is not a separate component. Any state it holds, including state held by hooks it calls, belongs to the component that calls it. Every update re-renders that component, **even if the hook's return value isn't used**.

- **Audit hooks called high in the tree** for high-frequency state: resize, scroll, pointer, intervals and timers, sockets, media queries, form libraries that track every keystroke.
- **Store coarse values.** A `useBreakpoint()` that stores `'compact' | 'regular'` re-renders only when the breakpoint flips, because the setter bails out on an unchanged value. A `useWindowSize()` that stores pixels re-renders on every resize event.
- **Subscribe narrowly.** Prefer `matchMedia` change events over resize listeners, and use `useSyncExternalStore` with a snapshot that returns a primitive.
- **Call the hook where the value is used.** If only a toolbar needs the value, call the hook inside the toolbar (or a tiny wrapper component), not inside the page.

## Fix 4: Derive, don't sync

State that can be computed from props or other state should be computed during render. Copying it into state and syncing it with an effect costs an extra render pass and shows stale values for a frame.

```tsx
// Avoid: extra render, and a stale frame between them
const [visible, setVisible] = useState<Task[]>([]);
useEffect(() => setVisible(tasks.filter((t) => t.status === filter)), [tasks, filter]);

// Prefer: compute it (wrap in useMemo only if measurement shows it's expensive)
const visible = tasks.filter((t) => t.status === filter);
```

To reset state when an identity prop changes (a different user or document), use a `key` instead of an effect. See `react-reconciliation`.

## Fix 5: State needed far apart in the tree

When two distant components share state, lifting it to their common ancestor re-renders everything in between. Instead, create a provider component that owns the state and renders `children`, and have the consumers read it from context (or from an external store with selectors). Only consumers re-render. See the `react-context` skill.

## When the expensive render is unavoidable

- **Keep input responsive while heavy content catches up.** Use `useDeferredValue(query)`, or wrap the non-urgent update in `startTransition`, and pair it with a `memo`-ed consumer so the deferred render can be skipped or interrupted.
- **Render less.** Virtualize long lists (TanStack Virtual, react-window) and lazy-load hidden panels.
- **Then memoize precisely.** Follow the rules in the `react-memoization` skill; they are easy to get wrong.

Debouncing is for **side effects** like network requests. For **rendering cost**, prefer deferred values. See `react-refs-closures` for debounce.

## Anti-patterns

- Wrapping every component in `memo` and every function in `useCallback` as the first move.
- Lifting state "just in case" another component might need it later.
- Keeping scroll position, pointer position or input text in a top-level component or a widely-used context.
- Moving a rendered value into a ref "to avoid re-renders". The UI then stops updating (see `react-refs-closures`).
- Calling a state-holding hook in a layout or page component just to read one derived boolean.

## Examples

Read the one that matches the situation:

- `examples/move-state-down.md`: page-level input state, the draft-versus-committed split, and a disclosure hook moved into a leaf.
- `examples/children-as-props.md`: a resizable split pane and a scroll-driven header, with element props and `children`.
- `examples/hooks-that-hide-state.md`: resize and media-query hooks, nested hooks, and `useSyncExternalStore` with primitive snapshots.
- `examples/unavoidable-heavy-renders.md`: filtering a large list while typing, with `useDeferredValue`, `memo` and virtualization.

## References

- `references/measuring.md`: how to prove a re-render problem and its fix (React DevTools Profiler, highlight updates, the `<Profiler>` API, performance tracks, CPU throttling, pitfalls such as StrictMode double renders).

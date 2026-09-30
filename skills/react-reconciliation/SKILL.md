---
name: react-reconciliation
description: Control component identity in React, meaning how reconciliation matches elements by type, position and key, and how to keep or reset state on purpose. Use when state unexpectedly survives or disappears (an input keeps its value after switching tabs, users or forms; a field loses focus on every keystroke), when choosing keys for lists, when a component remounts or flickers on every render, when a component is defined inside another component or a HOC is created during render, when conditionally wrapping elements, or when a component should reset its state when an id or route changes.
license: MIT
---

# React Reconciliation: Identity, Keys and State Lifetime

React keeps a component's state, DOM nodes and effects alive only while it believes *the same component* sits in the same place in the tree. Knowing exactly how it decides that explains a family of bugs: state leaking between items, inputs that lose focus on every keystroke, list rows showing someone else's data. It also gives precise control over when state resets.

## How React matches elements

After a re-render, React compares the elements a component returned with the previous ones, slot by slot:

- **Same `type` and same `key`** (or both without a key) in a slot → **update**. React keeps the instance with its state, DOM and effects, and re-renders it with the new props. `type` means the same component function or class (compared by reference) or the same HTML tag.
- **Different `type` or different `key`** → **replace**. React unmounts the old instance (runs cleanups, discards its state and DOM) and mounts a new one.
- **Slots are positions among siblings.** A conditional keeps its slot even when it renders nothing: `{isOpen && <Panel />}` or `{a ? <X /> : null}` always occupies one position.
- **An array from `.map()` occupies one slot**, and items inside it are matched by `key`, not by position. Static siblings after a mapped list don't shift when the list grows or shrinks.

## Rule 1: Define components at module scope, never inside another component

```tsx
// Bug: EditableCell is a *new function* on every render of OrdersTable
function OrdersTable({ rows }: { rows: Row[] }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const EditableCell = ({ id }: { id: string }) => (
    <input value={draft[id] ?? ''} onChange={(e) => setDraft({ ...draft, [id]: e.target.value })} />
  );
  return rows.map((r) => <EditableCell key={r.id} id={r.id} />);
}
```

Each keystroke updates `draft`, `OrdersTable` re-renders, and `EditableCell` gets a new type, so React unmounts every cell and mounts new ones:

- the input loses focus after one character;
- local state resets;
- effects re-run;
- the whole table does mount-level work on every keystroke.

Fix: move the component to module scope and pass what it needs as props (see `examples/components-defined-in-render.md`).

The same trap in other forms:

- `const Tracked = withTracking(Card)` inside a component body;
- `styled.div` created during render;
- `useMemo(() => withSomething(C), [])`, a fragile workaround.

Apply HOCs and factories at module scope.

Calling a render helper as a function, `{renderRow(row)}`, is fine. It returns elements and doesn't create a component type. It just can't use hooks.

## Rule 2: Same type in the same place shares state, even when you mean different things

```tsx
{tab === 'billing' ? <AddressForm title="Billing" /> : <AddressForm title="Shipping" />}
```

Both branches produce an `AddressForm` in the same slot, so React keeps the instance, and whatever was typed into its uncontrolled inputs or internal state carries over to the other tab. Decide what you mean:

- **Different entities** → give them different keys (`key="billing"`, `key="shipping"`), or render them in different slots (`{isBilling && <A />}{!isBilling && <B />}`).
- **The same entity with new props** → leave it. It re-renders, which is cheaper than remounting.

The same applies to `<ProfileEditor userId={id} />` when `id` changes: it's the same instance with new props, so internal state from the previous user survives unless you key it by `id`.

## Rule 3: List keys come from data identity

- **Use a stable, unique ID from the data.** It only has to be unique among siblings. When IDs are unique only per group, compose them: `` key={`${group.id}:${item.id}`} ``.
- **Index keys are acceptable only when all three hold:** the list never reorders, filters, inserts or removes; items hold no state or uncontrolled inputs; and items aren't memoized components whose props would shift. When in doubt, use IDs.
- **Never generate keys during render** (`Math.random()`, `crypto.randomUUID()`, `Date.now()`). Every render remounts every item.
- **No IDs in the data?** Assign them once, when the data enters the app (on fetch, parse or creation), not in render.
- **Keys don't prevent re-renders; `memo` does.** A key tells React *which existing instance* to reuse. With `memo` rows, correct keys let React skip unchanged rows even when they move.

## Rule 4: Reset state deliberately with `key`

```tsx
<ConversationDraft key={conversationId} conversationId={conversationId} />
```

Switching conversations now gives a fresh draft, with no effect required. This replaces `useEffect(() => { setText(''); setFiles([]); }, [conversationId])`, which renders the previous conversation's draft for a frame and silently misses any field someone adds later.

Know the cost. A key change is a full unmount and mount:

- the DOM is recreated;
- effects run again (including refetches);
- focus and scroll position are lost.

Put the key on the *smallest* subtree that should reset. Don't use remounting to paper over problems with direct fixes, such as fetch race conditions (see `react-data-fetching`).

## Rule 5: Keep the tree shape stable

- **Conditional wrappers remount their contents.** With `{isCompact ? <Drawer><Nav /></Drawer> : <aside><Nav /></aside>}`, `Nav` changes parents, so it remounts when the breakpoint flips. Instead, render the wrapper unconditionally and change its behavior through props, restyle it with CSS, or lift `Nav`'s state up.
- **Swapping a subtree for a spinner unmounts it.** `if (isFetching) return <Spinner />` throws away form edits on every refetch. Keep stateful content mounted during refetches and show loading alongside it. Reserve full swaps for the *initial* load.
- **Changing an element's tag or component at the root of a subtree** (`div` → `section`, a Fragment → `div`) remounts everything below it.

## Rule 6: Preserve state across positions (rare)

- **The same key among the same parent's children** makes React treat an element as *moved*, not replaced, even when it jumps slots.
- **Keys don't work across different parents.** To keep state while something is hidden or moved elsewhere, lift the state up, keep the component mounted and hide it with CSS, or use `<Activity mode="hidden">` on React 19.2+.

## Debugging identity problems

- **Log mounts:** `useEffect(() => { console.log('mount', id); return () => console.log('unmount', id); }, []);`. If it logs on every keystroke, something is remounting. Check for inline component definitions, generated keys and conditional wrappers.
- **StrictMode mounts twice** in development on first mount only. Repeated mounts after that are real.
- **Inspect in React DevTools.** The Components panel shows each element's `key`. Compare the type and key before and after the interaction.

## Examples

- `examples/state-leaks-between-items.md`: tabs and user switches that carry state over, fixed with keys or slots.
- `examples/components-defined-in-render.md`: inline component definitions, HOCs applied during render, and render-helper functions.
- `examples/list-keys.md`: index versus ID keys with reordering, inserts, memoized rows, and assigning IDs on fetch.
- `examples/reset-and-preserve-state.md`: key-based resets, conditional wrappers, keeping state alive when moving or hiding UI.

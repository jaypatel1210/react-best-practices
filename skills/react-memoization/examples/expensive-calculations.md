# Example: Is This Calculation Worth `useMemo`?

"Expensive" is a measurement, not a feeling. The same computation can be negligible on one screen and critical on another, depending on data size, device and how often it runs.

## Step 1: measure in realistic conditions

```tsx
function ProjectBoard({ tasks, query }: { tasks: Task[]; query: string }) {
  console.time('group+sort');
  const columns = groupAndSort(tasks, query);
  console.timeEnd('group+sort');
  // ...
}
```

- Use a production build with 4–6× CPU throttling and a realistic number of tasks.
- Trigger the *re-render that matters*: an unrelated state change, a keystroke elsewhere on the page.
- Compare with the component's render time in the React DevTools Profiler.

Typical outcomes:

| Measured | Render of the component | Decision |
|---|---|---|
| 0.2 ms | 25 ms | Don't memoize the calculation. Fix the render cost (fewer re-renders, memoized children, virtualization). |
| 8 ms | 12 ms | Memoize it, and check why the component re-renders so often. |
| 60 ms | any | Memoize it, and also move it out of the render path (see below). |

## Step 2: if it's worth it, memoize on the real inputs

```tsx
const columns = useMemo(() => groupAndSort(tasks, query), [tasks, query]);
```

The dependencies must be the values the calculation reads, and they must themselves be stable. If `tasks` is rebuilt on every render (`tasks={raw.filter(...)}` in the parent), the memo recomputes every time. Fix the parent's derivation first.

Remember what `useMemo` does *not* do:

- It doesn't help the first render; it adds a little work there.
- It doesn't help when a dependency changes. If `query` changes on every keystroke, the calculation runs on every keystroke. Pair it with `useDeferredValue(query)` to keep typing responsive (`react-rerenders/examples/unavoidable-heavy-renders.md`).
- It isn't a semantic guarantee. React may discard cached values in some situations, so the code must stay correct if the calculation re-runs.

## Step 3: better, move the work out of render

Often the best fix is to do the work *once, where the data changes*, rather than caching it where it's read:

```tsx
// On fetch: build the index once per response, not once per render
const { data: board } = useQuery({
  queryKey: ['board', projectId],
  queryFn: () => fetchBoard(projectId),
  // A stable function reference: select re-runs only when the data changes.
  // An inline arrow here would be a new function every render and would re-run every render.
  select: buildBoardIndex,
});
```

Other options:

- **Normalize** data into maps keyed by ID on arrival, so lookups are cheap during render.
- **Use store selectors** (Redux `createSelector`, Zustand selectors) so derived data is computed once per state change and shared by all consumers.
- **Move work off the main thread** with a Web Worker for parsing, search indexing or diffing large documents.
- **Compute less**: paginate, virtualize, or compute only what's visible.

## Anti-pattern: memoizing everything "to be safe"

```tsx
const fullName = useMemo(() => `${user.first} ${user.last}`, [user.first, user.last]);
const isAdmin = useMemo(() => user.roles.includes('admin'), [user.roles]);
const initials = useMemo(() => fullName.split(' ').map((s) => s[0]).join(''), [fullName]);
```

Each of these costs more in bookkeeping and dependency comparison than the computation it caches. In a large app, hundreds of these slow down the initial render measurably and make the code harder to change. Write plain expressions:

```tsx
const fullName = `${user.first} ${user.last}`;
const isAdmin = user.roles.includes('admin');
const initials = fullName.split(' ').map((s) => s[0]).join('');
```

# Example: Transitions, Deferred Values and Suspense

A sales report viewer has three tabs (Summary, Regions, Products). Each tab's panel loads its data with Suspense, and the Products tab renders a pivot table that takes 150–250 ms on a mid-range phone.

## Part 1: tab switches that blank the screen

```tsx
function ReportViewer({ reportId }: { reportId: string }) {
  const [tab, setTab] = useState<ReportTab>('summary');
  return (
    <>
      <TabBar value={tab} onChange={setTab} />
      <Suspense fallback={<PanelSkeleton />}>
        <ReportPanel reportId={reportId} tab={tab} /> {/* calls useSuspenseQuery for the tab's data */}
      </Suspense>
    </>
  );
}
```

Clicking "Regions" for the first time suspends `ReportPanel`. React replaces the Summary panel, which the user was reading, with a skeleton, then shows Regions. On a fast connection that's a 100 ms flash of grey for no reason.

### Fix: switch tabs in a transition

```tsx
function ReportViewer({ reportId }: { reportId: string }) {
  const [tab, setTab] = useState<ReportTab>('summary');
  const [isPending, startTransition] = useTransition();
  return (
    <>
      <TabBar value={tab} onChange={(next) => startTransition(() => setTab(next))} />
      <div className={isPending ? 'report-panel is-updating' : 'report-panel'}>
        <Suspense fallback={<PanelSkeleton />}>
          <ReportPanel reportId={reportId} tab={tab} />
        </Suspense>
      </div>
    </>
  );
}
```

- Because the update is a transition, React keeps the Summary panel on screen while Regions loads, and `isPending` lets the panel show a quiet "updating" style.
- The skeleton still appears on the very first load, because that boundary has never shown content.
- Most routers already run navigations as transitions. When you build tabs, steppers or wizards yourself, do the same.

**The tab bar now looks stuck**, though: `tab` doesn't change until the transition finishes, so the clicked tab doesn't highlight. Keep an urgent state for what the user selected and a transition state for what's rendered:

```tsx
const [selectedTab, setSelectedTab] = useState<ReportTab>('summary'); // urgent: the tab bar
const [renderedTab, setRenderedTab] = useState<ReportTab>('summary'); // transition: the panel
const [isPending, startTransition] = useTransition();

const selectTab = (next: ReportTab) => {
  setSelectedTab(next);
  startTransition(() => setRenderedTab(next));
};
```

This is the same split as a controlled input: the control updates immediately, the expensive consumer lags.

## Part 2: a "group by" control in front of an expensive table

```tsx
function ProductsPanel({ rows }: { rows: SaleRow[] }) {
  const [groupBy, setGroupBy] = useState<GroupBy>('category');
  return (
    <>
      <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>…</select>
      <PivotTable rows={rows} groupBy={groupBy} />
    </>
  );
}
```

The `change` event is a discrete input, so React renders the 200 ms pivot table synchronously before the select can repaint. INP for that interaction is over 200 ms.

```tsx
function ProductsPanel({ rows }: { rows: SaleRow[] }) {
  const [groupBy, setGroupBy] = useState<GroupBy>('category');
  const deferredGroupBy = useDeferredValue(groupBy);
  const isStale = groupBy !== deferredGroupBy;

  return (
    <>
      <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>…</select>
      <div className={isStale ? 'pivot is-stale' : 'pivot'}>
        <PivotTable rows={rows} groupBy={deferredGroupBy} />
      </div>
    </>
  );
}

const PivotTable = memo(function PivotTable({ rows, groupBy }: PivotTableProps) {
  const groups = useMemo(() => groupRows(rows, groupBy), [rows, groupBy]);
  // ...renders a few hundred cells
});
```

- The urgent render updates the select and re-renders `ProductsPanel`, but `PivotTable` receives the same `rows` and the old `deferredGroupBy`, so `memo` skips it.
- The background render with the new value can be interrupted if the user changes the select again.
- Without `memo` on `PivotTable` (or React Compiler), the urgent render would still render the table, and nothing would improve.

**Where this stops helping:** if `groupRows` itself takes 200 ms, it blocks the background render as a single, uninterruptible step, because React can only yield between components. Precompute groupings when the data arrives, or move the computation into a worker (`examples/long-tasks-and-workers.md`).

## Part 3: search results that suspend

```tsx
function ProductSearch() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search products" />
      <Suspense fallback={<ResultsSkeleton />}>
        <div className={isStale ? 'results is-stale' : 'results'}>
          <SearchResults query={deferredQuery} /> {/* suspends while a query's results load */}
        </div>
      </Suspense>
    </>
  );
}
```

- Typing updates the input immediately. The results for the new query render in the background; if they suspend, React keeps showing the previous results (dimmed through `isStale`) instead of the skeleton.
- The skeleton appears only on the first search, when there's nothing to keep.
- This doesn't reduce requests. If each keystroke starts a fetch, debounce the request or rely on the data library's deduplication and cancellation (`react-refs-closures`, `react-data-fetching`).
- On React 19, `useDeferredValue(query, '')` renders the initial value first, then the real one in the background, which keeps an expensive first render off the critical path.

## Checklist for this pattern

- Controls (inputs, selects, tab bars) update with urgent state; the expensive consumer reads a transition state or a deferred value.
- The expensive consumer is `memo`-wrapped (or compiled) with stable props.
- Pending feedback is subtle (a class, `aria-busy`), not a full-screen spinner.
- Long single computations are moved out, because transitions can't interrupt them.

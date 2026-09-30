# Example: A `memo` Broken Five Ways, and How to Fix It

## The setup

An analytics dashboard has a filter sidebar and a heavy `RevenueChart` (canvas rendering, ~30 ms). Someone wrapped the chart in `memo` because "the sidebar is slow". It didn't help.

```tsx
const RevenueChart = memo(function RevenueChart(props: RevenueChartProps) {
  /* expensive */
});

function Dashboard({ report }: { report: Report }) {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const { formatCurrency } = useLocaleFormatters();

  return (
    <div className="dashboard">
      <FilterSidebar value={filters} onChange={setFilters} />
      <RevenueChart
        series={report.points.map((p) => ({ x: p.date, y: p.revenue }))} // 1
        options={{ smooth: true, showGrid: true }}                        // 2
        onPointClick={(point) => openDrilldown(point, filters)}           // 3
        formatValue={formatCurrency}                                      // 4
        header={<ChartHeader title="Revenue" />}                          // 5
      />
    </div>
  );
}
```

Every filter change re-renders `Dashboard`, and each numbered prop is a new reference, so the `memo` never skips.

## The fixes, one prop at a time

**1. Derived arrays**: memoize the derivation on its real inputs.

```tsx
const series = useMemo(
  () => report.points.map((p) => ({ x: p.date, y: p.revenue })),
  [report.points],
);
```

**2. Static objects**: hoist them out of the component. No hook is needed for a value that never changes.

```tsx
const CHART_OPTIONS = { smooth: true, showGrid: true } as const;
```

**3. Callbacks that read state.** `useCallback(…, [filters])` would be recreated on every filter change, which is exactly when we want the chart *not* to re-render. The callback needs the *latest* filters when a point is clicked, not at render time, so use a stable callback that reads the latest value:

```tsx
const onPointClick = useLatestCallback((point: ChartPoint) => openDrilldown(point, filters));
```

`useLatestCallback` returns a function whose identity never changes but which always calls the most recent closure. It ships as a tested asset in the `react-refs-closures` skill (`react-refs-closures/assets/use-latest-callback.ts`).

**4. Values from custom hooks**: check the hook. This one returned fresh functions on every call:

```tsx
// Before: new functions every render → breaks memo for every consumer
function useLocaleFormatters() {
  const { locale, currency } = useUserSettings();
  return {
    formatCurrency: (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n),
  };
}

// After: stable until locale/currency change, and cheaper (the formatter is built once)
function useLocaleFormatters() {
  const { locale, currency } = useUserSettings();
  return useMemo(() => {
    const currencyFormat = new Intl.NumberFormat(locale, { style: 'currency', currency });
    return { formatCurrency: (n: number) => currencyFormat.format(n) };
  }, [locale, currency]);
}
```

Fix instability *in the hook* so every caller benefits. Reusable hooks should return stable functions and objects.

**5. JSX props**: an element is a new object each render. Either memoize it, or pass data instead of an element.

```tsx
const header = useMemo(() => <ChartHeader title="Revenue" />, []);
// or change the API: <RevenueChart title="Revenue" /> and let the chart render its header
```

### After

```tsx
const CHART_OPTIONS = { smooth: true, showGrid: true } as const;

function Dashboard({ report }: { report: Report }) {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const { formatCurrency } = useLocaleFormatters();

  const series = useMemo(
    () => report.points.map((p) => ({ x: p.date, y: p.revenue })),
    [report.points],
  );
  const onPointClick = useLatestCallback((point: ChartPoint) => openDrilldown(point, filters));
  const header = useMemo(() => <ChartHeader title="Revenue" />, []);

  return (
    <div className="dashboard">
      <FilterSidebar value={filters} onChange={setFilters} />
      <RevenueChart
        series={series}
        options={CHART_OPTIONS}
        onPointClick={onPointClick}
        formatValue={formatCurrency}
        header={header}
      />
    </div>
  );
}
```

Now changing filters skips the chart entirely. Verify it with the React DevTools Profiler: `RevenueChart` should be gray in the commit for a filter change.

### Consider composition first

Could the filters state move down instead? Here the chart's click handler needs `filters`, so not entirely. If the chart didn't need filters at all, `<FiltersProvider><FilterSidebar /></FiltersProvider>` or moving the state into the sidebar would make all of the memoization above unnecessary. Always ask this question before memoizing.

## Useless memoization to remove in review

```tsx
function Toolbar({ onSave, count }: { onSave: () => void; count: number }) {
  // useless: <button> is a DOM element and doesn't compare props
  const handleClick = useCallback(() => onSave(), [onSave]);

  // useless: string concatenation is cheaper than the memo bookkeeping
  const label = useMemo(() => `Save ${count} items`, [count]);

  // useless: IconButton is not wrapped in memo, so it re-renders with Toolbar anyway
  const style = useMemo(() => ({ padding: 8 }), []);

  return (
    <>
      <button onClick={handleClick}>{label}</button>
      <IconButton style={style} icon="save" />
    </>
  );
}
```

None of these prevent any work. They add reading overhead and dependency arrays that can go stale. Remove them, unless one is a dependency somewhere downstream or `IconButton` is actually `memo`-wrapped (check before deleting).

## A default parameter that breaks everything downstream

```tsx
function TagPicker({ selected = [], onChange }: { selected?: string[]; onChange: (t: string[]) => void }) {
  useEffect(() => {
    syncToUrl(selected);
  }, [selected]); // runs on every render when `selected` is omitted: [] !== []
  return <TagList selected={selected} />; // breaks memo(TagList) too
}
```

Fix:

```tsx
const NO_TAGS: string[] = [];
function TagPicker({ selected = NO_TAGS, onChange }: TagPickerProps) { /* … */ }
```

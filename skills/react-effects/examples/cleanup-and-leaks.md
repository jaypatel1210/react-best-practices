# Example: Cleanup and Memory Leaks

A missing cleanup rarely breaks the first visit. It breaks the tenth: memory climbs as users move between screens, listeners pile up, and callbacks run against components that no longer exist.

## Scenario: a live metrics panel

The panel streams metrics over a socket, shows "updated 12 s ago", sizes its chart to the container, renders with a third-party charting library, and offers a CSV export preview.

### Before

```tsx
function LiveMetricsPanel({ serviceId }: { serviceId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<MetricPoint[]>([]);
  const [now, setNow] = useState(Date.now());
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  useEffect(() => {
    const socket = new WebSocket(`${METRICS_URL}/${serviceId}`);
    socket.onmessage = (e) => setPoints((prev) => [...prev.slice(-299), JSON.parse(e.data)]);
  }, [serviceId]);

  useEffect(() => {
    setInterval(() => setNow(Date.now()), 1000);
  }, []);

  useEffect(() => {
    const chart = createLineChart(containerRef.current!);
    new ResizeObserver(([entry]) => chart.resize(entry.contentRect.width)).observe(containerRef.current!);
    window.addEventListener('keydown', (e) => e.key === 'r' && chart.resetZoom());
  }, []);

  const preview = (rows: string) => setExportUrl(URL.createObjectURL(new Blob([rows], { type: 'text/csv' })));
  // ...
}
```

Each mount leaks, and each `serviceId` change leaks more:

- **The socket** stays open after unmount and when `serviceId` changes. Old sockets keep calling `setPoints`, mixing another service's data into the chart.
- **The interval** runs forever, and holds the component's closure (and everything it references) in memory.
- **The chart** is never destroyed, so its canvas, internal buffers and listeners survive. Its DOM container is now *detached*: out of the page, but still referenced.
- **The observer** keeps watching a detached node, and **the keydown listener** is an anonymous function that can never be removed. After five visits, pressing `r` resets five charts, four of them invisible.
- **Object URLs** keep each exported blob in memory until the page unloads.

### After

```tsx
function LiveMetricsPanel({ serviceId }: { serviceId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<LineChart | null>(null);
  const [points, setPoints] = useState<MetricPoint[]>([]);
  const [now, setNow] = useState(Date.now());
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  // One connection per serviceId, closed before the next one opens
  useEffect(() => {
    const socket = new WebSocket(`${METRICS_URL}/${serviceId}`);
    socket.onmessage = (e) => setPoints((prev) => [...prev.slice(-299), JSON.parse(e.data)]);
    return () => socket.close();
  }, [serviceId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The chart, its observer and its shortcut share one lifetime
  useEffect(() => {
    const container = containerRef.current!;
    const chart = createLineChart(container);
    chartRef.current = chart;

    const observer = new ResizeObserver(([entry]) => chart.resize(entry.contentRect.width));
    observer.observe(container);

    const listeners = new AbortController();
    window.addEventListener('keydown', (e) => e.key === 'r' && chart.resetZoom(), { signal: listeners.signal });

    return () => {
      listeners.abort();
      observer.disconnect();
      chart.destroy();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setData(points);
  }, [points]);

  // Revoke the previous URL whenever it's replaced, and on unmount
  useEffect(() => {
    if (!exportUrl) return;
    return () => URL.revokeObjectURL(exportUrl);
  }, [exportUrl]);

  const preview = (rows: string) => setExportUrl(URL.createObjectURL(new Blob([rows], { type: 'text/csv' })));
  // ...
}
```

Notes:

- **Group resources that live and die together** in one effect (the chart, its observer and its shortcut), and keep unrelated lifetimes apart (the socket depends on `serviceId`; the chart doesn't).
- **`{ signal }` removes listeners without keeping a reference to each function.** It also avoids the classic mismatch where `removeEventListener` gets a different function or a different `capture` flag and silently removes nothing.
- **Points from the previous service** would still show after a `serviceId` change. Render the panel as `<LiveMetricsPanel key={serviceId} serviceId={serviceId} />` so it starts empty (`react-reconciliation`). Calling `setPoints([])` at the top of the effect would show the old data for a frame, and the `set-state-in-effect` lint rule flags it.
- **A closed socket stops delivering messages**, so the old connection can't write into the new one's state.
- StrictMode's mount → unmount → mount in development now creates and destroys one socket and one chart cleanly. Before the fix, it showed two charts: an early, free warning.

## Finding a leak

1. **Reproduce a cycle**: open and close the screen, or switch between two routes, ten times.
2. **Chrome DevTools → Memory → Heap snapshot.** Take one snapshot after a first cycle, repeat the cycle several times, click the garbage-collect button, then take another.
3. **Compare the snapshots** (the "Comparison" view) and sort by size delta or new object count. Objects that grow with each cycle are the leak.
4. **Filter by "Detached"** to find DOM trees removed from the page but still referenced. Select one and read its **Retainers** panel: the chain usually ends at a listener, an interval closure, a module-level variable or a third-party instance.
5. **Count listeners** in the Chrome console with `getEventListeners(window)`. A count that grows with each visit points to a listener that is never removed.
6. **Watch the trend** with the Performance monitor's "JS heap size" while cycling. A sawtooth that returns to baseline is healthy; a baseline that keeps rising with each cycle is a leak.

## Leaks that don't come from effects

- **Module-level caches keyed by objects** (`const cache = new Map<Order, Summary>()`) keep every key alive forever. Use a `WeakMap` when the key is an object, or a bounded cache with eviction when it isn't.
- **Stores and event emitters holding component callbacks** registered in a handler and never unsubscribed. Subscribe in an effect, or use `useSyncExternalStore`, which unsubscribes for you.
- **DOM nodes saved outside the component** (a module-level "last focused" variable, a global registry of open dialogs). Store IDs instead of nodes, or clear the reference in cleanup.
- **Widgets created in event handlers** (a date picker opened on click) need an explicit destroy path, too, often when the component unmounts.
- **Development-only noise**: logging large objects to the console keeps them reachable while DevTools is open. Close DevTools or clear the console before trusting a heap snapshot.

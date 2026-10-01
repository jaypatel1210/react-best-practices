# Example: A Virtualized Audit Log

An admin screen shows an audit log of 20,000 entries: time, actor, action, target. Rendering every row takes about 2 seconds to mount and makes scrolling and filtering stutter. Users scroll, filter, expand rows for details and jump to a specific entry.

## Step 1: fixed-height rows with TanStack Virtual

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

const ROW_HEIGHT = 36;

function AuditLog({ entries }: { entries: AuditEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => entries[index].id, // identity follows the entry, not the slot
  });

  return (
    <div role="grid" aria-rowcount={entries.length + 1} className="audit-log">
      <AuditHeader /> {/* outside the scroll container, so it never scrolls away */}
      <div ref={scrollRef} className="audit-log__body" style={{ height: 600, overflow: 'auto' }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => (
            <AuditRow
              key={item.key}
              entry={entries[item.index]}
              rowIndex={item.index + 2} // aria-rowindex is 1-based and the header is row 1
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const AuditRow = memo(function AuditRow({ entry, rowIndex, style }: AuditRowProps) {
  return (
    <div role="row" aria-rowindex={rowIndex} className="audit-row" style={style}>
      <span role="gridcell">{formatTime(entry.at)}</span>
      <span role="gridcell">{entry.actor}</span>
      <span role="gridcell">{entry.action}</span>
      <span role="gridcell">{entry.target}</span>
    </div>
  );
});
```

What matters here:

- **The scroll container has a fixed height** and `overflow: auto`. Without a bounded height, the container grows to the full list and every row counts as visible.
- **A CSS grid of `div`s instead of `<table>`.** Absolutely positioned rows don't work well inside table layout. Share column widths between header and rows with one `grid-template-columns` value (a CSS custom property on `.audit-log`).
- **ARIA grid roles** restore what virtualization hides: `aria-rowcount` tells assistive tech there are 20,001 rows, and `aria-rowindex` says where each rendered row sits.
- **`memo` rows with stable props.** `style` is a new object each render; that's acceptable here because only rows whose position changes get a new `translateY`, and each row is cheap. If rows were heavy, pass `start` as a number and build the style inside the row.
- **Keys from the data** (`getItemKey`). When a filter removes entries, the rows keep their identity instead of shifting state from one entry to another.

Mount time drops from seconds to a few milliseconds, because only about 25 rows exist at a time.

## Step 2: rows that expand to show details

Expanded rows are taller, so heights are no longer fixed, and expansion state must survive scrolling.

```tsx
function AuditLog({ entries }: { entries: AuditEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (expanded.has(entries[index].id) ? 160 : ROW_HEIGHT),
    overscan: 8,
    getItemKey: (index) => entries[index].id,
  });

  return (
    // ...same container as before
    virtualizer.getVirtualItems().map((item) => (
      <div
        key={item.key}
        data-index={item.index}            // tells measureElement which item this is
        ref={virtualizer.measureElement}   // measures the real height after render
        style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }}
      >
        <AuditRow
          entry={entries[item.index]}
          isExpanded={expanded.has(entries[item.index].id)}
          onToggle={toggle}
        />
      </div>
    ))
  );
}
```

- **State lives in the parent, keyed by ID.** A row scrolled out of view unmounts; if `isExpanded` were the row's own state, it would collapse every time the user scrolled away and back.
- **`isExpanded` is a boolean prop**, and `onToggle` takes the ID, so it's one stable function for every row and `memo` keeps working.
- **`measureElement` reads the rendered height**, and a reasonable `estimateSize` keeps the scrollbar from jumping as unmeasured rows appear. Don't set a fixed `height` on measured rows.

## Step 3: jump to an entry

A deep link (`/audit?entry=evt_8f2c`) should scroll to that entry and highlight it. The row may not exist in the DOM, so `scrollIntoView` can't reach it:

```tsx
useEffect(() => {
  if (!targetId) return;
  const index = entries.findIndex((e) => e.id === targetId);
  if (index !== -1) virtualizer.scrollToIndex(index, { align: 'center' });
}, [targetId, entries, virtualizer]);
```

After scrolling, move focus into the row (for example in the row's own effect when it mounts with `isTarget`) so keyboard users land there too.

## Step 4: know what you gave up

- **Find-in-page** only searches rendered rows. Provide a search or filter box that filters the data, and say so in the UI.
- **Printing and "select all"** see the rendered window only. Offer an export.
- **Screen readers** get the true size from `aria-rowcount`, but can only read rendered rows. Keyboard navigation between rows must scroll the virtualizer (arrow keys call `scrollToIndex` and move focus).
- **SSR** renders the first window only (or nothing until the scroll element exists). Give the virtualizer an initial size option (`initialRect`) if the first client render must match the server.

## Notes

- **React Compiler:** the hooks lint plugin's `incompatible-library` rule flags `useVirtualizer`, because its API returns functions that can't be memoized safely. The compiler leaves values derived from it unmemoized, so keep the component that calls it thin and put the work in memoized rows.
- **Filtering a 20,000-entry list while typing** is still expensive, even when rendering is cheap. Combine the virtualizer with `useDeferredValue` for the filter (`react-rerenders/examples/unavoidable-heavy-renders.md`).

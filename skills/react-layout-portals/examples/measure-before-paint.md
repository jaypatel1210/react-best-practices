# Example: Measure Before Paint

## Scenario 1: a chip list that shows "+N more"

A ticket row shows its labels as chips on a single line. Chips that don't fit are replaced by a "+N" chip. Text widths depend on font, language and zoom, so they must be measured.

```tsx
const GAP = 8;

function ChipList({ labels }: { labels: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(labels.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const compute = () => {
      const available = container.clientWidth;
      const chips = Array.from(measure.children) as HTMLElement[];
      const moreChip = chips.pop()!; // the last child is a "+N" template sized for the worst case
      let used = 0;
      let count = 0;
      for (const chip of chips) {
        const next = used + (count > 0 ? GAP : 0) + chip.offsetWidth;
        const needsMore = count + 1 < chips.length;
        const reserve = needsMore ? GAP + moreChip.offsetWidth : 0;
        if (next + reserve > available) break;
        used = next;
        count += 1;
      }
      setVisibleCount(count); // same number → React bails out
    };

    compute();                               // before the first paint: no flash
    const observer = new ResizeObserver(compute);
    observer.observe(container);             // container resizes: re-measure
    return () => observer.disconnect();
  }, [labels]);

  const hiddenCount = labels.length - visibleCount;

  return (
    <div ref={containerRef} className="chip-list">
      {labels.slice(0, visibleCount).map((label) => (
        <Chip key={label}>{label}</Chip>
      ))}
      {hiddenCount > 0 && <Chip title={labels.slice(visibleCount).join(', ')}>+{hiddenCount}</Chip>}

      {/* Invisible copy used only for measuring. It always contains every chip. */}
      <div ref={measureRef} className="chip-list__measure" aria-hidden="true">
        {labels.map((label) => (
          <Chip key={label}>{label}</Chip>
        ))}
        <Chip>+{labels.length}</Chip>
      </div>
    </div>
  );
}
```

```css
.chip-list { position: relative; display: flex; gap: 8px; overflow: hidden; white-space: nowrap; }
.chip-list__measure { position: absolute; top: 0; left: 0; display: flex; gap: 8px; visibility: hidden; pointer-events: none; }
```

Why each piece is there:

- **`useLayoutEffect`**: the first `compute()` and the resulting re-render happen before the browser paints. With `useEffect`, users would briefly see all chips overflowing, then the trimmed list.
- **The measurement copy**: chips that are currently hidden can't be measured, and re-measuring would otherwise require showing them again. The invisible absolute copy keeps every width available without affecting layout.
- **`ResizeObserver` on the container**: this reacts to the container's own size changes (sidebar collapse, font load, window resize) rather than only to window resize.
- **Primitive state**: most resize callbacks compute the same `visibleCount`, so React skips the re-render.

With SSR, the server renders every chip. Because the container has `overflow: hidden` and `white-space: nowrap`, the pre-hydration HTML shows a clean, clipped single line rather than a wrapped mess. After hydration, the layout effect trims the list and adds "+N". Choosing CSS that produces an acceptable unmeasured state is the best SSR strategy.

## Scenario 2: a tooltip that flips when there's no room above

```tsx
type Placement = 'top' | 'bottom';

function Tooltip({ anchorRef, children }: { anchorRef: React.RefObject<HTMLElement | null>; children: React.ReactNode }) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; placement: Placement } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;

    const update = () => {
      const a = anchor.getBoundingClientRect();
      const t = tooltip.getBoundingClientRect();
      const placement: Placement = a.top - t.height - 8 >= 0 ? 'top' : 'bottom';
      const top = placement === 'top' ? a.top - t.height - 8 : a.bottom + 8;
      const left = Math.min(Math.max(8, a.left + a.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
      setPosition({ top, left, placement });
    };

    update();
    window.addEventListener('scroll', update, { capture: true, passive: true }); // any scroll container
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
    };
  }, [anchorRef]);

  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className={position ? `tooltip tooltip--${position.placement}` : 'tooltip'}
      style={{
        position: 'fixed',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? 'visible' : 'hidden', // measurable but not visible until placed
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

// Render it only while open, which happens on the client after an interaction, so document exists:
{isOpen && <Tooltip anchorRef={buttonRef}>Copied!</Tooltip>}
```

- Measuring and positioning in a layout effect means the tooltip never appears at `(0, 0)`, and never shows on the wrong side for one frame.
- `position: fixed` plus the viewport coordinates from `getBoundingClientRect()` match exactly, because both use the viewport's coordinate system. That's true only because the tooltip is portaled to `body`, away from any transformed ancestor that would redefine "fixed".
- Listening to scroll in the capture phase catches scrolling inside any container, not just the window.

For production tooltips and popovers (collision detection, arrow placement, shift, virtual anchors), use Floating UI or the project's UI library. The same principle applies inside them.

## SSR-safe measurement checklist

- The server render (and the first client render) is an acceptable unmeasured layout, usually through CSS: clipping, `line-clamp`, fixed aspect ratios, skeletons.
- Nothing in render reads `window` or `document`, or branches on `typeof window`.
- Client-only parts switch after mount (`useIsClient()` in `SKILL.md`) or load with `ssr: false`.
- Layout effects contain only measurement and the state updates that depend on it.

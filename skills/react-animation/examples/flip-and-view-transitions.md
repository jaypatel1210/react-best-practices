# Example: Animating Layout Changes with FLIP and View Transitions

## Part 1: a leaderboard that re-sorts as scores arrive

Scores stream in every few seconds and the list re-sorts. Rows jump to their new rank with no motion, so users lose track of who moved.

```tsx
function Leaderboard({ players }: { players: Player[] }) {
  const ranked = players.toSorted((a, b) => b.score - a.score);
  return (
    <ol className="leaderboard">
      {ranked.map((p) => (
        <li key={p.id}>
          <PlayerRow player={p} />
        </li>
      ))}
    </ol>
  );
}
```

A CSS transition can't help: no property of a row changes when it moves to another slot. FLIP converts the move into a transform.

### A FLIP hook

```tsx
type Point = { x: number; y: number };

export function useFlip(containerRef: React.RefObject<HTMLElement | null>, durationMs = 300) {
  const previous = useRef(new Map<string, Point>());

  // No dependency array: compare positions after every commit of the list's owner.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = [...container.querySelectorAll<HTMLElement>('[data-flip-key]')];

    // Stop our own running animations so we measure the real layout, not a transformed one.
    for (const el of items) {
      for (const animation of el.getAnimations()) if (animation.id === 'flip') animation.cancel();
    }

    // Read pass: positions relative to the container, so scrolling the page doesn't count as a move.
    const origin = container.getBoundingClientRect();
    const next = new Map<string, Point>();
    for (const el of items) {
      const rect = el.getBoundingClientRect();
      next.set(el.dataset.flipKey!, { x: rect.left - origin.left, y: rect.top - origin.top });
    }

    // Write pass: invert each moved item, then play it back to its new place.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion) {
      for (const el of items) {
        const key = el.dataset.flipKey!;
        const before = previous.current.get(key);
        const after = next.get(key)!;
        if (!before) continue; // a new row: leave its entrance to CSS
        const dx = before.x - after.x;
        const dy = before.y - after.y;
        if (dx === 0 && dy === 0) continue;
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: durationMs, easing: 'cubic-bezier(0.2, 0, 0, 1)', id: 'flip' },
        );
      }
    }

    previous.current = next;
  });
}
```

```tsx
function Leaderboard({ players }: { players: Player[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  useFlip(listRef);
  const ranked = players.toSorted((a, b) => b.score - a.score);
  return (
    <ol ref={listRef} className="leaderboard">
      {ranked.map((p) => (
        <li key={p.id} data-flip-key={p.id}>
          <PlayerRow player={p} />
        </li>
      ))}
    </ol>
  );
}
```

Why each piece matters:

- **`useLayoutEffect`** runs after React moves the DOM nodes and before the browser paints. The inverse transform is applied before the user sees the new order, so nothing flashes.
- **`key={p.id}`** makes React move the existing `<li>` nodes. With index keys, React keeps each node in place and rewrites its content, so there's nothing to animate and the wrong rows would "move" (`react-reconciliation`).
- **Reads, then writes.** One forced layout per commit, not one per row.
- **The Web Animations API** plays from the inverted position to `none` without the "apply, force a style flush, then transition" dance, and `id: 'flip'` lets the hook cancel only its own animations.
- **Cost grows with the list.** Measuring every row after every commit is fine for dozens of rows. For hundreds, measure only rows inside the viewport, or don't animate.

Limitations of this small hook: an update that lands mid-animation restarts rows from their last *settled* position (a small jump), and size changes aren't animated. Motion's `layout` prop, auto-animate and GSAP Flip handle interruption, scaling with counter-scaled children, and nested scroll containers. Use one of them if the project allows it.

## Part 2: a grid/list switch with `<ViewTransition>` (React 19.3+)

A product catalog toggles between a grid and a list. Each card should travel to its new position and size.

```tsx
import { startTransition, useState, ViewTransition } from 'react';

function Catalog({ products }: { products: Product[] }) {
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  return (
    <>
      <LayoutToggle
        value={layout}
        onChange={(next) => startTransition(() => setLayout(next))} // view transitions need a transition
      />
      <ul className={`catalog catalog--${layout}`}>
        {products.map((product) => (
          <ViewTransition key={product.id} name={`product-${product.id}`}>
            <li>
              <ProductCard product={product} />
            </li>
          </ViewTransition>
        ))}
      </ul>
    </>
  );
}
```

- **Only transition updates animate.** Calling `setLayout(next)` directly would switch instantly, because urgent updates must commit immediately and view transitions can't guarantee that.
- **Names come from IDs.** Two captured elements with the same name cancel the whole animation.
- **Name only what travels.** Each named element is captured and animated separately. For a catalog with hundreds of cards, name the cards on screen, or let the list cross-fade as one.

### Direction-aware page changes

Paging through results should slide forward or back. A transition type selects the animation:

```tsx
import { addTransitionType, startTransition, useState, ViewTransition } from 'react';

function PagedResults({ pages }: { pages: Result[][] }) {
  const [page, setPage] = useState(0);
  const goTo = (next: number) =>
    startTransition(() => {
      addTransitionType(next > page ? 'forward' : 'back');
      setPage(next);
    });

  return (
    <>
      <ViewTransition
        key={page}
        enter={{ forward: 'slide-in-from-end', back: 'slide-in-from-start', default: 'none' }}
        exit={{ forward: 'slide-out-to-start', back: 'slide-out-to-end', default: 'none' }}
      >
        <ResultsPage results={pages[page]} />
      </ViewTransition>
      <Pager page={page} pageCount={pages.length} onChange={goTo} />
    </>
  );
}
```

```css
::view-transition-old(.slide-out-to-start) { animation: 180ms ease-in both slide-to-start; }
::view-transition-new(.slide-in-from-end) { animation: 220ms ease-out both slide-from-end; }
/* ...and the mirrored pair for 'back' */
@keyframes slide-to-start { to { transform: translateX(-24px); opacity: 0; } }
@keyframes slide-from-end { from { transform: translateX(24px); opacity: 0; } }
```

The `key` change makes the old page exit and the new page enter, and the class maps pick the animation for the active type. `default: 'none'` keeps other transitions (a filter change, say) from sliding the page.

**Load data before the transition.** The browser pauses rendering between the two snapshots. If `ResultsPage` suspends while fetching, the transition waits on the network. Prefetch the next page (`react-data-fetching`), or show cached data.

## Part 3: the same on older React, or outside React

```tsx
import { flushSync } from 'react-dom';

export function withViewTransition(update: () => void) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof document.startViewTransition !== 'function' || reduceMotion) {
    update();
    return;
  }
  document.startViewTransition(() => {
    flushSync(update); // commit synchronously, so the "after" snapshot shows the new UI
  });
}

// Usage
<LayoutToggle value={layout} onChange={(next) => withViewTransition(() => setLayout(next))} />
<li style={{ viewTransitionName: `product-${product.id}` }}>…</li>
```

- **`flushSync` is required.** The callback must finish the DOM update before it returns. React normally commits later, so the new snapshot would capture the old layout.
- **Feature detection** keeps the update working where the API is missing; the change just happens instantly.
- This is one of the few legitimate uses of `flushSync` (`react-responsiveness`).

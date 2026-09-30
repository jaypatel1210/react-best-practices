# Example: Render-Prop Components vs Hooks

## The requirement

Several screens need to react to how far a *specific scroll container* (not the window) has been scrolled: show a "back to top" button, add a shadow under a sticky toolbar, or lazy-load a section.

## Option A: a hook plus a ref

```tsx
function useScrollTop<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return { ref, scrollTop };
}

function ReportPage({ report }: { report: Report }) {
  const { ref, scrollTop } = useScrollTop<HTMLDivElement>();
  return (
    <div ref={ref} className="report-scroll">
      <Toolbar elevated={scrollTop > 0} />
      <ReportBody report={report} /> {/* re-renders on every scroll event */}
    </div>
  );
}
```

This works, but it has two issues:

- The hook's state lives in `ReportPage`, so the whole page, including the expensive `ReportBody`, re-renders on every scroll event.
- The effect runs once and reads `ref.current` at that point. If the element mounts later (conditional rendering), it never attaches. A callback ref handles that; see `react-refs-closures`.

## Option B: a render-prop component that owns the element

```tsx
function ScrollArea({ className, children }: {
  className?: string;
  children: (scrollTop: number) => React.ReactNode;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  return (
    <div className={className} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      {children(scrollTop)}
    </div>
  );
}

function ReportPage({ report }: { report: Report }) {
  return (
    <ScrollArea className="report-scroll">
      {(scrollTop) => (
        <>
          <Toolbar elevated={scrollTop > 0} />
          <ReportBody report={report} />
        </>
      )}
    </ScrollArea>
  );
}
```

There's no ref plumbing, because the component renders the element and owns the listener, and `ReportPage` no longer re-renders on scroll. But everything returned from the render function *still* re-renders on each scroll, because it's created inside `ScrollArea`'s render.

## Option C: pass only what needs the value through the render prop

Combine the render prop with "wrap, don't own": only the parts that read the scroll position go in the function, and the rest is passed as regular children.

```tsx
function ScrollArea({ className, header, children }: {
  className?: string;
  header: (state: { isScrolled: boolean }) => React.ReactNode;
  children: React.ReactNode;
}) {
  const [isScrolled, setIsScrolled] = useState(false);
  return (
    <div className={className} onScroll={(e) => setIsScrolled(e.currentTarget.scrollTop > 0)}>
      {header({ isScrolled })}
      {children}
    </div>
  );
}

function ReportPage({ report }: { report: Report }) {
  return (
    <ScrollArea className="report-scroll" header={({ isScrolled }) => <Toolbar elevated={isScrolled} />}>
      <ReportBody report={report} /> {/* created by ReportPage: skipped on scroll */}
    </ScrollArea>
  );
}
```

Scrolling now re-renders `ScrollArea` and `Toolbar` only, and only when `isScrolled` actually flips, because the setter bails out on an unchanged boolean.

## Which to choose

| Situation | Choice |
|---|---|
| Logic tied to the window/document or a global source; caller renders little | Hook |
| Logic tied to an element the abstraction should own (scroll or drag container, measured box) | Render-prop component, or a hook returning a callback ref |
| The value changes at high frequency and the caller renders a lot | Component with a render prop for the dependent part and `children` for the rest |
| Many parts need the value deep in the tree | Provider plus context, with the rules from `react-context` |

## Converting a legacy render-prop API to a hook

Older libraries and code often look like this:

```tsx
<WindowSize>{({ width }) => (width < 768 ? <MobileNav /> : <DesktopNav />)}</WindowSize>
```

The hook equivalent is simpler when the value is global and the caller is light:

```tsx
const isCompact = useMediaQuery('(max-width: 767px)'); // see react-rerenders/examples/hooks-that-hide-state.md
return isCompact ? <MobileNav /> : <DesktopNav />;
```

Keep the render-prop version where it scopes re-renders to a small subtree on a heavy screen.

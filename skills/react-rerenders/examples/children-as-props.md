# Example: Wrap, Don't Own (Children and Element Props)

Use this when the fast-changing state belongs to a component that must *surround* heavy content, so there's no small leaf to move the state into.

## Scenario 1: a resizable split pane

A code playground has a draggable divider between a code editor and a live preview. The divider position updates on every `pointermove`.

### Before

```tsx
function Playground({ files }: { files: SourceFile[] }) {
  const [leftWidth, setLeftWidth] = useState(480);
  const dragging = useRef(false);

  return (
    <div
      className="playground"
      onPointerMove={(e) => {
        if (dragging.current) setLeftWidth(e.clientX);
      }}
      onPointerUp={() => (dragging.current = false)}
    >
      <div style={{ width: leftWidth }}>
        <CodeEditor files={files} />
      </div>
      <div className="divider" onPointerDown={() => (dragging.current = true)} />
      <div className="right">
        <LivePreview files={files} />
      </div>
    </div>
  );
}
```

Each pointer move re-renders `Playground`, which re-renders `CodeEditor` and `LivePreview`, the two most expensive components on the page. Dragging stutters.

### After

Give the drag state its own component and pass the panes in as element props:

```tsx
type SplitPaneProps = {
  left: React.ReactNode;
  right: React.ReactNode;
  initialLeftWidth?: number;
};

function SplitPane({ left, right, initialLeftWidth = 480 }: SplitPaneProps) {
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth);
  const dragging = useRef(false);

  return (
    <div
      className="split-pane"
      onPointerMove={(e) => {
        if (dragging.current) setLeftWidth(e.clientX);
      }}
      onPointerUp={() => (dragging.current = false)}
    >
      <div style={{ width: leftWidth }}>{left}</div>
      <div className="divider" onPointerDown={() => (dragging.current = true)} />
      <div className="right">{right}</div>
    </div>
  );
}

function Playground({ files }: { files: SourceFile[] }) {
  return (
    <SplitPane
      left={<CodeEditor files={files} />}
      right={<LivePreview files={files} />}
    />
  );
}
```

During a drag only `SplitPane` re-renders. `left` and `right` are element objects created by `Playground`, which didn't re-render, so React sees the same objects in the same positions and skips both subtrees. The browser still re-lays out the panes at their new widths; that's CSS, not React work.

The `dragging` flag lives in a ref because it's never rendered and flipping it shouldn't trigger a render.

## Scenario 2: a header that reacts to scroll

A documentation page shrinks its header after the reader scrolls 80px. The article body is large, with syntax highlighting and embedded demos.

```tsx
function CollapsingHeaderLayout({ header, children }: {
  header: (collapsed: boolean) => React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className="doc-scroll"
      onScroll={(e) => setCollapsed(e.currentTarget.scrollTop > 80)}
    >
      <header className={collapsed ? 'header header--compact' : 'header'}>
        {header(collapsed)}
      </header>
      {children}
    </div>
  );
}

function DocPage({ doc }: { doc: Doc }) {
  return (
    <CollapsingHeaderLayout header={(collapsed) => <DocTitle doc={doc} compact={collapsed} />}>
      <ArticleBody doc={doc} />
    </CollapsingHeaderLayout>
  );
}
```

Two details matter here:

1. **`children`**: `ArticleBody` doesn't re-render on scroll, for the same reason as the split pane.
2. **`setCollapsed(boolean)`**: the state stores a boolean, not the raw `scrollTop`. Most scroll events set the same value again, and React bails out when the new state is `Object.is`-equal to the current one. Storing the raw scroll position would re-render the layout on every scroll event.

The header uses a *render prop* because the header content needs the layout's state. See the `react-composition` skill for choosing between element props and render props.

## When this pattern applies

- A container owns interaction state: scroll, drag, resize, hover, focus-within, animation.
- The content inside it doesn't need that state, or needs only a coarse version of it.
- The content is expensive: editors, charts, maps, long lists, rich text.

## When it doesn't

- The content genuinely reads the changing state (a chart that redraws with a hovered point). Make that work cheaper instead: use `useDeferredValue`, memoize precisely, or move the visual effect to CSS or a canvas.
- The parent itself re-renders often. The passed elements are recreated whenever the parent renders, which is correct because they depend on the parent's data. Fix the parent's re-renders first.

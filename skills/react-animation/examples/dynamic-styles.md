# Example: Dynamic Styles Without a Runtime Tax

Runtime CSS-in-JS turns each distinct set of style values into a class and a CSS rule. That's harmless for a handful of variants and expensive for values that change continuously.

## Scenario 1: a resizable table column

```tsx
const HeaderCell = styled.th<{ $width: number }>`
  width: ${(p) => p.$width}px;
  min-width: 64px;
`;

function ColumnHeader({ column }: { column: Column }) {
  const [width, setWidth] = useState(column.defaultWidth);
  return (
    <HeaderCell $width={width}>
      {column.label}
      <ResizeHandle onResize={(dx) => setWidth((w) => Math.max(64, w + dx))} />
    </HeaderCell>
  );
}
```

Dragging the handle across 300 pixels:

- creates up to 300 classes and 300 CSS rules, which are never removed;
- re-serializes and hashes the template on every render;
- grows the stylesheet, so every later style recalculation on the page gets slower;
- re-renders the header (and anything it renders) on every pointer move.

styled-components prints a development warning once a component generates more than 200 classes. That warning always means "use a custom property or an inline style here".

### Step 1: one static rule, one custom property

```tsx
const HeaderCell = styled.th`
  width: var(--column-width);
  min-width: 64px;
`;

<HeaderCell style={{ '--column-width': `${width}px` } as React.CSSProperties}>
```

The class is generated once. Each change sets one inline custom property, which costs a style recalculation for that element, not a new rule. (TypeScript doesn't know custom property names, hence the cast; a typed helper such as `cssVars({ columnWidth: width })` keeps it tidy.)

### Step 2: don't render per pointer move at all

The width only needs to be React state when the drag *ends*:

```tsx
function ColumnHeader({ column, onWidthChange }: Props) {
  const cellRef = useRef<HTMLTableCellElement>(null);
  const widthRef = useRef(column.width);

  const applyWidth = useFrameThrottledCallback((width: number) => {
    widthRef.current = width;
    cellRef.current?.style.setProperty('--column-width', `${width}px`);
  });

  return (
    <HeaderCell ref={cellRef} style={{ '--column-width': `${column.width}px` } as React.CSSProperties}>
      {column.label}
      <ResizeHandle
        onResize={(dx) => applyWidth(Math.max(64, widthRef.current + dx))}
        onResizeEnd={() => {
          applyWidth.flush();
          onWidthChange(column.id, widthRef.current); // one state update, e.g. persisted column layout
        }}
      />
    </HeaderCell>
  );
}
```

During the drag, React renders nothing; the style changes at most once per frame (`useFrameThrottledCallback` from `react-responsiveness/assets`). The committed width flows back through props, so React stays the source of truth between drags.

## Scenario 2: a progress bar

```tsx
// Creates a rule per percentage, and animates width (layout)
const Fill = styled.div<{ $pct: number }>`width: ${(p) => p.$pct}%;`;
```

```css
.progress__fill {
  transform-origin: left;
  transform: scaleX(var(--progress, 0));
  transition: transform 200ms ease-out;
}
```

```tsx
<div className="progress__fill" style={{ '--progress': value / 100 } as React.CSSProperties} />
```

A static rule, a custom property, and `transform` instead of `width`, so the change is composited. For an indeterminate bar, a CSS keyframe animation keeps moving through long tasks and heavy renders.

## Scenario 3: a handful of variants

A badge has four tones. Generating a class per tone is fine, but interpolating inside a styled template still re-serializes on every render. A lookup is cheaper and clearer:

```tsx
// CSS Modules, Tailwind classes, or static CSS-in-JS classes all work the same way
const toneClass = {
  neutral: styles.neutral,
  info: styles.info,
  warning: styles.warning,
  danger: styles.danger,
} as const satisfies Record<Tone, string>;

<span className={`${styles.badge} ${toneClass[tone]}`}>{label}</span>
```

A data attribute works too, with no JavaScript mapping at all: `<span className="badge" data-tone={tone}>` and `.badge[data-tone='warning'] { … }`.

## Scenario 4: styles declared inside the component

```tsx
function ProfileCard({ user }: { user: User }) {
  return (
    <div css={{ display: 'grid', gap: 12, padding: 16, borderRadius: 12 }}> {/* serialized every render */}
      …
    </div>
  );
}
```

The object is identical on every render, but the `css` prop serializes and hashes it each time; only the rule insertion is cached. Hoist static styles to module scope:

```tsx
const cardStyles = css({ display: 'grid', gap: 12, padding: 16, borderRadius: 12 });

function ProfileCard({ user }: { user: User }) {
  return <div css={cardStyles}>…</div>;
}
```

Emotion's compiler plugin pre-serializes fully static styles at build time. Dynamic parts become custom properties, as in Scenario 1.

## When to move off runtime CSS-in-JS

- **Server Components:** runtime CSS-in-JS runs only in Client Components, and the Next.js App Router needs a style registry to collect styles during SSR. Every styled component forces a client boundary.
- **Large, frequently updating UIs:** the serialization and insertion work happens during render, on the main thread.
- **Options with no runtime:** CSS Modules, Tailwind, vanilla-extract, Linaria, Panda, StyleX. They emit static CSS at build time and handle dynamic values through custom properties.

Migrate gradually: new components first, then the hottest paths (lists, tables, anything that animates).

# Example: Components Created During Render

Any component type that is *created* while rendering is a new type on every render. React sees a different `type` in the slot, so it unmounts the old subtree and mounts a new one. That happens every single time the parent renders.

## Scenario 1: an inline cell component

```tsx
function InventoryTable({ items, onChange }: { items: Item[]; onChange: (id: string, qty: number) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);

  // New function identity on every render of InventoryTable
  const QuantityCell = ({ item }: { item: Item }) => (
    <input
      type="number"
      defaultValue={item.qty}
      onFocus={() => setEditingId(item.id)}
      onBlur={(e) => onChange(item.id, Number(e.target.value))}
    />
  );

  return (
    <table>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className={item.id === editingId ? 'editing' : undefined}>
            <td>{item.name}</td>
            <td><QuantityCell item={item} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

**Symptom:** clicking into a quantity input immediately loses focus. `onFocus` sets state, the table re-renders, `QuantityCell` is a new type, and every input is destroyed and recreated, including the one being focused.

### Fix: module scope plus props

```tsx
function QuantityCell({ item, onFocus, onCommit }: {
  item: Item;
  onFocus: (id: string) => void;
  onCommit: (id: string, qty: number) => void;
}) {
  return (
    <input
      type="number"
      defaultValue={item.qty}
      onFocus={() => onFocus(item.id)}
      onBlur={(e) => onCommit(item.id, Number(e.target.value))}
    />
  );
}

function InventoryTable({ items, onChange }: InventoryTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <table>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className={item.id === editingId ? 'editing' : undefined}>
            <td>{item.name}</td>
            <td><QuantityCell item={item} onFocus={setEditingId} onCommit={onChange} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Whatever the inline component used to capture from the closure (state, setters, props) becomes an explicit prop.

## Scenario 2: a HOC applied during render

```tsx
function Feed({ posts }: { posts: Post[] }) {
  const TrackedCard = withImpressionTracking(PostCard); // new component type every render
  return posts.map((p) => <TrackedCard key={p.id} post={p} />);
}
```

Every render of `Feed` remounts every card. Images reload, card-level state resets, and because the HOC logs impressions on mount, analytics count a fresh impression for every card on every render.

Fix: apply the HOC once, at module scope.

```tsx
const TrackedPostCard = withImpressionTracking(PostCard);

function Feed({ posts }: { posts: Post[] }) {
  return posts.map((p) => <TrackedPostCard key={p.id} post={p} />);
}
```

If the HOC needs per-render data, pass it as a prop to the wrapped component. Don't bake it into the HOC call.

## Scenario 3: styled components or factories in render

```tsx
function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  const Pill = styled.span`background: ${color};`; // new component + new CSS class each render
  return <Pill>{children}</Pill>;
}
```

Define the styled component once, at module scope. For a handful of known values (a palette of badge colors), an interpolated prop is fine:

```tsx
const Pill = styled.span<{ $tone: BadgeTone }>`background: ${(p) => toneColors[p.$tone]};`;
function Badge({ tone, children }: BadgeProps) {
  return <Pill $tone={tone}>{children}</Pill>;
}
```

For arbitrary or continuously changing values (a user-picked color, a width while dragging), interpolation creates a new CSS class for every distinct value. Use one static rule that reads a custom property instead:

```tsx
const Pill = styled.span`background: var(--pill-color);`;
function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return <Pill style={{ '--pill-color': color } as React.CSSProperties}>{children}</Pill>;
}
```

More on runtime styling costs: `react-animation/examples/dynamic-styles.md`.

## What is fine

Render *functions* that you call directly don't create component types:

```tsx
function Menu({ items }: { items: MenuItem[] }) {
  const renderItem = (item: MenuItem) => <li key={item.id}>{item.label}</li>;
  return <ul>{items.map(renderItem)}</ul>;
}
```

`renderItem(item)` returns elements whose types (`li`) are stable. The limitation is that hooks can't be called inside `renderItem`. Once it needs state or effects, promote it to a module-level component.

## Detection tips

- `eslint-plugin-react-hooks` 7+ (`recommended`) reports components created during render with its `static-components` rule. Enable it.
- Search for `const [A-Z]\w* = (` and `function [A-Z]` *inside* component bodies.
- Search for HOC calls (`with[A-Z]`, `connect(`, `styled.`, `forwardRef(`, `memo(`) that aren't at module scope.
- A mount/unmount log in the suspect component that fires on every parent render confirms it.

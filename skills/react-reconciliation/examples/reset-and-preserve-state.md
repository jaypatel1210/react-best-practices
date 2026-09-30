# Example: Resetting and Preserving State on Purpose

## Reset with a key

### Per-entity drafts

```tsx
function ChatWindow({ conversationId }: { conversationId: string }) {
  return (
    <>
      <MessageHistory conversationId={conversationId} />
      {/* Fresh composer (text, attachments, mention picker state) per conversation */}
      <Composer key={conversationId} conversationId={conversationId} />
    </>
  );
}
```

Only the composer resets. The message history keeps its instance (and, for example, its virtualized scroll container), because resetting it isn't needed. Scope keys to the smallest subtree that should start fresh.

### Per-route forms

```tsx
function EditPage() {
  const { recordId } = useParams();
  return <RecordForm key={recordId} recordId={recordId} />;
}
```

Navigating from `/records/1/edit` to `/records/2/edit` renders the same route component. Without the key, `RecordForm` keeps record 1's local state (dirty flags, validation messages, uncontrolled inputs) while showing record 2's data.

### What a key reset costs

- The DOM subtree is destroyed and recreated. Images may re-decode, and iframes and videos reload.
- Effects clean up and run again, including data fetches (with a data library, the cache often makes this cheap).
- Focus, text selection and scroll positions inside the subtree are lost.

For a small form this is negligible. For a large editor or a map, reset the specific state instead, or key a smaller part.

## Unintended resets: conditional wrappers

```tsx
function Toolbar({ isCompact, children }: { isCompact: boolean; children: React.ReactNode }) {
  return isCompact ? <OverflowMenu>{children}</OverflowMenu> : <div className="toolbar">{children}</div>;
}
```

When `isCompact` flips, `children` moves from inside `OverflowMenu` to inside a `div`. The parent type changed, so every child remounts: dropdowns close, inputs clear, and effects re-run.

Options:

- **Keep one wrapper and restyle it**: `<div className={isCompact ? 'toolbar toolbar--compact' : 'toolbar'}>{children}</div>`.
- **Keep the wrapper's type stable and toggle its behavior** with a prop: `<OverflowMenu collapsed={isCompact}>`.
- **Lift the state the children need** above the toggle, so remounting doesn't lose anything important.

The same applies to optional wrappers like "wrap in a tooltip only when disabled". Render the tooltip wrapper unconditionally and disable it with a prop.

## Unintended resets: loading swaps

```tsx
function ReportEditor({ reportId }: { reportId: string }) {
  const { data, isFetching } = useReport(reportId);
  if (isFetching) return <Spinner />; // background refetch unmounts the editor and drops unsaved edits
  return <Editor report={data} />;
}
```

Show the spinner only while there's no data at all, and keep the editor mounted during background refetches:

```tsx
if (!data) return <Spinner />;
return (
  <>
    {isFetching && <InlineRefreshIndicator />}
    <Editor report={data} />
  </>
);
```

## Preserve state while moving or hiding

### Moving between sibling positions

When an element moves among the *same parent's* children, a stable key lets React move the instance rather than recreate it:

```tsx
function Stage({ layout }: { layout: 'video-first' | 'slides-first' }) {
  return (
    <div className="stage">
      {layout === 'video-first' && <VideoPlayer key="player" />}
      <SlideDeck />
      {layout === 'slides-first' && <VideoPlayer key="player" />}
    </div>
  );
}
```

With the same key and type among the same parent's children, React treats the player as moved, and playback continues. Without the key, the two conditionals are different slots, and the player would remount. This only works among siblings of one parent. Moving to a different parent always remounts.

Often simpler: render the player once and reorder visually with CSS (`order`, grid areas).

### Hiding without losing state

Unmounting a tab panel discards its state. To keep it:

- **Hide it with CSS or the `hidden` attribute.** State and effects stay alive; this is the cheapest to implement.
- **Use `<Activity mode={isActive ? 'visible' : 'hidden'}>`** (React 19.2+). React keeps the hidden subtree's state and DOM but cleans up its effects while hidden, and re-creates them when it becomes visible again. It can also pre-render hidden content at low priority.
- **Lift the state up** or store it in a cache or store, if the panel should be recreated but its data remembered.

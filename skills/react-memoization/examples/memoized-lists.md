# Example: Fast Lists with Memoized Rows

Long lists are where `memo` earns its keep. The goal: when one row changes, or selection moves, only the affected rows re-render.

## Before

```tsx
function Inbox({ messages }: { messages: Message[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());

  return (
    <ul>
      {messages.map((m, index) => (
        <MessageRow
          key={index}                                       // A
          message={m}
          selectedId={selectedId}                           // B
          isStarred={starred.has(m.id)}
          onSelect={() => setSelectedId(m.id)}              // C
          onToggleStar={() => toggleStar(m.id)}             // C
        />
      ))}
    </ul>
  );

  function toggleStar(id: string) {
    setStarred((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
}

const MessageRow = memo(function MessageRow(props: MessageRowProps) { /* … */ });
```

Selecting one message re-renders all 500 rows:

- **(C)** Per-row inline callbacks are new functions for every row on every render.
- **(B)** Each row receives `selectedId`, which changes for *every* row when selection moves.
- **(A)** Index keys: when a new message arrives at the top, every row's key now points to different data, so every row gets new props, and the DOM and state stick to positions rather than messages (see `react-reconciliation`).

## After

```tsx
function Inbox({ messages }: { messages: Message[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [starred, setStarred] = useState<ReadonlySet<string>>(() => new Set());

  // Stable handlers that take the row id as an argument:
  // setSelectedId is already stable; the star toggle uses a functional update, so its deps are [].
  const toggleStar = useCallback((id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <ul>
      {messages.map((m) => (
        <MessageRow
          key={m.id}                          // identity from data
          message={m}                         // same object unless this message changed
          isSelected={m.id === selectedId}    // primitive: changes for only 2 rows
          isStarred={starred.has(m.id)}       // primitive
          onSelect={setSelectedId}            // stable
          onToggleStar={toggleStar}           // stable
        />
      ))}
    </ul>
  );
}

type MessageRowProps = {
  message: Message;
  isSelected: boolean;
  isStarred: boolean;
  onSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
};

const MessageRow = memo(function MessageRow({ message, isSelected, isStarred, onSelect, onToggleStar }: MessageRowProps) {
  return (
    <li aria-selected={isSelected} onClick={() => onSelect(message.id)}>
      <button
        aria-pressed={isStarred}
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar(message.id);
        }}
      >
        ★
      </button>
      {message.subject}
    </li>
  );
});
```

Moving the selection now re-renders exactly two rows: the old and the new selection. Starring a message re-renders one row. A new message at the top mounts one row, and the others keep their keys and props.

The inline arrows *inside* `MessageRow` are fine. They're attached to DOM elements, which don't compare props, and they're recreated only when that row renders.

## Rules that make lists fast

1. **`key` is a stable ID from the data.** If the data has none, assign IDs when the data enters the app (on fetch or creation), never during render.
2. **Row props are primitives or references that change only when that row's data changes.** Pass `isSelected: boolean` rather than `selectedId`, and `isStarred` rather than the whole set.
3. **Handlers are stable and receive the ID as an argument** instead of being created per row. If a handler must read changing state, use a latest-ref callback (`react-refs-closures`) rather than adding the state to `useCallback` deps.
4. **Immutable updates for changed items only.** `messages.map((m) => (m.id === id ? { ...m, read: true } : m))` keeps every other message object identical, so their rows skip.
5. **For very long lists, virtualize** (see `react-rerenders/examples/unavoidable-heavy-renders.md`). Memoized rows still matter inside a virtualized list, because scrolling re-renders the container.

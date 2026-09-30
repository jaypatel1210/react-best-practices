# Example: Reviewing a React Component End to End

This walkthrough shows the expected shape of a React review: concrete findings, ordered by impact, each tied to a failure scenario and a fix.

## The code under review

```tsx
// TeamDirectory.tsx
const MemberCard = memo(function MemberCard({ member, style, onMessage, children }: MemberCardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article style={style} data-id={member.id}>
      {children}
      <h3><button onClick={() => setExpanded((e) => !e)}>{member.name}</button></h3>
      {expanded && <MemberDetails member={member} />}
      <button onClick={() => onMessage()}>Message</button>
    </article>
  );
});

export function TeamDirectory({ teamId }: { teamId: string }) {
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/teams/${teamId}/members`)
      .then((r) => r.json())
      .then(setMembers);
  }, [teamId]);

  const Avatar = ({ src }: { src: string }) => <img src={src} className="avatar" alt="" />;

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value), []);

  const visible = members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div onMouseMove={(e) => setHoveredId((e.target as HTMLElement).closest('article')?.dataset.id ?? null)}>
      <input value={query} onChange={handleSearch} placeholder="Search people" />
      <HoverPreview memberId={hoveredId} />
      {visible.map((m, i) => (
        <MemberCard key={i} member={m} style={{ padding: 12 }} onMessage={() => openChat(m.id)}>
          <Avatar src={m.avatarUrl} />
        </MemberCard>
      ))}
    </div>
  );
}
```

## The review

### [High] Switching teams can show the wrong team's members — `TeamDirectory.tsx:19`
**What happens:** Open team A, then quickly team B. If A's response arrives after B's, the directory shows A's members under B's header. A 500 response is also parsed and stored as if it were data.
**Why:** `TeamDirectory` stays mounted across `teamId` changes, and every in-flight request calls the same `setMembers`. The last response to resolve wins. `fetch` doesn't reject on HTTP errors.
**Fix:**
```tsx
useEffect(() => {
  const controller = new AbortController();
  fetch(`/api/teams/${teamId}/members`, { signal: controller.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`Members ${r.status}`);
      return r.json();
    })
    .then(setMembers)
    .catch((err) => {
      if (err.name !== 'AbortError') setError(err);
    });
  return () => controller.abort();
}, [teamId]);
```
(Or use the project's data library, which handles both.)

### [High] Avatars remount on every keystroke and mouse move — `TeamDirectory.tsx:25`
**What happens:** Every render (each keystroke and each hover change) creates a new `Avatar` component type. React unmounts and remounts every avatar, so images flicker or reload, and all of it costs mount-level work.
**Why:** A component defined inside another component is a new type on each render, and a type change means remount.
**Fix:** Move `Avatar` to module scope, or pass `avatarUrl` to `MemberCard` and render the `<img>` there.

### [Medium] Index keys attach expanded state to positions, not people — `TeamDirectory.tsx:36`
**What happens:** Expand "Priya", then type in the search box. The filtered list shifts, and a different person appears expanded in Priya's position.
**Why:** `key={i}` identifies cards by index. When filtering changes which member sits at an index, React reuses that instance, including its `expanded` state, for the new member.
**Fix:** `key={m.id}`.

### [Medium] `memo(MemberCard)` never skips a render — `TeamDirectory.tsx:36-37`
**What happens:** Every hover or keystroke re-renders every card, despite `memo`.
**Why:** Three props are new on every render: `style={{ padding: 12 }}`, the inline `onMessage` arrow, and `children` (the `<Avatar />` element).
**Fix:** Hoist the style (`const CARD_STYLE = { padding: 12 }`, or a CSS class), pass a stable handler that takes the ID (`onMessage={openChat}`, called as `onMessage(member.id)` inside the card), and pass `avatarUrl` instead of a JSX child. Or drop `memo` if the cards are cheap. Measure first.

### [Medium] Mouse movement re-renders the whole directory — `TeamDirectory.tsx:32`
**What happens:** Moving the pointer across cards sets `hoveredId` at the top level, re-rendering the search input, the preview and every card (made worse by the broken `memo` above).
**Why:** State that changes at pointer frequency lives in the component that renders the entire list.
**Fix:** Move the hover tracking and `HoverPreview` into a small component that wraps the list and receives it as `children`, so only the preview re-renders. If the hover effect is purely visual, use CSS `:hover`.

### [Low] `useCallback` on `handleSearch` has no effect — `TeamDirectory.tsx:27`
**Why:** It's passed only to a DOM `<input>`, which doesn't compare props, and it's not a dependency anywhere.
**Fix:** Inline it: `onChange={(e) => setQuery(e.target.value)}`.

### Looks good

- Filtering is derived during render instead of being synced into state with an effect.
- `MemberCard` uses a functional update for `expanded`.

## Notes on the format

- **Findings are ordered by user impact.** Wrong data comes before wasted renders, which come before noise.
- **Each finding names a concrete scenario** a tester could reproduce, not just a rule.
- **Fixes are minimal and local.** The review doesn't propose rewriting the component.
- **Related issues are connected** (the broken `memo` amplifies the hover problem) instead of being counted twice.
- **"Looks good" is brief and only mentions choices worth keeping.**

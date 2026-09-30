# Example: Choosing List Keys

A key answers one question for React: *which item from the previous render is this?* Everything attached to an instance (state, DOM nodes, focus, uncontrolled input values, running effects) follows the key.

## Scenario 1: index keys with local state

```tsx
function Checklist({ tasks }: { tasks: Task[] }) {
  return (
    <ul>
      {tasks.map((task, index) => (
        <ChecklistItem key={index} task={task} /> // has internal "expanded" state and a note input
      ))}
    </ul>
  );
}
```

A new task is inserted at the top. With index keys:

- key `0` used to be "Buy milk" and is now "Call dentist", so React reuses the instance and "Call dentist" inherits "Buy milk"'s expanded state and the half-typed note in its input;
- every other row also receives a different task, so every row re-renders;
- a new instance mounts at the end for the last task.

With `key={task.id}`:

- the existing instances keep their own tasks, state and DOM;
- React inserts one new row at the top;
- if `ChecklistItem` is `memo`-wrapped, the existing rows don't even re-render.

The same problem appears when sorting, filtering or deleting. Index keys attach state to *positions*, not *items*.

## Scenario 2: no ID in the data

A CSV import produces rows without IDs. Don't generate keys during render:

```tsx
// Wrong: every render remounts every row
rows.map((row) => <ImportRow key={crypto.randomUUID()} row={row} />);
```

Assign IDs once, when the data enters the app:

```tsx
function parseImport(csv: string): ImportRow[] {
  return parseCsv(csv).map((cells) => ({ id: crypto.randomUUID(), cells }));
}

const [rows, setRows] = useState(() => parseImport(file.text));
rows.map((row) => <ImportRowEditor key={row.id} row={row} />);
```

If rows come from a server that lacks IDs, derive a stable key from content that's unique and doesn't change while the row is on screen (for example `${row.date}:${row.account}`). Otherwise, add IDs when you receive the response.

## Scenario 3: IDs unique only within groups

```tsx
{sections.map((section) => (
  <Section key={section.id} title={section.title}>
    {section.items.map((item) => (
      <Row key={item.id} item={item} /> // unique among this section's rows: fine
    ))}
  </Section>
))}
```

Keys only need to be unique among siblings. If you flatten sections into one list, compose the key instead: `` key={`${section.id}:${item.id}`} ``.

## When index keys are acceptable

All of these must be true:

- The list is static: never reordered, filtered, inserted into or removed from while mounted.
- Items have no internal state, uncontrolled inputs or focusable elements whose identity matters.
- Items aren't memoized components, or it doesn't matter if they all re-render.

Examples: a fixed set of footer links, skeleton placeholders, a static list of feature bullets.

## Keys versus `memo`

- A key doesn't stop a row from re-rendering. It tells React *which* instance to update.
- `memo` stops a row from re-rendering when its props are unchanged.
- Together they make lists fast: a stable key keeps the same item attached to the same instance, so its props really are unchanged, so `memo` can skip it.

## Mixing mapped and static children

```tsx
<ul>
  {tasks.map((t) => <TaskRow key={t.id} task={t} />)}
  <AddTaskRow /> {/* doesn't remount when tasks are added */}
</ul>
```

The mapped array occupies a single slot among the `<ul>`'s children, so `AddTaskRow` keeps its position (and its input's contents) no matter how the array changes.

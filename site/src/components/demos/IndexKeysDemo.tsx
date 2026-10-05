import { useLayoutEffect, useRef, useState } from 'react';
import { DemoShell } from './kit';
import './IndexKeysDemo.css';

interface Task {
  id: number;
  title: string;
  note: string;
}

const INITIAL: Task[] = [
  { id: 1, title: 'Book flights', note: 'Window seat, leave before 9' },
  { id: 2, title: 'Renew passport', note: '' },
  { id: 3, title: 'Pack chargers', note: '' },
];

const MORE = ['Call the hotel', 'Water the plants', 'Print the tickets', 'Exchange currency', 'Pause the mail'];

/** Each row has React state (expanded) and DOM state (an uncontrolled note input). */
function TaskRow({ task, keyLabel }: { task: Task; keyLabel: string }) {
  const [expanded, setExpanded] = useState(task.id === 1);
  const noteRef = useRef<HTMLInputElement>(null);

  // Stands in for a note the user already typed. Writing the DOM value once, on mount, makes it
  // behave like typed text: it belongs to this input element, whichever task the row shows later.
  useLayoutEffect(() => {
    if (noteRef.current && task.note) noteRef.current.value = task.note;
    // Mount only, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <li className="ikd-row" data-expanded={expanded}>
      <div className="ikd-main">
        <button
          type="button"
          className="ikd-toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${task.title}`}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span className="ikd-title">{task.title}</span>
        <code className="ikd-key">key={keyLabel}</code>
      </div>
      <input ref={noteRef} className="demo-input ikd-note" placeholder="Add a note…" aria-label={`Note for ${task.title}`} />
      {expanded && <p className="ikd-details">Checklist for “{task.title}” is open.</p>}
    </li>
  );
}

function TaskList({ useIds }: { useIds: boolean }) {
  const [tasks, setTasks] = useState(INITIAL);
  const [nextId, setNextId] = useState(4);

  const addOnTop = () => {
    const title = MORE[(nextId - 4) % MORE.length];
    setTasks((list) => [{ id: nextId, title, note: '' }, ...list]);
    setNextId((id) => id + 1);
  };
  const sort = () => setTasks((list) => [...list].sort((a, b) => a.title.localeCompare(b.title)));
  const removeFirst = () => setTasks((list) => list.slice(1));

  return (
    <>
      <div className="demo-row">
        <button type="button" className="demo-btn demo-btn-primary" onClick={addOnTop}>
          Add task at top
        </button>
        <button type="button" className="demo-btn" onClick={sort}>
          Sort A–Z
        </button>
        <button type="button" className="demo-btn" onClick={removeFirst} disabled={tasks.length === 0}>
          Remove first
        </button>
      </div>
      <ul className="ikd-list">
        {tasks.map((task, index) =>
          useIds ? (
            <TaskRow key={task.id} task={task} keyLabel={`${task.id}`} />
          ) : (
            <TaskRow key={index} task={task} keyLabel={`${index}`} />
          ),
        )}
      </ul>
    </>
  );
}

export default function IndexKeysDemo() {
  return (
    <DemoShell
      title="Add a task at the top and watch the notes"
      hint="“Book flights” starts expanded with a note. Press “Add task at top” or “Sort A–Z”, then check which task the note and the open checklist belong to."
      issueLabel="key={index}"
      fixLabel="key={task.id}"
      explain={{
        issue: (
          <>
            With index keys, React matches rows by position. The new task takes key 0, so it inherits the old first
            row’s instance: its expanded state and the note typed into its input.
          </>
        ),
        fix: (
          <>
            With stable IDs, each instance stays attached to its own task. React inserts one new row at the top, and
            every note and open checklist stays where it belongs.
          </>
        ),
      }}
    >
      {(mode) => <TaskList useIds={mode === 'fix'} />}
    </DemoShell>
  );
}

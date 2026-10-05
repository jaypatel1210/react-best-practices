import { useRef, useState } from 'react';
import { useDebouncedCallback } from '@skills/react-refs-closures/assets/use-debounced-callback';
import { DemoShell, Meter } from './kit';
import './DebounceDemo.css';

const DELAY = 400;

interface TimelineEvent {
  t: number;
  kind: 'key' | 'request';
  label: string;
}

/** A classic debounce helper, as found in many codebases. Fine in itself; the bug is where it's called. */
function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

type Add = (kind: TimelineEvent['kind'], label: string) => void;

function SearchInput({ value, onType }: { value: string; onType: (value: string) => void }) {
  return (
    <input
      className="demo-input"
      value={value}
      onChange={(event) => onType(event.target.value)}
      placeholder="Type a search, e.g. react hooks"
      aria-label="Search"
    />
  );
}

/** The issue: a new debounced function, with its own timer, on every render. */
function SearchWithDebounceInRender({ add }: { add: Add }) {
  const [text, setText] = useState('');
  const search = debounce((query: string) => add('request', query), DELAY);
  return (
    <SearchInput
      value={text}
      onType={(value) => {
        setText(value);
        add('key', value);
        search(value);
      }}
    />
  );
}

/** The fix: one debounced function per component instance, from the tested hook. */
function SearchWithStableDebounce({ add }: { add: Add }) {
  const [text, setText] = useState('');
  const search = useDebouncedCallback((query: string) => add('request', query), DELAY);
  return (
    <SearchInput
      value={text}
      onType={(value) => {
        setText(value);
        add('key', value);
        search(value);
      }}
    />
  );
}

function Stage({ mode }: { mode: 'issue' | 'fix' }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const start = useRef<number | null>(null);

  const add: Add = (kind, label) => {
    const now = performance.now();
    start.current ??= now;
    const t = now - start.current;
    setEvents((list) => [...list, { t, kind, label }]);
  };

  const keys = events.filter((e) => e.kind === 'key');
  const requests = events.filter((e) => e.kind === 'request');
  const span = Math.max(6000, (events.at(-1)?.t ?? 0) + 600);
  const position = (t: number) => `${(t / span) * 100}%`;

  return (
    <>
      {mode === 'issue' ? <SearchWithDebounceInRender add={add} /> : <SearchWithStableDebounce add={add} />}
      <div className="meters">
        <Meter label="Keystrokes" initial={keys.length} />
        <Meter label={`Requests sent (${DELAY} ms debounce)`} initial={requests.length} tone={requests.length > 1 && requests.length >= keys.length ? 'bad' : undefined} />
      </div>
      <div className="lanes" aria-hidden="true">
        <div className="lane">
          <span className="lane-label">keystrokes</span>
          <div className="lane-track">
            {keys.map((e, i) => (
              <i key={i} className="ddm-mark" style={{ left: position(e.t) }} />
            ))}
          </div>
        </div>
        <div className="lane">
          <span className="lane-label">requests</span>
          <div className="lane-track">
            {requests.map((e, i) => (
              <i key={i} className="ddm-mark ddm-request" style={{ left: position(e.t) }} />
            ))}
          </div>
        </div>
      </div>
      <ol className="log" data-empty="Requests appear here.">
        {requests
          .slice()
          .reverse()
          .map((e, i) => (
            <li key={requests.length - i}>
              <time>{(e.t / 1000).toFixed(2)}s</time>
              <span data-tone={mode === 'issue' ? 'bad' : 'good'}>GET /search?q={encodeURIComponent(e.label)}</span>
            </li>
          ))}
      </ol>
    </>
  );
}

export default function DebounceDemo() {
  return (
    <DemoShell
      title="Type a search and count the requests"
      hint="Type a few words at a normal speed, then stop. Compare the two lanes."
      issueLabel="debounce() in render"
      fixLabel="useDebouncedCallback"
      explain={{
        issue: (
          <>
            Each keystroke re-renders the component, which creates a new debounced function with its own timer. Each
            timer sees exactly one call, so every keystroke sends a request, 400 ms late.
          </>
        ),
        fix: (
          <>
            The hook creates the debounced function once and keeps it across renders. Each keystroke restarts the same
            timer, so one request goes out after you stop typing, with the latest text.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

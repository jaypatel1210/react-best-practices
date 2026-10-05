import { memo, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { DemoShell, Meter, type DemoMode } from './kit';
import './VirtualListDemo.css';

const ENTRY_COUNT = 10_000;
const ROW_HEIGHT = 30;
const VIEWPORT_HEIGHT = 360;
const OVERSCAN = 8;
const formatCount = new Intl.NumberFormat('en-US').format;

type Tone = 'add' | 'remove' | 'change';

interface AuditEntry {
  id: string;
  time: string;
  actor: string;
  action: string;
  tone: Tone;
  target: string;
}

const ACTORS = ['ada@northwind.dev', 'ben@northwind.dev', 'chloe@northwind.dev', 'dev@northwind.dev', 'ci-bot'];
const ACTIONS: [string, Tone][] = [
  ['member.invited', 'add'],
  ['role.updated', 'change'],
  ['token.revoked', 'remove'],
  ['project.created', 'add'],
  ['webhook.deleted', 'remove'],
  ['billing.changed', 'change'],
];
const TARGETS = ['project/atlas', 'project/billing', 'team/design', 'org/settings', 'webhook/deploys', 'token/ci'];

let cachedEntries: AuditEntry[] | null = null;

/** Deterministic fake log entries, newest first, built on first use. */
function getEntries(): AuditEntry[] {
  cachedEntries ??= Array.from({ length: ENTRY_COUNT }, (_, i) => {
    const seconds = (86_400 - ((i * 8) % 86_400)) % 86_400;
    const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    const [action, tone] = ACTIONS[(i * 5) % ACTIONS.length];
    return {
      id: `evt_${String(ENTRY_COUNT - i).padStart(5, '0')}`,
      time,
      actor: ACTORS[(i * 7) % ACTORS.length],
      action,
      tone,
      target: TARGETS[(i * 3) % TARGETS.length],
    };
  });
  return cachedEntries;
}

/** One row. Its props are primitives or stable objects, so memo skips rows that stay on screen. */
const AuditRow = memo(function AuditRow({ entry, rowIndex, top }: { entry: AuditEntry; rowIndex: number; top?: number }) {
  const position = top === undefined ? undefined : ({ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${top}px)` } as const);
  return (
    <div role="row" aria-rowindex={rowIndex} className="vl-row" style={{ height: ROW_HEIGHT, ...position }}>
      <span role="cell" className="vl-time">
        {entry.time}
      </span>
      <span role="cell">{entry.actor}</span>
      <span role="cell">
        <i className="vl-dot" data-tone={entry.tone} aria-hidden="true" />
        {entry.action}
      </span>
      <span role="cell">{entry.target}</span>
    </div>
  );
});

/** The issue: one row per entry, all 10,000 of them, in normal document flow. */
function AllRows({ entries }: { entries: AuditEntry[] }) {
  return entries.map((entry, index) => <AuditRow key={entry.id} entry={entry} rowIndex={index + 2} />);
}

/** The fix: a spacer as tall as the whole log, and only the rows in view plus a few on each side. */
function WindowedRows({ entries, start }: { entries: AuditEntry[]; start: number }) {
  const first = Math.max(0, start - OVERSCAN);
  const last = Math.min(entries.length, start + Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + 1 + OVERSCAN);
  return (
    <div style={{ position: 'relative', height: entries.length * ROW_HEIGHT }}>
      {entries.slice(first, last).map((entry, i) => (
        <AuditRow key={entry.id} entry={entry} rowIndex={first + i + 2} top={(first + i) * ROW_HEIGHT} />
      ))}
    </div>
  );
}

function write(ref: RefObject<HTMLElement | null>, text: string, tone?: 'bad' | 'good') {
  const out = ref.current;
  if (!out) return;
  out.textContent = text;
  if (tone) out.closest<HTMLElement>('.meter')?.setAttribute('data-tone', tone);
}

function Stage({ mode }: { mode: DemoMode }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [start, setStart] = useState(0); // index of the first visible row (fix mode)
  const clickedAt = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLElement>(null);
  const rowsRef = useRef<HTMLElement>(null);
  const nodesRef = useRef<HTMLElement>(null);

  // After every commit, report what is really in the DOM. After the first one, also report how long it took.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !entries) return;
    if (clickedAt.current) {
      void body.scrollHeight; // force layout now, so the time includes it
      const ms = performance.now() - clickedAt.current;
      clickedAt.current = 0;
      write(mountRef, `${formatCount(Math.round(ms))} ms`, ms > 50 ? 'bad' : 'good');
    }
    write(rowsRef, formatCount(body.querySelectorAll('[role="row"]').length));
    write(nodesRef, formatCount(body.getElementsByTagName('*').length));
  });

  const load = () => {
    const data = getEntries();
    clickedAt.current = performance.now();
    setEntries(data);
  };

  return (
    <>
      <div className="meters">
        <Meter label="Mount time (render, commit, layout)" outRef={mountRef} />
        <Meter label="Rows in the DOM" outRef={rowsRef} />
        <Meter label="Elements in the list" outRef={nodesRef} />
      </div>
      <div className="demo-row">
        <button type="button" className="demo-btn demo-btn-primary" onClick={load} disabled={entries !== null}>
          Load 10,000 entries
        </button>
      </div>
      <div className="vl-log" role="table" aria-label="Audit log" aria-rowcount={entries ? entries.length + 1 : undefined}>
        <div role="rowgroup">
          <div role="row" aria-rowindex={1} className="vl-row vl-head" style={{ height: ROW_HEIGHT }}>
            <span role="columnheader">Time</span>
            <span role="columnheader">Actor</span>
            <span role="columnheader">Action</span>
            <span role="columnheader">Target</span>
          </div>
        </div>
        <div
          ref={bodyRef}
          role="rowgroup"
          className="vl-body"
          style={{ height: VIEWPORT_HEIGHT }}
          tabIndex={0}
          aria-label="Audit log entries"
          onScroll={mode === 'fix' ? (event) => setStart(Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT)) : undefined}
        >
          {!entries ? (
            <p className="vl-empty">Press Load to render the log.</p>
          ) : mode === 'issue' ? (
            <AllRows entries={entries} />
          ) : (
            <WindowedRows entries={entries} start={start} />
          )}
        </div>
      </div>
    </>
  );
}

export default function VirtualListDemo() {
  return (
    <DemoShell
      title="Render a 10,000-entry audit log"
      hint="Press Load, then scroll the log from top to bottom. Watch the mount time and how many rows exist in the DOM."
      issueLabel="Render every row"
      fixLabel="Render the window"
      explain={{
        issue: (
          <>
            Every entry becomes a row, so React renders 10,000 components and the browser lays out tens of thousands
            of elements before anything appears, although only a dozen rows fit in the box.
          </>
        ),
        fix: (
          <>
            A spacer gives the scrollbar the full height, and only the visible rows plus 8 on each side exist. Scrolling
            swaps rows in and out, and the row count stays near 30 wherever you are.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

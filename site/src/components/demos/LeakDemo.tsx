import { useEffect, useState } from 'react';
import { DemoShell, Meter, Tracked, type DemoMode } from './kit';
import './LeakDemo.css';

const TICK_MS = 1000;

/** A fake metrics feed that lives outside React, like a socket or an SDK client. */
function createMetricsFeed() {
  const handlers = new Set<(value: number) => void>();
  let tick = 0;
  let callsLastTick = 0;
  return {
    subscribe(handler: (value: number) => void) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    emit() {
      tick += 1;
      const value = 380 + ((tick * 37) % 90);
      callsLastTick = 0;
      handlers.forEach((handler) => {
        callsLastTick += 1;
        handler(value);
      });
    },
    stats: () => ({ attached: handlers.size, callsLastTick }),
  };
}

type MetricsFeed = ReturnType<typeof createMetricsFeed>;

/** The issue: the effect subscribes and never unsubscribes. */
function LeakyMetricsPanel({ feed }: { feed: MetricsFeed }) {
  const [requestsPerSecond, setRequestsPerSecond] = useState<number | null>(null);

  useEffect(() => {
    feed.subscribe((value) => setRequestsPerSecond(value));
  }, [feed]);

  return <PanelView tag="no cleanup" value={requestsPerSecond} />;
}

/** The fix: return the unsubscribe function, so React calls it on unmount. */
function CleanMetricsPanel({ feed }: { feed: MetricsFeed }) {
  const [requestsPerSecond, setRequestsPerSecond] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = feed.subscribe((value) => setRequestsPerSecond(value));
    return unsubscribe;
  }, [feed]);

  return <PanelView tag="returns unsubscribe" value={requestsPerSecond} />;
}

function PanelView({ tag, value }: { tag: string; value: number | null }) {
  return (
    <Tracked
      name="LiveMetricsPanel"
      kind="state"
      tag={tag}
      note={
        <span className="lkd-value">
          Requests per second: <b>{value ?? 'waiting for the next tick…'}</b>
        </span>
      }
    />
  );
}

/** Reads the feed's counters on its own interval, which it clears on unmount. */
function FeedMeters({ feed, open, opens }: { feed: MetricsFeed; open: boolean; opens: number }) {
  const [stats, setStats] = useState(feed.stats);

  useEffect(() => {
    const id = setInterval(() => {
      const next = feed.stats();
      setStats((prev) =>
        prev.attached === next.attached && prev.callsLastTick === next.callsLastTick ? prev : next,
      );
    }, 250);
    return () => clearInterval(id);
  }, [feed]);

  const expected = open ? 1 : 0;
  const tone = stats.attached > expected ? 'bad' : 'good';
  return (
    <div className="meters">
      <Meter label="Handlers attached to the feed" initial={stats.attached} tone={tone} />
      <Meter label="Handler calls on the last tick" initial={stats.callsLastTick} tone={tone} />
      <Meter label="Times the panel was opened" initial={opens} />
    </div>
  );
}

function Stage({ mode }: { mode: DemoMode }) {
  const [feed] = useState(createMetricsFeed);
  const [open, setOpen] = useState(false);
  const [opens, setOpens] = useState(0);

  useEffect(() => {
    const id = setInterval(feed.emit, TICK_MS);
    return () => clearInterval(id);
  }, [feed]);

  const Panel = mode === 'issue' ? LeakyMetricsPanel : CleanMetricsPanel;

  return (
    <>
      <FeedMeters feed={feed} open={open} opens={opens} />
      <div className="demo-row">
        <button
          type="button"
          className="demo-btn demo-btn-primary"
          aria-expanded={open}
          onClick={() => {
            if (!open) setOpens((n) => n + 1);
            setOpen(!open);
          }}
        >
          {open ? 'Close live metrics' : 'Open live metrics'}
        </button>
        <span className="lkd-status">{open ? 'Panel mounted' : 'Panel unmounted'}</span>
      </div>
      {open ? <Panel feed={feed} /> : <p className="lkd-closed">The panel is closed, so it isn’t in the tree.</p>}
    </>
  );
}

export default function LeakDemo() {
  return (
    <DemoShell
      title="Open and close a live metrics panel"
      hint="Open and close the panel four or five times, then leave it closed and watch the counters. Switch to the fix and do the same."
      issueLabel="No cleanup"
      fixLabel="With cleanup"
      explain={{
        issue: (
          <>
            The effect subscribes but returns no cleanup. Closing the panel unmounts it, yet its handler stays in the
            feed, so every visit adds one more handler that runs on each tick for a component that no longer exists.
          </>
        ),
        fix: (
          <>
            The effect returns the unsubscribe function, and React calls it when the panel unmounts. The count is 1
            while the panel is open and 0 once it closes, however many times you open it.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

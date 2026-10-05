import { useEffect, useRef, useState } from 'react';
import { DemoShell, Meter } from './kit';

const TICK_MS = 800;
const MAX_LOG = 40;

function appendLog(list: HTMLOListElement | null, text: string, tone?: 'bad' | 'good') {
  if (!list) return;
  const item = document.createElement('li');
  item.textContent = text;
  if (tone) item.dataset.tone = tone;
  list.prepend(item);
  while (list.children.length > MAX_LOG) list.lastElementChild?.remove();
}

function TimerControls({ count, running, onToggle }: { count: number; running: boolean; onToggle: () => void }) {
  return (
    <>
      <div className="meters">
        <Meter label="count (what React renders)" initial={count} />
      </div>
      <div className="demo-row">
        <button type="button" className="demo-btn demo-btn-primary" onClick={onToggle}>
          {running ? 'Stop the timer' : 'Start the timer'}
        </button>
      </div>
    </>
  );
}

/** The issue: the interval is set up once and keeps the `count` from the render that created it. */
function TimerWithStaleCount() {
  const [count, setCount] = useState(0);
  const [running, setRunning] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!running) return;
    let tick = 0;
    const id = setInterval(() => {
      tick += 1;
      setCount(count + 1);
      appendLog(logRef.current, `tick ${tick}: setCount(count + 1) where count = ${count}`, 'bad');
    }, TICK_MS);
    return () => clearInterval(id);
    // The bug on purpose: `count` is missing from the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return (
    <>
      <TimerControls count={count} running={running} onToggle={() => setRunning((r) => !r)} />
      <ol ref={logRef} className="log" data-empty="Start the timer to see each tick." />
    </>
  );
}

/** The fix: a functional update reads the current state instead of the captured one. */
function TimerWithUpdater() {
  const [count, setCount] = useState(0);
  const [running, setRunning] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!running) return;
    let tick = 0;
    const id = setInterval(() => {
      tick += 1;
      setCount((c) => c + 1);
      appendLog(logRef.current, `tick ${tick}: setCount(c => c + 1), React passes the latest c`, 'good');
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  return (
    <>
      <TimerControls count={count} running={running} onToggle={() => setRunning((r) => !r)} />
      <ol ref={logRef} className="log" data-empty="Start the timer to see each tick." />
    </>
  );
}

export default function StaleIntervalDemo() {
  return (
    <DemoShell
      title="Start the timer and watch the count"
      hint="Press Start and let it tick for a few seconds. The log shows what each tick actually calls."
      issueLabel="setCount(count + 1)"
      fixLabel="setCount(c => c + 1)"
      explain={{
        issue: (
          <>
            The interval callback was created during the render where <code>count</code> was 0, and the effect never
            re-runs. Every tick sets the count to 0 + 1, so it sticks at 1 while the timer keeps firing.
          </>
        ),
        fix: (
          <>
            The updater function receives the current state each time, so the callback doesn’t need a fresh closure.
            The effect still runs once, and the count goes up.
          </>
        ),
      }}
    >
      {(mode) => (mode === 'issue' ? <TimerWithStaleCount /> : <TimerWithUpdater />)}
    </DemoShell>
  );
}

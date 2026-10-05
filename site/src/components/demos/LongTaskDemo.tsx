import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useInView } from '@skills/react-large-lists/assets/use-in-view';
import { runInChunks } from '@skills/react-responsiveness/assets/yield-to-main';
import { DemoShell, Meter, burn, type DemoMode } from './kit';
import './LongTaskDemo.css';

const ROW_COUNT = 60_000;
/** Simulated parsing and validation: about 25 µs a row, charged every 100 rows so coarse timers stay accurate. */
const COST_PER_100_ROWS_MS = 2.5;
const CATEGORIES = ['Groceries', 'Rent', 'Transport', 'Dining', 'Utilities', 'Travel'];
const MERCHANTS = ['Corner Grocer', 'City Transit', 'Blue Door Cafe', 'Northwind Power', 'Skyline Air', 'Harbor Homes'];
const formatCount = new Intl.NumberFormat('en-US').format;

/** A fake bank export, produced line by line, the same every time. Every 97th row has a broken amount. */
function* csvLines(): Generator<string> {
  for (let i = 0; i < ROW_COUNT; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((Math.floor(i / 28) % 12) + 1).padStart(2, '0');
    const amount = i % 97 === 0 ? 'n/a' : (((i * 7919) % 20000) / 100).toFixed(2);
    yield `2026-${month}-${day},${MERCHANTS[i % MERCHANTS.length]},${CATEGORIES[(i * 5) % CATEGORIES.length]},-${amount}`;
  }
}

interface Summary {
  valid: number;
  rejected: number;
  totals: Record<string, number>;
}

function addLine(summary: Summary, line: string, index: number) {
  const [date, , category, amountText] = line.split(',');
  const amount = Number(amountText);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && category && Number.isFinite(amount)) {
    summary.valid += 1;
    summary.totals[category] = (summary.totals[category] ?? 0) + amount;
  } else {
    summary.rejected += 1;
  }
  if (index % 100 === 99) burn(COST_PER_100_ROWS_MS);
}

interface Watch {
  on: boolean;
  longest: number;
}

/** A dot moved by requestAnimationFrame, not CSS, so it stops whenever the main thread is blocked. */
function Heartbeat({ watch }: { watch: { current: Watch } }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const layerRef = useRef<HTMLDivElement>(null);
  const framesRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!inView) return; // no animation loop while the demo is off screen
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let frames = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (watch.current.on) watch.current.longest = Math.max(watch.current.longest, now - last);
      last = now;
      frames += 1;
      if (!still && layerRef.current) {
        layerRef.current.style.transform = `translateX(${(Math.sin(now / 420) + 1) * 50}%)`;
      }
      if (framesRef.current) framesRef.current.textContent = formatCount(frames);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, watch]);

  return (
    <div ref={ref} className="lt-heartbeat">
      <div className="lt-track" aria-hidden="true">
        <div ref={layerRef} className="lt-layer">
          <span className="lt-dot" />
        </div>
      </div>
      <span className="lt-frames">
        Frames painted: <b ref={framesRef}>0</b>
      </span>
    </div>
  );
}

interface Result {
  valid: number;
  rejected: number;
  seconds: number;
}

function Stage({ mode }: { mode: DemoMode }) {
  const watch = useRef<Watch>({ on: false, longest: 0 });
  const controllerRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [longest, setLongest] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Result | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []); // stop a running import on unmount

  const runImport = async () => {
    const started = performance.now();
    watch.current = { on: true, longest: 0 };
    setOutcome(null);
    setLongest(null);
    setProgress(0);

    const summary: Summary = { valid: 0, rejected: 0, totals: {} };
    let lastPercent = 0;
    const work = (line: string, index: number) => {
      addLine(summary, line, index);
      const percent = Math.floor(((index + 1) / ROW_COUNT) * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        // At most 100 updates. flushSync renders the bar now instead of queueing behind the loop.
        flushSync(() => setProgress(percent));
      }
    };

    if (mode === 'issue') {
      let index = 0;
      for (const line of csvLines()) work(line, index++); // one task: nothing paints until it ends
    } else {
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        await runInChunks(csvLines(), work, { signal: controller.signal }); // ~10 ms slices
      } catch (error) {
        if (controller.signal.aborted) return; // unmounted: not a failure
        throw error;
      }
    }

    setProgress(null);
    setOutcome({ valid: summary.valid, rejected: summary.rejected, seconds: (performance.now() - started) / 1000 });
    // The first frame after a freeze is the one that measures it, so read the longest gap one frame later.
    requestAnimationFrame(() => {
      watch.current.on = false;
      setLongest(watch.current.longest);
    });
  };

  const status =
    progress !== null
      ? `Importing… ${progress}%`
      : outcome
        ? `Imported ${formatCount(outcome.valid)} rows and rejected ${formatCount(outcome.rejected)}.`
        : 'Ready to import a 60,000-row bank export.';

  return (
    <>
      <div className="meters">
        <Meter
          label="Longest gap between frames"
          initial={longest === null ? '—' : `${formatCount(Math.round(longest))} ms`}
          tone={longest === null ? undefined : longest > 200 ? 'bad' : 'good'}
        />
        <Meter label="Import time" initial={outcome ? `${outcome.seconds.toFixed(2)} s` : '—'} />
      </div>
      <Heartbeat watch={watch} />
      <div className="demo-row">
        <button type="button" className="demo-btn demo-btn-primary" onClick={runImport} disabled={progress !== null}>
          Import 60,000 rows
        </button>
        <span className="lt-status">{status}</span>
      </div>
      <progress className="lt-progress" max={100} value={progress ?? (outcome ? 100 : 0)} aria-label="Import progress" />
    </>
  );
}

export default function LongTaskDemo() {
  return (
    <DemoShell
      title="Import a large CSV and watch the heartbeat"
      hint="Press Import and watch the moving dot and the frame counter. Try scrolling the page or selecting text while it runs."
      issueLabel="One long task"
      fixLabel="Chunks that yield"
      explain={{
        issue: (
          <>
            The whole import runs in one task of about 1.5 seconds. The dot and the counter stop, the page ignores
            you, and the progress bar jumps from 0 to 100 because no frame paints in between.
          </>
        ),
        fix: (
          <>
            <code>runInChunks</code> works in slices of about 10 ms and yields between them, so the browser keeps
            painting frames and handling input. The import takes about as long, and the page never freezes.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { DemoShell, Meter, burn, useWorkMeter, type DemoMode } from './kit';
import './FrozenAnimationDemo.css';

const TASK_MS = 1500;
const TURN_MS = 800;

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(onChange: () => void) {
  const mql = window.matchMedia(reducedMotionQuery);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
}

/** The issue: the angle is React state, set from a requestAnimationFrame loop. */
function StateSpinner({ still }: { still: boolean }) {
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    if (still) return;
    let id = requestAnimationFrame(function tick(now) {
      setAngle(((now % TURN_MS) / TURN_MS) * 360);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [still]);
  return <span className="fa-spinner" style={{ transform: `rotate(${angle}deg)` }} />;
}

/** The fix: a CSS keyframe animation of transform, which the compositor can run on its own. */
function CssSpinner() {
  return <span className="fa-spinner fa-spinner--css" />;
}

/** A readout written by a JavaScript timer. It freezes in both modes while the task runs. */
function TimerClock() {
  const outRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => {
      if (outRef.current) outRef.current.textContent = `${((performance.now() - start) / 1000).toFixed(1)} s`;
    }, 100);
    return () => window.clearInterval(id);
  }, []);
  return <Meter label="Clock driven by a JavaScript timer" outRef={outRef} initial="0.0 s" />;
}

function Stage({ mode }: { mode: DemoMode }) {
  const reducedMotion = usePrefersReducedMotion();
  const meter = useWorkMeter();
  const lastTaskEnd = useRef(0);

  const runTask = (event: MouseEvent<HTMLButtonElement>) => {
    // Clicks made while the page was frozen are delivered afterwards. Skip them.
    if (event.timeStamp < lastTaskEnd.current) return;
    meter.measure();
    burn(TASK_MS); // stands in for parsing, sorting or rendering a large report
    lastTaskEnd.current = performance.now();
  };

  return (
    <>
      <div className="fa-card">
        {mode === 'issue' ? <StateSpinner still={reducedMotion} /> : <CssSpinner />}
        <div>
          <p className="fa-card-title">Building your report…</p>
          <p className="fa-card-text">
            {mode === 'issue' ? 'Spinner angle: React state, set on every frame' : 'Spinner: a CSS animation of transform'}
          </p>
        </div>
      </div>
      <div className="demo-row">
        <button type="button" className="demo-btn demo-btn-primary" onClick={runTask}>
          Run heavy task ({TASK_MS / 1000} s)
        </button>
      </div>
      <div className="meters">
        <TimerClock />
        <Meter label="Main thread blocked for" outRef={meter.outRef} />
      </div>
      {reducedMotion && (
        <p className="fa-note">
          Your system asks for reduced motion, so neither spinner turns here. Turn that setting off to try this demo.
        </p>
      )}
    </>
  );
}

export default function FrozenAnimationDemo() {
  return (
    <DemoShell
      title="Block the main thread and watch the spinner"
      hint={`Press “Run heavy task”, which blocks the main thread for ${TASK_MS / 1000} seconds, and watch the spinner. Try both modes. The clock runs on a JavaScript timer, so it freezes in both: the page is blocked either way.`}
      issueLabel="State-driven spinner"
      fixLabel="CSS spinner"
      explain={{
        issue: (
          <>
            Each frame of the spinner is a <code>setState</code> call from <code>requestAnimationFrame</code>. While the
            task blocks the main thread, no frame callback runs and React can’t render, so the spinner stops exactly when
            it’s needed.
          </>
        ),
        fix: (
          <>
            The spinner is a CSS animation of <code>transform</code>, which the browser runs on its compositor thread, so it
            keeps turning while the task blocks the main thread. The clock still freezes: the page is no more responsive
            than before.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

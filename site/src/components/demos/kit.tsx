import { useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import './demo.css';

export type DemoMode = 'issue' | 'fix';

interface DemoShellProps {
  title: string;
  hint: ReactNode;
  issueLabel?: string;
  fixLabel?: string;
  /** Rendered fresh (remounted) whenever the mode changes or Reset is pressed. */
  children: (mode: DemoMode) => ReactNode;
  /** A one-line explanation of what the current mode shows. */
  explain?: Record<DemoMode, ReactNode>;
  legend?: ReactNode;
}

/** The frame around every live demo: an issue/fix switch, a reset button and a stage. */
export function DemoShell({
  title,
  hint,
  issueLabel = 'With the issue',
  fixLabel = 'With the fix',
  children,
  explain,
  legend,
}: DemoShellProps) {
  const [mode, setMode] = useState<DemoMode>('issue');
  const [run, setRun] = useState(0);
  const id = useId();

  return (
    <section className="demo" data-mode={mode} aria-labelledby={`${id}-title`}>
      <div className="demo-head">
        <div>
          <span className="demo-tag">
            <span className="demo-live" aria-hidden="true" />
            Live demo
          </span>
          <p className="demo-title" id={`${id}-title`}>
            {title}
          </p>
        </div>
        <div className="demo-controls">
          <fieldset className="demo-switch">
            <legend className="visually-hidden">Which version to run</legend>
            <label data-variant="issue">
              <input type="radio" name={`${id}-mode`} checked={mode === 'issue'} onChange={() => setMode('issue')} />
              {issueLabel}
            </label>
            <label data-variant="fix">
              <input type="radio" name={`${id}-mode`} checked={mode === 'fix'} onChange={() => setMode('fix')} />
              {fixLabel}
            </label>
          </fieldset>
          <button type="button" className="demo-btn" onClick={() => setRun((n) => n + 1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4v6h6" />
              <path d="M5.6 15a7.5 7.5 0 1 0 1.8-7.8L4 10" />
            </svg>
            Reset
          </button>
        </div>
      </div>
      <p className="demo-hint">{hint}</p>
      <div className="demo-stage" key={`${mode}-${run}`}>
        {children(mode)}
        {legend && <div className="demo-legend">{legend}</div>}
      </div>
      {explain && (
        <p className="demo-foot" aria-live="polite">
          <span>{explain[mode]}</span>
        </p>
      )}
    </section>
  );
}

/** Blocks the main thread for `ms`, to stand in for an expensive render. Browser only. */
export function burn(ms: number): void {
  if (typeof window === 'undefined' || ms <= 0) return;
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Simulated work.
  }
}

interface TrackedProps {
  /** Component name, shown as <Name>. */
  name: string;
  /** Milliseconds of simulated work each time this component renders. */
  cost?: number;
  /** "state" draws a dashed border for components that own the state being changed. */
  kind?: 'plain' | 'state' | 'memo';
  tag?: string;
  note?: ReactNode;
  row?: boolean;
  children?: ReactNode;
}

/**
 * A visible stand-in for a component. It counts its own commits and flashes on each re-render.
 * The count is written to the DOM in a layout effect, so tracking never causes extra renders.
 */
export function Tracked({ name, cost = 0, kind = 'plain', tag, note, row, children }: TrackedProps) {
  burn(cost);
  const { ref: boxRef, countRef } = useRenderFlash<HTMLDivElement>();

  return (
    <div ref={boxRef} className="tracked" data-kind={kind}>
      <div className="tracked-head">
        <code className="tracked-name">{`<${name}>`}</code>
        {tag && <span className="tracked-tag">{tag}</span>}
        {cost > 0 && <span className="tracked-cost">{cost} ms</span>}
        <span className="tracked-renders">
          renders <b className="tracked-count" ref={countRef} />
        </span>
      </div>
      {note && <p className="tracked-note">{note}</p>}
      {children && <div className={row ? 'tracked-body row' : 'tracked-body'}>{children}</div>}
    </div>
  );
}

/**
 * Counts the commits of the component that calls it and flashes an element on each re-render.
 * Attach `ref` to the element (give it the `flashable` class) and `countRef` to where the count
 * should appear. Used by `Tracked`; use it directly for compact rows.
 */
export function useRenderFlash<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);
  const countRef = useRef<HTMLElement>(null);
  const commits = useRef(0);

  useLayoutEffect(() => {
    commits.current += 1;
    if (countRef.current) countRef.current.textContent = String(commits.current);
    const el = ref.current;
    if (el && commits.current > 1) el.dataset.flash = el.dataset.flash === 'a' ? 'b' : 'a';
  });

  return { ref, countRef };
}

/**
 * Measures how long the main thread stays busy after an interaction: call `measure()` in an
 * event handler and the meter shows the time until the next task can run, which includes
 * React's synchronous render and commit for that event.
 */
export function useWorkMeter(format: (ms: number) => string = (ms) => `${Math.round(ms)} ms`) {
  const outRef = useRef<HTMLElement>(null);
  const measure = () => {
    const start = performance.now();
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const ms = performance.now() - start;
      const out = outRef.current;
      if (out) {
        out.textContent = format(ms);
        out.closest<HTMLElement>('.meter')?.setAttribute('data-tone', ms > 16 ? 'bad' : 'good');
      }
      channel.port1.close();
    };
    channel.port2.postMessage(null);
  };
  return { outRef, measure };
}

export function Meter({
  label,
  outRef,
  initial = '—',
  tone,
}: {
  label: string;
  outRef?: Ref<HTMLElement>;
  initial?: ReactNode;
  tone?: 'bad' | 'good';
}) {
  return (
    <div className="meter" data-tone={tone}>
      <span className="meter-label">{label}</span>
      <b className="meter-value" ref={outRef}>
        {initial}
      </b>
    </div>
  );
}

export function RenderLegend({ state = true, cost = true }: { state?: boolean; cost?: boolean }) {
  return (
    <>
      <span>
        <i className="legend-swatch" data-kind="flash" /> flash = the component re-rendered
      </span>
      {state && (
        <span>
          <i className="legend-swatch" data-kind="state" /> dashed = owns the state that changed
        </span>
      )}
      {cost && <span>“22 ms” tag = simulated render cost</span>}
    </>
  );
}

/** Elapsed time since the demo stage mounted, for log timestamps. */
export function useClock() {
  const start = useRef(0);
  useLayoutEffect(() => {
    start.current = performance.now();
  }, []);
  return () => ((performance.now() - start.current) / 1000).toFixed(2) + 's';
}

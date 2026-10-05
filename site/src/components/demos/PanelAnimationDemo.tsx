import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DemoShell, burn, type DemoMode } from './kit';
import './PanelAnimationDemo.css';

const BUSY_MS = 40;
const STAGES = ['Style', 'Layout', 'Paint', 'Composite'] as const;

const PANELS = [
  {
    id: 'shipping',
    title: 'Shipping details',
    lines: ['Priya Raman', '14 Harbour Street, Apt 5', 'Leeds LS1 4AB', 'Express delivery, arrives Thursday'],
  },
  { id: 'payment', title: 'Payment', lines: ['Visa ending in 4242', 'Billing address same as shipping', 'Charged on dispatch'] },
  { id: 'items', title: 'Items (3)', lines: ['Desk lamp × 1 · $64.00', 'Notebook set × 2 · $56.00', 'Cable organizer × 1 · $12.00'] },
];

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(onChange: () => void) {
  const mql = window.matchMedia(reducedMotionQuery);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
}

/** Simulates a busy app: burns BUSY_MS of main-thread time in every animation frame while on. */
function useBusyMainThread(busy: boolean) {
  useEffect(() => {
    if (!busy) return;
    let id = requestAnimationFrame(function tick() {
      burn(BUSY_MS);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [busy]);
}

interface PanelProps {
  id: string;
  open: boolean;
  children: ReactNode;
}

/** The issue: measure the content, then transition `height`, which needs layout on every frame. */
function HeightPanel({ id, open, children }: PanelProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    setHeight(open ? innerRef.current!.scrollHeight : 0);
  }, [open]);
  return (
    <div id={id} className="pa-height" style={{ height }} inert={!open}>
      <div ref={innerRef} className="pa-body">
        {children}
      </div>
    </div>
  );
}

/** The fix: open the box in one layout and animate the content with transform and opacity. */
function RevealPanel({ id, open, children }: PanelProps) {
  return (
    <div id={id} className="pa-reveal" data-open={open}>
      <div className="pa-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

function Accordion({ mode }: { mode: DemoMode }) {
  const [openIds, setOpenIds] = useState<string[]>([]);
  const baseId = useId();
  const Panel = mode === 'issue' ? HeightPanel : RevealPanel;

  return (
    <div className="pa-accordion">
      {PANELS.map((panel) => {
        const open = openIds.includes(panel.id);
        const panelId = `${baseId}-${panel.id}`;
        return (
          <section key={panel.id} className="pa-section">
            <button
              type="button"
              className="pa-trigger"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpenIds((ids) => (open ? ids.filter((x) => x !== panel.id) : [...ids, panel.id]))}
            >
              <span>{panel.title}</span>
              <span className="pa-chevron" aria-hidden="true" />
            </button>
            <Panel id={panelId} open={open}>
              {panel.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </Panel>
          </section>
        );
      })}
      <div className="pa-total">
        <span>Order total</span>
        <b>$132.00</b>
      </div>
    </div>
  );
}

function Stage({ mode }: { mode: DemoMode }) {
  const [busy, setBusy] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  useBusyMainThread(busy);
  const perFrame: readonly string[] = mode === 'issue' ? STAGES : ['Composite'];

  return (
    <>
      <div className="demo-row">
        <label className="pa-check">
          <input type="checkbox" checked={busy} onChange={(event) => setBusy(event.target.checked)} />
          Busy main thread: {BUSY_MS} ms of work in every frame
        </label>
      </div>
      <div className="pa-pipeline">
        <span className="pa-pipeline-label">Work on each frame of the animation</span>
        <ol className="pa-stages">
          {STAGES.map((stage) => (
            <li key={stage} data-on={perFrame.includes(stage)}>
              {stage}
            </li>
          ))}
        </ol>
      </div>
      {reducedMotion && (
        <p className="pa-note">Your system asks for reduced motion, so this site shortens these animations to an instant change.</p>
      )}
      <Accordion mode={mode} />
    </>
  );
}

export default function PanelAnimationDemo() {
  return (
    <DemoShell
      title="Open the panels while the main thread is busy"
      hint="Open and close a few panels, then tick “Busy main thread” and do it again in both modes. The fix opens the box in one step and animates only the content, which stays smooth while the thread is busy."
      issueLabel="Animate height"
      fixLabel="Animate transform"
      explain={{
        issue: (
          <>
            The panel transitions <code>height</code>. Every frame recalculates style, lays out the panel and everything
            below it, and repaints, all on the main thread, so with the thread busy the motion advances only between tasks
            and steps visibly.
          </>
        ),
        fix: (
          <>
            The box opens in a single layout, and the content slides and fades in with <code>transform</code> and{' '}
            <code>opacity</code>. After its first frame the compositor runs that animation on its own, so busy frames on
            the main thread don’t stall it.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

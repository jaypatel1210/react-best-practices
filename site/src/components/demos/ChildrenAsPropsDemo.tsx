import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { DemoShell, Meter, RenderLegend, Tracked, useWorkMeter } from './kit';
import './ChildrenAsPropsDemo.css';

const MIN = 25;
const MAX = 75;
const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value));

/** Drag and keyboard handling for the divider; both versions of the pane share it. */
function useSplit(measure: () => void) {
  const [split, setSplit] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ left: number; width: number } | null>(null);

  const handleProps = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'vertical' as const,
    'aria-label': 'Resize the panes',
    'aria-valuemin': MIN,
    'aria-valuemax': MAX,
    'aria-valuenow': Math.round(split),
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      // Measure once per drag, not on every move.
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      drag.current = { left: rect.left, width: rect.width };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      if (!drag.current) return;
      measure();
      setSplit(clamp(((event.clientX - drag.current.left) / drag.current.width) * 100));
    },
    onPointerUp() {
      drag.current = null;
    },
    onPointerCancel() {
      drag.current = null;
    },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const step = event.key === 'ArrowLeft' ? -3 : event.key === 'ArrowRight' ? 3 : 0;
      if (!step) return;
      event.preventDefault();
      measure();
      setSplit((value) => clamp(value + step));
    },
  };

  return { split, containerRef, handleProps };
}

function Editor() {
  return <Tracked name="Editor" cost={14} note="A code editor with syntax highlighting." />;
}

function Preview() {
  return <Tracked name="Preview" cost={14} note="A rendered preview of the document." />;
}

function Layout({
  split,
  containerRef,
  handleProps,
  left,
  right,
}: ReturnType<typeof useSplit> & { left: ReactNode; right: ReactNode }) {
  return (
    <div className="cap-split" ref={containerRef} style={{ gridTemplateColumns: `${split}fr 14px ${100 - split}fr` }}>
      <div className="cap-pane">{left}</div>
      <div className="cap-handle" {...handleProps}>
        <span aria-hidden="true" />
      </div>
      <div className="cap-pane">{right}</div>
    </div>
  );
}

/** The issue: the pane owns the width and creates the heavy panels itself. */
function SplitPaneThatOwns({ measure }: { measure: () => void }) {
  const split = useSplit(measure);
  return (
    <Tracked name="SplitPane" kind="state" tag={`owns split: ${Math.round(split.split)}%`}>
      <Layout {...split} left={<Editor />} right={<Preview />} />
    </Tracked>
  );
}

/** The fix: the pane owns the width but receives the panels, created by its parent, as props. */
function SplitPaneThatWraps({ left, right, measure }: { left: ReactNode; right: ReactNode; measure: () => void }) {
  const split = useSplit(measure);
  return (
    <Tracked name="SplitPane" kind="state" tag={`owns split: ${Math.round(split.split)}%`}>
      <Layout {...split} left={left} right={right} />
    </Tracked>
  );
}

function Stage({ mode }: { mode: 'issue' | 'fix' }) {
  const meter = useWorkMeter();
  return (
    <>
      <div className="meters">
        <Meter label="Main-thread work per drag step" outRef={meter.outRef} />
      </div>
      {mode === 'issue' ? (
        <SplitPaneThatOwns measure={meter.measure} />
      ) : (
        <SplitPaneThatWraps left={<Editor />} right={<Preview />} measure={meter.measure} />
      )}
    </>
  );
}

export default function ChildrenAsPropsDemo() {
  return (
    <DemoShell
      title="Drag the divider and watch the panels"
      hint="Drag the handle between the panes (or focus it and press ← and →), then switch versions and drag again."
      issueLabel="Pane renders panels"
      fixLabel="Panels passed in"
      legend={<RenderLegend />}
      explain={{
        issue: (
          <>
            <code>SplitPane</code> creates <code>{'<Editor />'}</code> and <code>{'<Preview />'}</code> in its own
            render, so every width change re-renders both heavy panels.
          </>
        ),
        fix: (
          <>
            The parent creates the panels and passes them as <code>left</code> and <code>right</code>. When the pane
            re-renders, those props are the same element objects as before, so React skips both panels.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

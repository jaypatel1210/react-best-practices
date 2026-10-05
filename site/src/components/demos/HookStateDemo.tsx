import { useEffect, useState, useSyncExternalStore } from 'react';
import { DemoShell, Meter, RenderLegend, Tracked, useWorkMeter } from './kit';

const BREAKPOINT = 768;

/** A stand-in for the browser window: the slider writes to it, the hooks read from it. */
function createViewport(initial: number) {
  let width = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => width,
    set(next: number) {
      width = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type Viewport = ReturnType<typeof createViewport>;

/** The issue: stores the exact pixel width, so every resize event is a state change. */
function useViewportWidth(viewport: Viewport) {
  const [width, setWidth] = useState(viewport.get);
  useEffect(() => viewport.subscribe(() => setWidth(viewport.get())), [viewport]);
  return width;
}

/** The fix: stores only the breakpoint name, so React bails out until it flips. */
function useBreakpoint(viewport: Viewport) {
  return useSyncExternalStore(
    viewport.subscribe,
    () => (viewport.get() < BREAKPOINT ? 'compact' : 'regular'),
    () => 'regular',
  );
}

function Sidebar() {
  return <Tracked name="Sidebar" cost={9} note="Navigation with 40 links." />;
}

function MenuButton() {
  return <Tracked name="MenuButton" note="Compact layout: the sidebar moves into a drawer." />;
}

function Dashboard() {
  return <Tracked name="Dashboard" cost={14} note="Charts and tables." />;
}

function ShellWithPixelHook({ viewport }: { viewport: Viewport }) {
  const width = useViewportWidth(viewport);
  const compact = width < BREAKPOINT;
  return (
    <Tracked name="AppShell" kind="state" tag={`useViewportWidth() → ${width}px`}>
      <div className="tracked-body row">
        {compact ? <MenuButton /> : <Sidebar />}
        <Dashboard />
      </div>
    </Tracked>
  );
}

function ShellWithBreakpointHook({ viewport }: { viewport: Viewport }) {
  const breakpoint = useBreakpoint(viewport);
  return (
    <Tracked name="AppShell" kind="state" tag={`useBreakpoint() → '${breakpoint}'`}>
      <div className="tracked-body row">
        {breakpoint === 'compact' ? <MenuButton /> : <Sidebar />}
        <Dashboard />
      </div>
    </Tracked>
  );
}

function WidthSlider({ viewport, measure }: { viewport: Viewport; measure: () => void }) {
  const [width, setWidth] = useState(viewport.get);
  return (
    <label className="demo-row">
      <span>Viewport width</span>
      <input
        type="range"
        min={360}
        max={1440}
        step={4}
        value={width}
        onChange={(event) => {
          const next = Number(event.target.value);
          measure();
          setWidth(next);
          viewport.set(next);
        }}
        style={{ flex: 1, minWidth: 140 }}
      />
      <output>
        <code>{width}px</code>
      </output>
    </label>
  );
}

function Stage({ mode }: { mode: 'issue' | 'fix' }) {
  const [viewport] = useState(() => createViewport(1024));
  const meter = useWorkMeter();
  return (
    <>
      <WidthSlider viewport={viewport} measure={meter.measure} />
      <div className="meters">
        <Meter label="Main-thread work per resize event" outRef={meter.outRef} />
        <Meter label="Breakpoint" initial={`${BREAKPOINT}px`} />
      </div>
      {mode === 'issue' ? <ShellWithPixelHook viewport={viewport} /> : <ShellWithBreakpointHook viewport={viewport} />}
    </>
  );
}

export default function HookStateDemo() {
  return (
    <DemoShell
      title="Resize the “window” and watch the app shell"
      hint="Drag the slider slowly across 768px. It stands in for resizing the browser window."
      issueLabel="Hook stores pixels"
      fixLabel="Hook stores a breakpoint"
      legend={<RenderLegend />}
      explain={{
        issue: (
          <>
            The shell only needs to know compact or regular, but the hook stores the exact width. Every pixel is a new
            state value, so the shell and everything it renders re-render on every event.
          </>
        ),
        fix: (
          <>
            The hook returns <code>'compact' | 'regular'</code>. While the name stays the same, React bails out, so the
            shell re-renders only when the slider crosses the breakpoint.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

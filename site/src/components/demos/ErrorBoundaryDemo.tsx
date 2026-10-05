import { useState, type ReactNode } from 'react';
import { ErrorBoundary } from '@skills/react-error-handling/assets/error-boundary';
import { DemoShell, Meter, type DemoMode } from './kit';
import './ErrorBoundaryDemo.css';

interface ChartPayload {
  series: number[];
}

const HEALTHY: ChartPayload = { series: [42, 55, 48, 61, 70, 66, 78] };
/** What a backend change might send: the field was renamed, so `series` is missing. */
const MALFORMED = { points: [42, 55, 48] } as unknown as ChartPayload;

/** Throws a real render error on the malformed payload: "Cannot read properties of undefined (reading 'map')". */
function RevenueChart({ payload }: { payload: ChartPayload }) {
  const bars = payload.series.map((value, i) => ({ value, key: i }));
  const max = Math.max(...bars.map((bar) => bar.value));
  return (
    <div className="ebd-bars" role="img" aria-label={`Revenue for the last ${bars.length} days`}>
      {bars.map((bar) => (
        <span key={bar.key} style={{ height: `${(bar.value / max) * 100}%` }} />
      ))}
    </div>
  );
}

function TasksWidget() {
  const [done, setDone] = useState<string[]>([]);
  const tasks = ['Review refunds', 'Approve payouts', 'Update forecast'];
  return (
    <ul className="ebd-tasks">
      {tasks.map((task) => (
        <li key={task}>
          <label>
            <input
              type="checkbox"
              checked={done.includes(task)}
              onChange={() => setDone((prev) => (prev.includes(task) ? prev.filter((t) => t !== task) : [...prev, task]))}
            />
            {task}
          </label>
        </li>
      ))}
    </ul>
  );
}

function ActivityWidget() {
  const [expanded, setExpanded] = useState(false);
  const items = ['Sam closed 4 tickets', 'Lee shipped v3.4', 'Ada updated the forecast', 'Kim invited 2 users'];
  return (
    <>
      <ul className="ebd-feed">
        {(expanded ? items : items.slice(0, 2)).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <button type="button" className="demo-btn" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </>
  );
}

function Widget({ title, failed, children }: { title: string; failed?: boolean; children: ReactNode }) {
  return (
    <section className="ebd-widget" data-failed={failed || undefined}>
      <p className="ebd-widget-title">{title}</p>
      {children}
    </section>
  );
}

interface BoundaryProps {
  title: string;
  onError: () => void;
  onRetry: () => void;
  children: ReactNode;
}

/** The fix: a boundary per widget, with a fallback that fits the widget and a Retry that refetches first. */
function WidgetBoundary({ title, onError, onRetry, children }: BoundaryProps) {
  return (
    <ErrorBoundary
      onError={onError}
      onReset={onRetry}
      fallbackRender={({ resetErrorBoundary }) => (
        <Widget title={title} failed>
          <p className="ebd-note">We couldn’t load this widget.</p>
          <button type="button" className="demo-btn" onClick={resetErrorBoundary}>
            Retry
          </button>
        </Widget>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

function MiniDashboard({ mode, payload, onError, onRetry }: { mode: DemoMode; payload: ChartPayload } & Omit<BoundaryProps, 'title' | 'children'>) {
  const region = (title: string, content: ReactNode) =>
    mode === 'fix' ? (
      <WidgetBoundary title={title} onError={onError} onRetry={onRetry}>
        <Widget title={title}>{content}</Widget>
      </WidgetBoundary>
    ) : (
      <Widget title={title}>{content}</Widget>
    );

  return (
    <div className="ebd-app">
      <header className="ebd-appbar">
        <b>Acme Analytics</b>
        <span>Overview · Reports · Settings</span>
      </header>
      <div className="ebd-grid">
        {region('Revenue', <RevenueChart payload={payload} />)}
        {region('Tasks', <TasksWidget />)}
        {region('Activity', <ActivityWidget />)}
      </div>
    </div>
  );
}

function AppCrashScreen({ onReload }: { onReload: () => void }) {
  return (
    <div className="ebd-crash" role="alert">
      <p className="ebd-crash-title">Something went wrong</p>
      <p className="ebd-note">The whole dashboard is gone, including the widgets that worked. Reloading starts all of them from scratch.</p>
      <button type="button" className="demo-btn" onClick={onReload}>
        Reload the app
      </button>
    </div>
  );
}

function Stage({ mode }: { mode: DemoMode }) {
  const [payload, setPayload] = useState(HEALTHY);
  const [crashed, setCrashed] = useState(false);
  const refetch = () => {
    setPayload(HEALTHY); // stands in for a fresh request that returns valid data
    setCrashed(false);
  };
  const onError = () => setCrashed(true);
  const usable = !crashed ? 3 : mode === 'issue' ? 0 : 2;

  return (
    <>
      <div className="demo-row">
        <button
          type="button"
          className="demo-btn demo-btn-primary"
          disabled={payload === MALFORMED}
          onClick={() => setPayload(MALFORMED)}
        >
          Break the chart
        </button>
        <span className="ebd-note">
          Sends the chart a payload without its <code>series</code> field.
        </span>
      </div>
      <div className="meters">
        <Meter label="Widgets still usable" initial={`${usable} of 3`} tone={usable === 3 ? 'good' : usable === 0 ? 'bad' : undefined} />
      </div>
      {/* The root boundary: in the issue version it's the only one. */}
      <ErrorBoundary onError={onError} onReset={refetch} fallbackRender={({ resetErrorBoundary }) => <AppCrashScreen onReload={resetErrorBoundary} />}>
        <MiniDashboard mode={mode} payload={payload} onError={onError} onRetry={refetch} />
      </ErrorBoundary>
    </>
  );
}

export default function ErrorBoundaryDemo() {
  return (
    <DemoShell
      title="A dashboard where one widget gets bad data"
      hint="Tick a task, then press Break the chart and see what's left. Switch to the fix, do the same, then press Retry."
      issueLabel="One boundary at the root"
      fixLabel="A boundary per widget"
      explain={{
        issue: (
          <>
            The only boundary wraps the whole app, so the chart’s render error replaces everything inside it: the tasks
            and the activity feed too, along with their state.
          </>
        ),
        fix: (
          <>
            The error stops at the nearest boundary, so only the chart shows a fallback, and your ticked tasks survive.
            Retry refetches in <code>onReset</code>, then renders the chart again.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

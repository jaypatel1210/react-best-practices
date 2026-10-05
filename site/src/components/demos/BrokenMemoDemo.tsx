import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DemoShell, Meter, RenderLegend, Tracked, useWorkMeter } from './kit';

const POINTS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const HEIGHTS = [52, 78, 40, 92, 66];

interface ChartProps {
  style: CSSProperties;
  onSelect: (point: string) => void;
  children: ReactNode;
}

const Chart = memo(function Chart({ style, onSelect, children }: ChartProps) {
  return (
    <Tracked name="Chart" kind="memo" tag="memo" cost={18}>
      <div style={{ ...style, display: 'flex', alignItems: 'flex-end', gap: 8 }} aria-label="Weekly signups">
        {POINTS.map((point, i) => (
          <button
            key={point}
            type="button"
            className="demo-btn"
            style={{ flex: 1, height: `${HEIGHTS[i]}%`, minHeight: 0, padding: 0, alignItems: 'flex-end' }}
            onClick={() => onSelect(point)}
          >
            <span style={{ fontSize: '0.72rem', paddingBottom: 4 }}>{point}</span>
          </button>
        ))}
      </div>
      {children}
    </Tracked>
  );
});

function Legend() {
  return <Tracked name="Legend" note="Signups per day, last week." />;
}

/** Compares each prop with the previous render's value, after commit, and writes the verdict. */
function PropIdentity({ props }: { props: Record<string, unknown> }) {
  const previous = useRef<Record<string, unknown> | null>(null);
  const listRef = useRef<HTMLDListElement>(null);

  useLayoutEffect(() => {
    const last = previous.current;
    for (const [key, value] of Object.entries(props)) {
      const cell = listRef.current?.querySelector<HTMLElement>(`[data-prop="${key}"]`);
      if (!cell) continue;
      const same = last !== null && Object.is(last[key], value);
      cell.textContent = last === null ? 'first render' : same ? 'same as last render' : 'new this render';
      cell.dataset.tone = last === null ? 'muted' : same ? 'good' : 'bad';
    }
    previous.current = props;
  });

  return (
    <dl ref={listRef} className="log" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 14px' }}>
      {Object.keys(props).map((key) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt>{key}</dt>
          <dd data-prop={key} style={{ margin: 0 }} />
        </div>
      ))}
    </dl>
  );
}

function Controls({ refresh, selected }: { refresh: () => void; selected: string | null }) {
  return (
    <div className="demo-row">
      <button type="button" className="demo-btn demo-btn-primary" onClick={refresh}>
        Refresh the dashboard
      </button>
      <span className="tracked-note">Selected day: {selected ?? 'none (click a bar)'}</span>
    </div>
  );
}

/** The issue: every render passes Chart a new object, a new function and a new element. */
function DashboardWithInlineProps({ measure }: { measure: () => void }) {
  const [refreshes, setRefreshes] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const style = { height: 120 };
  const onSelect = (point: string) => setSelected(point);
  const legend = <Legend />;

  return (
    <Tracked name="Dashboard" kind="state" tag={`refreshes: ${refreshes}`}>
      <Controls
        refresh={() => {
          measure();
          setRefreshes((n) => n + 1);
        }}
        selected={selected}
      />
      <PropIdentity props={{ style, onSelect, children: legend }} />
      <Chart style={style} onSelect={onSelect}>
        {legend}
      </Chart>
    </Tracked>
  );
}

const CHART_STYLE: CSSProperties = { height: 120 };

/** The fix: a module-level constant, a memoized callback and a memoized element. */
function DashboardWithStableProps({ measure }: { measure: () => void }) {
  const [refreshes, setRefreshes] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const onSelect = useCallback((point: string) => setSelected(point), []);
  const legend = useMemo(() => <Legend />, []);

  return (
    <Tracked name="Dashboard" kind="state" tag={`refreshes: ${refreshes}`}>
      <Controls
        refresh={() => {
          measure();
          setRefreshes((n) => n + 1);
        }}
        selected={selected}
      />
      <PropIdentity props={{ style: CHART_STYLE, onSelect, children: legend }} />
      <Chart style={CHART_STYLE} onSelect={onSelect}>
        {legend}
      </Chart>
    </Tracked>
  );
}

function Stage({ mode }: { mode: 'issue' | 'fix' }) {
  const meter = useWorkMeter();
  return (
    <>
      <div className="meters">
        <Meter label="Main-thread work per refresh" outRef={meter.outRef} />
      </div>
      {mode === 'issue' ? (
        <DashboardWithInlineProps measure={meter.measure} />
      ) : (
        <DashboardWithStableProps measure={meter.measure} />
      )}
    </>
  );
}

export default function BrokenMemoDemo() {
  return (
    <DemoShell
      title="Refresh the dashboard and watch the memo chart"
      hint="Press Refresh a few times, or click a bar. The list above the chart shows whether each prop kept its identity."
      issueLabel="Inline props"
      fixLabel="Stable props"
      legend={<RenderLegend />}
      explain={{
        issue: (
          <>
            <code>memo</code> compares props with <code>Object.is</code>. An inline object, an inline arrow and a JSX
            element are all new on every render, so the comparison always fails and <code>Chart</code> re-renders anyway.
          </>
        ),
        fix: (
          <>
            The style is a module-level constant, the callback is wrapped in <code>useCallback</code> and the legend in{' '}
            <code>useMemo</code>. Every prop is the same object as last time, so React skips <code>Chart</code>.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

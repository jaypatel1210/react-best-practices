import { useEffect, useState, useSyncExternalStore } from 'react';
import { DemoShell, Meter, RenderLegend, Tracked, useClock, type DemoMode } from './kit';
import './EffectLoopDemo.css';

type Status = 'open' | 'closed';
interface Filters {
  status: Status;
  page: number;
  pageSize: number;
}
interface Report {
  id: string;
  title: string;
}
interface LoggedRequest {
  id: number;
  at: string;
  query: string;
  result: string;
  tone: 'good' | 'bad' | 'muted';
}

const PAGE_SIZE = 3;
const PAGES = 3;
const LATENCY_MS = 350;
const SAFETY_STOP = 25;

const TITLES: Record<Status, string[]> = {
  open: ['Churn by plan', 'Refunds over $500', 'Trial conversions', 'Late invoices', 'Seats by region',
    'Failed payments', 'Support backlog', 'Upgrade funnel', 'NPS by cohort'],
  closed: ['Q2 revenue', 'Annual renewals', 'Partner payouts', 'Tax summary', 'Chargebacks',
    'Discount usage', 'Onboarding time', 'Uptime by month', 'Fraud review'],
};

/** A fake reports API with a network log. Only the latency is simulated; the effects are real. */
function createReportsApi(clock: () => string) {
  let state = { requests: [] as LoggedRequest[], sent: 0, repeated: 0, stopped: false };
  let lastQuery = '';
  let streak = 0;
  let nextId = 1;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const settle = (id: number, result: string, tone: LoggedRequest['tone']) =>
    update({ requests: state.requests.map((r) => (r.id === id ? { ...r, result, tone } : r)) });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    fetchReports(filters: Filters, signal: AbortSignal): Promise<Report[]> {
      const query = `?status=${filters.status}&page=${filters.page}`;
      const repeat = query === lastQuery;
      streak = repeat ? streak + 1 : 1;
      lastQuery = query;
      if (state.stopped || streak > SAFETY_STOP) {
        if (!state.stopped) update({ stopped: true });
        return new Promise<Report[]>(() => {}); // blocked by the demo: never settles, so the loop ends
      }
      const id = nextId++;
      update({
        sent: state.sent + 1,
        repeated: state.repeated + (repeat ? 1 : 0),
        requests: [{ id, at: clock(), query, result: 'pending', tone: 'muted' as const }, ...state.requests].slice(0, 30),
      });
      return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
          done = true;
          const start = (filters.page - 1) * filters.pageSize;
          const rows = TITLES[filters.status].slice(start, start + filters.pageSize);
          settle(id, repeat ? '200 · same query again' : `200 · ${rows.length} rows`, repeat ? 'bad' : 'good');
          resolve(rows.map((title) => ({ id: `${filters.status}-${title}`, title }))); // a new array, like parsed JSON
        }, LATENCY_MS);
        signal.addEventListener(
          'abort',
          () => {
            if (done) return;
            clearTimeout(timer);
            settle(id, 'aborted', 'muted');
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    },
  };
}

type ReportsApi = ReturnType<typeof createReportsApi>;

const ignoreAbort = (error: unknown) => {
  if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
};

/** The issue: `filters` is a new object on every render, and the effect depends on it. */
function PanelWithObjectDep({ api }: { api: ReportsApi }) {
  const [status, setStatus] = useState<Status>('open');
  const [page, setPage] = useState(1);
  const [reports, setReports] = useState<Report[]>([]);
  const filters = { status, page, pageSize: PAGE_SIZE };

  useEffect(() => {
    const controller = new AbortController();
    api.fetchReports(filters, controller.signal).then(setReports, ignoreAbort);
    return () => controller.abort();
  }, [api, filters]);

  return <PanelView tag="deps: [filters]" {...{ status, page, reports, setStatus, setPage }} />;
}

/** The fix: build the object inside the effect and depend on the primitives it's made from. */
function PanelWithPrimitiveDeps({ api }: { api: ReportsApi }) {
  const [status, setStatus] = useState<Status>('open');
  const [page, setPage] = useState(1);
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    api.fetchReports({ status, page, pageSize: PAGE_SIZE }, controller.signal).then(setReports, ignoreAbort);
    return () => controller.abort();
  }, [api, status, page]);

  return <PanelView tag="deps: [status, page]" {...{ status, page, reports, setStatus, setPage }} />;
}

interface PanelViewProps {
  tag: string;
  status: Status;
  page: number;
  reports: Report[];
  setStatus: (status: Status) => void;
  setPage: (page: number) => void;
}

function PanelView({ tag, status, page, reports, setStatus, setPage }: PanelViewProps) {
  return (
    <Tracked name="ReportsPanel" kind="state" tag={tag}>
      <div className="demo-row">
        <label className="elp-field">
          Status
          <select
            className="demo-input"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as Status);
              setPage(1);
            }}
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <button type="button" className="demo-btn" disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span className="elp-page">
          Page {page} of {PAGES}
        </span>
        <button type="button" className="demo-btn" disabled={page === PAGES} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
      <ul className="elp-rows" aria-label="Reports">
        {reports.length === 0 ? <li className="elp-empty">Loading…</li> : reports.map((r) => <li key={r.id}>{r.title}</li>)}
      </ul>
    </Tracked>
  );
}

function useApiState(api: ReportsApi) {
  return useSyncExternalStore(api.subscribe, api.getSnapshot, api.getSnapshot);
}

function NetworkMeters({ api }: { api: ReportsApi }) {
  const { sent, repeated } = useApiState(api);
  const tone = repeated > 0 ? 'bad' : 'good';
  return (
    <div className="meters">
      <Meter label="Requests sent" initial={sent} tone={tone} />
      <Meter label="Repeats of the same query" initial={repeated} tone={tone} />
    </div>
  );
}

function NetworkLog({ api }: { api: ReportsApi }) {
  const { requests, stopped } = useApiState(api);
  return (
    <>
      {stopped && (
        <p className="elp-stop" role="status">
          <strong>Safety stop.</strong> The demo blocked the loop after {SAFETY_STOP} identical requests in a row. A real
          app has no such stop: the requests continue for as long as the page stays open. Press Reset to run it again.
        </p>
      )}
      <ol className="log elp-log" aria-label="Network log, newest first" data-empty="No requests yet.">
        {requests.map((r) => (
          <li key={r.id}>
            <time>{r.at}</time>
            <span>GET /api/reports{r.query}</span>
            <span data-tone={r.tone}>{r.result}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function Stage({ mode }: { mode: DemoMode }) {
  const clock = useClock();
  const [api] = useState(() => createReportsApi(clock));
  return (
    <>
      <NetworkMeters api={api} />
      {mode === 'issue' ? <PanelWithObjectDep api={api} /> : <PanelWithPrimitiveDeps api={api} />}
      <NetworkLog api={api} />
    </>
  );
}

export default function EffectLoopDemo() {
  return (
    <DemoShell
      title="A reports panel that fetches in an effect"
      hint="Don't touch anything for a few seconds and watch Requests sent. Then switch to the fix and change the status or the page."
      issueLabel="Object dependency"
      fixLabel="Primitive dependencies"
      legend={<RenderLegend cost={false} />}
      explain={{
        issue: (
          <>
            Nobody changed the filters, yet requests keep coming. Each response calls <code>setReports</code>, the
            re-render creates a new <code>filters</code> object, and the effect sees a changed dependency.
          </>
        ),
        fix: (
          <>
            The effect depends on <code>status</code> and <code>page</code>, which compare by value. It fetches once on
            mount and once per real filter change.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DemoShell, Meter, useClock, type DemoMode } from './kit';
import './RaceConditionDemo.css';

interface SearchResult {
  query: string;
  items: string[];
}
interface LoggedRequest {
  id: number;
  query: string;
  start: string;
  latency: number;
  outcome: 'pending' | 'shown' | 'stale' | 'aborted';
  end?: string;
}

const WORD = 'react';
const PACKAGES = ['react', 'react-dom', 'react-router', 'react-hook-form', 'react-query', 'react-window', 'redux',
  'reselect', 'recharts', 'remix', 'rxjs', 'ramda', 'rollup', 'radix-ui', 'zod', 'vite', 'vitest', 'prettier',
  'express', 'date-fns', 'framer-motion', 'storybook', 'tailwindcss', 'turbo'];

/** Shorter queries are slower here, so a fast typist's early requests finish last. */
const latencyFor = (query: string) => Math.max(250, 1300 - 250 * (query.length - 1));

/** A fake search API with a request log. Only the latency is simulated. */
function createSearchApi(clock: () => string) {
  let log: LoggedRequest[] = [];
  let latestQuery = '';
  let nextId = 1;
  const listeners = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const setLog = (next: LoggedRequest[]) => {
    log = next.slice(-8);
    listeners.forEach((listener) => listener());
  };
  const finish = (id: number, outcome: LoggedRequest['outcome']) =>
    setLog(log.map((r) => (r.id === id ? { ...r, outcome, end: clock() } : r)));

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => log,
    /** Stops pending fake responses when the demo stage unmounts. */
    dispose() {
      timers.forEach(clearTimeout);
      listeners.clear();
    },
    search(query: string, signal?: AbortSignal): Promise<SearchResult> {
      const id = nextId++;
      const latency = latencyFor(query);
      latestQuery = query;
      setLog([...log, { id, query, start: clock(), latency, outcome: 'pending' }]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          signal?.removeEventListener('abort', onAbort);
          finish(id, query === latestQuery ? 'shown' : 'stale');
          resolve({ query, items: PACKAGES.filter((name) => name.includes(query.toLowerCase())).slice(0, 6) });
        }, latency);
        timers.add(timer);
        function onAbort() {
          clearTimeout(timer);
          timers.delete(timer);
          finish(id, 'aborted');
          reject(new DOMException('Aborted', 'AbortError'));
        }
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}

type SearchApi = ReturnType<typeof createSearchApi>;

const ignoreAbort = (error: unknown) => {
  if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
};

/** The issue: every response calls setResult, whichever request it belongs to. */
function SearchWithoutCleanup({ api }: { api: SearchApi }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);

  useEffect(() => {
    if (query === '') return;
    api.search(query).then(setResult);
  }, [api, query]);

  return <SearchView {...{ api, query, setQuery, result }} />;
}

/** The fix: the cleanup aborts the previous request before the next one starts. */
function SearchWithAbort({ api }: { api: SearchApi }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);

  useEffect(() => {
    if (query === '') return;
    const controller = new AbortController();
    api.search(query, controller.signal).then(setResult, ignoreAbort);
    return () => controller.abort();
  }, [api, query]);

  return <SearchView {...{ api, query, setQuery, result }} />;
}

interface SearchViewProps {
  api: SearchApi;
  query: string;
  setQuery: (query: string) => void;
  result: SearchResult | null;
}

function SearchView({ api, query, setQuery, result }: SearchViewProps) {
  const log = useSyncExternalStore(api.subscribe, api.getSnapshot, api.getSnapshot);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const typeForMe = () => {
    timers.current.forEach(clearTimeout);
    setQuery('');
    timers.current = [...WORD].map((_, i) => setTimeout(() => setQuery(WORD.slice(0, i + 1)), (i + 1) * 140));
  };

  const busy = log.some((r) => r.outcome === 'pending');
  const shownFor = query === '' ? null : (result?.query ?? null);
  const tone = shownFor === null || shownFor === query ? 'good' : busy ? undefined : 'bad';

  return (
    <>
      <div className="demo-row">
        <input
          className="demo-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search packages, e.g. ${WORD}`}
          aria-label="Search packages"
        />
        <button type="button" className="demo-btn" onClick={typeForMe}>
          Type “{WORD}” quickly
        </button>
      </div>
      <div className="meters">
        <Meter label="Search box says" initial={query ? `“${query}”` : '—'} />
        <Meter label="Results on screen are for" initial={shownFor ? `“${shownFor}”` : '—'} tone={tone} />
      </div>
      <ul className="rcd-results" aria-label="Search results" aria-busy={busy}>
        {shownFor === null || !result ? (
          <li className="rcd-empty">{query ? 'Searching…' : 'Type to search.'}</li>
        ) : (
          result.items.map((name) => <li key={name}>{name}</li>)
        )}
      </ul>
      <ol className="log rcd-log" aria-label="Request log" data-empty="No requests yet.">
        {log.map((r) => (
          <li key={r.id}>
            <time>{r.start}</time>
            <span>“{r.query}” takes {(r.latency / 1000).toFixed(2)}s</span>
            <span data-tone={r.outcome === 'shown' ? 'good' : r.outcome === 'stale' ? 'bad' : 'muted'}>
              {r.outcome === 'pending' && 'pending'}
              {r.outcome === 'shown' && `landed ${r.end}, latest query`}
              {r.outcome === 'stale' && `landed ${r.end}, overwrote newer results`}
              {r.outcome === 'aborted' && `aborted ${r.end}`}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

function Stage({ mode }: { mode: DemoMode }) {
  const clock = useClock();
  const [api] = useState(() => createSearchApi(clock));
  useEffect(() => () => api.dispose(), [api]);
  return mode === 'issue' ? <SearchWithoutCleanup api={api} /> : <SearchWithAbort api={api} />;
}

export default function RaceConditionDemo() {
  return (
    <DemoShell
      title="Search as you type, with responses that arrive out of order"
      hint="Press the Type button (or type fast yourself) and wait two seconds. Compare the search box with the query the results belong to."
      issueLabel="No cleanup"
      fixLabel="Abort in cleanup"
      explain={{
        issue: (
          <>
            Short queries are slower here, so the request for “r” finishes last and its <code>setResult</code> overwrites
            the results for “react”. The last response to arrive wins, not the last one requested.
          </>
        ),
        fix: (
          <>
            Each keystroke re-runs the effect, and the previous run’s cleanup aborts its request first. Only the latest
            request can call <code>setResult</code>.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

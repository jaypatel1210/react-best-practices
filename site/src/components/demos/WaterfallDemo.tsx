import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DemoShell, Meter, type DemoMode } from './kit';
import './WaterfallDemo.css';

interface Data {
  user: { name: string; role: string };
  projects: string[];
  activity: string[];
}
type Key = keyof Data;
interface Lane {
  key: Key;
  start: number;
  end: number;
  done: boolean;
}

const DURATION_MS: Record<Key, number> = { user: 800, projects: 1200, activity: 1000 };
const KEYS: Key[] = ['user', 'projects', 'activity'];
const SCALE_MS = 3200;
const DATA: Data = {
  user: { name: 'Ada Okafor', role: 'Team lead, Payments' },
  projects: ['Checkout v3', 'Refund automation', 'Fraud rules'],
  activity: ['Ada merged “retry webhooks”', 'Sam opened “refund limits”', 'Lee deployed checkout 3.4'],
};

/** A fake API that records when each request starts and ends. Only the latency is simulated. */
function createDashboardApi() {
  let lanes: Lane[] = [];
  let t0: number | null = null;
  const listeners = new Set<() => void>();
  const setLanes = (next: Lane[]) => {
    lanes = next;
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => lanes,
    load<K extends Key>(key: K, signal: AbortSignal): Promise<Data[K]> {
      t0 ??= performance.now();
      const start = performance.now() - t0;
      setLanes([...lanes.filter((l) => l.key !== key), { key, start, end: start + DURATION_MS[key], done: false }]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const end = performance.now() - (t0 ?? 0);
          setLanes(lanes.map((l) => (l.key === key ? { ...l, end, done: true } : l)));
          resolve(DATA[key]);
        }, DURATION_MS[key]);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    },
  };
}

type DashboardApi = ReturnType<typeof createDashboardApi>;

const ignoreAbort = (error: unknown) => {
  if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
};

/** A small effect-based fetching hook, with cleanup. The component it runs in decides when it starts. */
function useResource<K extends Key>(api: DashboardApi, key: K): Data[K] | undefined {
  const [data, setData] = useState<Data[K]>();
  useEffect(() => {
    const controller = new AbortController();
    api.load(key, controller.signal).then((value) => setData(value), ignoreAbort);
    return () => controller.abort();
  }, [api, key]);
  return data;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="wfd-card">
      <p className="wfd-card-title">{title}</p>
      {children}
    </section>
  );
}

function Loading({ what }: { what: string }) {
  return (
    <p className="wfd-loading" role="status">
      <span className="wfd-spinner" aria-hidden="true" /> Loading {what}…
    </p>
  );
}

const UserCard = ({ user }: { user: Data['user'] }) => <Card title="User">{user.name} · {user.role}</Card>;
const ListCard = ({ title, items }: { title: string; items: string[] }) => (
  <Card title={title}>
    <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
  </Card>
);

/* The issue: each section fetches its own data, and mounts the next section only once that data arrives. */
function UserSection({ api }: { api: DashboardApi }) {
  const user = useResource(api, 'user');
  if (!user) return <Loading what="user" />;
  return (
    <>
      <UserCard user={user} />
      <ProjectsSection api={api} />
    </>
  );
}

function ProjectsSection({ api }: { api: DashboardApi }) {
  const projects = useResource(api, 'projects');
  if (!projects) return <Loading what="projects" />;
  return (
    <>
      <ListCard title="Projects" items={projects} />
      <ActivitySection api={api} />
    </>
  );
}

function ActivitySection({ api }: { api: DashboardApi }) {
  const activity = useResource(api, 'activity');
  if (!activity) return <Loading what="activity" />;
  return <ListCard title="Activity" items={activity} />;
}

/* The fix: one component starts all three requests in the same commit; each part shows when its data lands. */
function Dashboard({ api }: { api: DashboardApi }) {
  const user = useResource(api, 'user');
  const projects = useResource(api, 'projects');
  const activity = useResource(api, 'activity');
  return (
    <>
      {user ? <UserCard user={user} /> : <Loading what="user" />}
      {projects ? <ListCard title="Projects" items={projects} /> : <Loading what="projects" />}
      {activity ? <ListCard title="Activity" items={activity} /> : <Loading what="activity" />}
    </>
  );
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

function Timeline({ api }: { api: DashboardApi }) {
  const lanes = useSyncExternalStore(api.subscribe, api.getSnapshot, api.getSnapshot);
  const allDone = lanes.length === KEYS.length && lanes.every((l) => l.done);
  const total = Math.max(0, ...lanes.map((l) => l.end));
  return (
    <>
      <div className="meters">
        <Meter
          label="Until everything is on screen"
          initial={allDone ? seconds(total) : 'loading…'}
          tone={allDone ? (total > 1.5 * DURATION_MS.projects ? 'bad' : 'good') : undefined}
        />
        <Meter label="Slowest single request" initial={seconds(DURATION_MS.projects)} />
      </div>
      <div className="lanes" role="img" aria-label={lanes.map((l) => `${l.key} from ${seconds(l.start)} to ${seconds(l.end)}`).join(', ') || 'No requests yet'}>
        {KEYS.map((key) => {
          const lane = lanes.find((l) => l.key === key);
          return (
            <div className="lane" key={key}>
              <span className="lane-label">GET /api/{key}</span>
              <span className="lane-track">
                {lane ? (
                  <span
                    className="lane-bar"
                    data-tone={lane.done ? (allDone && total > 1.5 * DURATION_MS.projects ? 'bad' : 'good') : 'muted'}
                    style={{ left: `${(lane.start / SCALE_MS) * 100}%`, width: `${((lane.end - lane.start) / SCALE_MS) * 100}%` }}
                  />
                ) : (
                  <span className="wfd-waiting">not started</span>
                )}
              </span>
            </div>
          );
        })}
        <div className="lane" aria-hidden="true">
          <span />
          <span className="wfd-axis">
            {[0, 1, 2, 3].map((s) => (
              <span key={s} style={{ left: `${((s * 1000) / SCALE_MS) * 100}%` }}>
                {s} s
              </span>
            ))}
          </span>
        </div>
      </div>
    </>
  );
}

function Stage({ mode }: { mode: DemoMode }) {
  const [api] = useState(createDashboardApi);
  return (
    <>
      <Timeline api={api} />
      <div className="wfd-page">{mode === 'issue' ? <UserSection api={api} /> : <Dashboard api={api} />}</div>
    </>
  );
}

export default function WaterfallDemo() {
  return (
    <DemoShell
      title="A dashboard that loads user, projects and activity"
      hint="Watch the timeline as the dashboard loads, then press Reset to load it again. Switch to the fix and compare the lanes."
      issueLabel="Each section fetches"
      fixLabel="Start all at the top"
      explain={{
        issue: (
          <>
            Each section fetches in its own effect, and renders the next section only when its data arrives. A child’s
            effect can’t run before the child mounts, so the requests run one after another: 0.8 + 1.2 + 1.0 seconds.
          </>
        ),
        fix: (
          <>
            One component calls all three hooks, so all three effects start in the same commit. The page is complete when
            the slowest request finishes, and each section still appears as soon as its own data lands.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

import type { SkillId } from '../content.config';

/** The tested, dependency-free code shipped in skills/<skill>/assets. */
export interface Utility {
  slug: string;
  /** Display name for the H1. */
  name: string;
  /** SEO title (no site suffix). */
  title: string;
  description: string;
  skill: SkillId;
  file: string;
  test: string;
  exports: string[];
  summary: string;
  useWhen: string[];
  guarantees: string[];
  usage: { title: string; code: string }[];
  related: string[];
}

export const UTILITIES: Utility[] = [
  {
    slug: 'use-latest-callback',
    name: 'useLatestCallback',
    title: 'useLatestCallback: a stable React callback that reads fresh state',
    description:
      'A React hook that returns a function with a stable identity which always calls your latest callback. Fixes stale closures in subscriptions, timers and memo props.',
    skill: 'react-refs-closures',
    file: 'skills/react-refs-closures/assets/use-latest-callback.ts',
    test: 'tests/use-latest-callback.test.tsx',
    exports: ['useLatestCallback'],
    summary:
      'Returns a function whose identity never changes but which always runs the callback from the latest render. Long-lived subscribers keep one reference and still see current props and state.',
    useWhen: [
      'A socket, DOM listener or timer is set up once but must call code that reads current props or state.',
      'A memoized child needs a stable callback prop, and wrapping it in useCallback would change it on every keystroke.',
      'You are wrapping a callback for a debounce or throttle and want the wrapper to call the newest version.',
    ],
    guarantees: [
      'Same function identity for the life of the component, so it is safe in dependency arrays.',
      'Updated in an insertion effect, before any layout effect or effect in the same commit runs.',
      'Not meant to be called during render, where it may still run the previous callback.',
      'On React 19.2+, useEffectEvent is the built-in choice for logic called only from inside effects.',
    ],
    usage: [
      {
        title: 'ChatRoom.tsx',
        code: `function ChatRoom({ roomId, onMessage }: { roomId: string; onMessage: (m: Message) => void }) {
  const handleMessage = useLatestCallback(onMessage);

  useEffect(() => {
    const socket = connect(roomId);
    socket.on('message', handleMessage);
    return () => socket.close();
  }, [roomId, handleMessage]); // handleMessage never changes: only a new room reconnects

  return <MessageList roomId={roomId} />;
}`,
      },
    ],
    related: ['handler-sees-old-state', 'interval-counter-stuck-at-one'],
  },
  {
    slug: 'use-debounced-callback',
    name: 'useDebouncedCallback',
    title: 'useDebouncedCallback: a React debounce hook that survives re-renders',
    description:
      'A tested React debounce hook with a stable identity, cancel, flush and isPending. One timer per component, always calling the latest callback.',
    skill: 'react-refs-closures',
    file: 'skills/react-refs-closures/assets/use-debounced-callback.ts',
    test: 'tests/use-debounced-callback.test.tsx',
    exports: ['useDebouncedCallback', 'DebouncedFunction', 'DebounceOptions'],
    summary:
      'Waits until a delay passes without calls, then runs the latest callback with the arguments of the last call. The debounced function is created once per component instance, so re-renders never reset the timer.',
    useWhen: [
      'Search-as-you-type, where a request should go out once the user pauses.',
      'Validation or saving that should wait until typing stops.',
      'Any debounce that currently lives in the render body or is re-created when state changes.',
    ],
    guarantees: [
      'Stable identity: safe as a dependency and as a memo prop.',
      'The callback can read the latest props and state without being memoized.',
      'cancel() drops a pending call, flush() runs it now, isPending() reports whether one is waiting.',
      'Pending calls are cancelled on unmount, or flushed with { flushOnUnmount: true }.',
    ],
    usage: [
      {
        title: 'SearchBox.tsx',
        code: `function SearchBox({ onSearch }: { onSearch: (query: string) => void }) {
  const [query, setQuery] = useState('');
  const search = useDebouncedCallback(onSearch, 300);

  return (
    <input
      value={query}
      onChange={(e) => {
        setQuery(e.target.value); // the field updates immediately
        search(e.target.value); // the request waits for a pause
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') search.flush();
      }}
    />
  );
}`,
      },
    ],
    related: ['debounce-fires-every-keystroke', 'search-shows-stale-results'],
  },
  {
    slug: 'use-throttled-callback',
    name: 'useThrottledCallback',
    title: 'useThrottledCallback: a leading and trailing React throttle hook',
    description:
      'A tested React throttle hook: runs immediately, then at most once per interval, and never drops the last call. Stable identity, cancel, flush and flush on unmount.',
    skill: 'react-refs-closures',
    file: 'skills/react-refs-closures/assets/use-throttled-callback.ts',
    test: 'tests/use-throttled-callback.test.tsx',
    exports: ['useThrottledCallback', 'ThrottledFunction', 'ThrottleOptions'],
    summary:
      'Invokes the latest callback at most once per interval. The first call runs right away, and calls made during the interval collapse into one trailing call with the newest arguments, so the final value is never lost.',
    useWhen: [
      'Autosave while the user types, without losing the last edit.',
      'Reporting progress, scroll position or analytics at a steady rate.',
      'Rate-limiting work triggered by frequent events where a fixed interval suits better than once per frame.',
    ],
    guarantees: [
      'Leading and trailing edges: the first and the last call both run.',
      'Stable identity and fresh callbacks, like the debounce hook.',
      'cancel() drops the trailing call and resets the interval; flush() runs it now.',
      'A pending trailing call is cancelled on unmount, or flushed with { flushOnUnmount: true }.',
    ],
    usage: [
      {
        title: 'NoteEditor.tsx',
        code: `function NoteEditor({ note, save }: { note: Note; save: (text: string) => void }) {
  const [draft, setDraft] = useState(note.text);
  const autosave = useThrottledCallback(save, 2000, { flushOnUnmount: true });

  return (
    <textarea
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        autosave(e.target.value);
      }}
      onBlur={() => autosave.flush()}
    />
  );
}`,
      },
    ],
    related: ['debounce-fires-every-keystroke', 'drag-stutters-on-pointermove'],
  },
  {
    slug: 'error-boundary',
    name: 'ErrorBoundary and useThrowToBoundary',
    title: 'ErrorBoundary for React: fallbacks, reset keys and async errors',
    description:
      'A dependency-free React error boundary with fallbacks, onError, onReset and resetKeys, plus useThrowToBoundary to send async and event-handler errors to it.',
    skill: 'react-error-handling',
    file: 'skills/react-error-handling/assets/error-boundary.tsx',
    test: 'tests/error-boundary.test.tsx',
    exports: ['ErrorBoundary', 'useThrowToBoundary', 'ErrorBoundaryProps', 'FallbackRenderProps'],
    summary:
      'Catches errors thrown while rendering, in lifecycle methods and in effects below it, and shows a fallback instead of unmounting the app. useThrowToBoundary forwards errors from promises, timers and event handlers, which boundaries can’t see on their own.',
    useWhen: [
      'At the root and route level, so one render error never blanks the whole app.',
      'Around independent regions (charts, feeds, embeds, editors) so one crash stays local.',
      'When a failed request or click handler should show the same fallback as a render error.',
    ],
    guarantees: [
      'fallbackRender receives the error and resetErrorBoundary; it takes precedence over fallback.',
      'onError receives the component stack, for reporting to your logger.',
      'resetKeys reset the boundary when a key changes after the error, such as a route or an entity id.',
      'If the project already uses the react-error-boundary package, prefer that library.',
    ],
    usage: [
      {
        title: 'ReportPage.tsx',
        code: `<ErrorBoundary
  resetKeys={[reportId]}
  onError={(error, info) => reportError(error, info.componentStack)}
  fallbackRender={({ resetErrorBoundary }) => (
    <div role="alert">
      <p>The revenue chart failed to load.</p>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  )}
>
  <RevenueChart reportId={reportId} />
</ErrorBoundary>`,
      },
      {
        title: 'ExportButton.tsx',
        code: `function ExportButton({ reportId }: { reportId: string }) {
  const throwToBoundary = useThrowToBoundary();
  return <button onClick={() => exportReport(reportId).catch(throwToBoundary)}>Export</button>;
}`,
      },
    ],
    related: ['one-error-blanks-the-app', 'async-errors-vanish', 'retry-button-does-nothing'],
  },
  {
    slug: 'use-frame-throttled-callback',
    name: 'useFrameThrottledCallback',
    title: 'useFrameThrottledCallback: run a React handler once per animation frame',
    description:
      'A tested React hook that runs pointermove, scroll and resize handlers at most once per animation frame, with the latest arguments. Stable identity, cancel and flush.',
    skill: 'react-responsiveness',
    file: 'skills/react-responsiveness/assets/use-frame-throttled-callback.ts',
    test: 'tests/use-frame-throttled-callback.test.tsx',
    exports: ['useFrameThrottledCallback', 'FrameThrottledFunction'],
    summary:
      'Coalesces calls into at most one per animation frame. The latest callback runs right before the next paint with the most recent arguments, so continuous events do their work once per frame instead of once per event.',
    useWhen: [
      'Dragging, resizing or scrubbing, where pointermove fires faster than the screen refreshes.',
      'Scroll or resize handlers that update visuals, set state or read layout.',
      'Several event sources that should trigger a single redraw per frame.',
    ],
    guarantees: [
      'Stable identity and fresh callbacks; you don’t need to memoize the callback.',
      'Pass plain values (coordinates, sizes), not the event object.',
      'flush() runs the scheduled call now, for example on pointerup; a scheduled call is cancelled on unmount.',
      'Animation frames don’t run in background tabs, so don’t use it for non-visual work.',
    ],
    usage: [
      {
        title: 'Playhead.tsx',
        code: `function Playhead({ duration, onSeek }: { duration: number; onSeek: (seconds: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const seek = useFrameThrottledCallback((clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    onSeek(((clientX - rect.left) / rect.width) * duration);
  });

  return <div ref={trackRef} className="track" onPointerMove={(e) => seek(e.clientX)} onPointerUp={() => seek.flush()} />;
}`,
      },
    ],
    related: ['drag-stutters-on-pointermove', 'column-resize-css-in-js-slow'],
  },
  {
    slug: 'yield-to-main',
    name: 'yieldToMain and runInChunks',
    title: 'yieldToMain and runInChunks: break up long tasks in the browser',
    description:
      'Two tested helpers for heavy client work: yieldToMain uses scheduler.yield with a fallback, and runInChunks splits long loops into short tasks.',
    skill: 'react-responsiveness',
    file: 'skills/react-responsiveness/assets/yield-to-main.ts',
    test: 'tests/yield-to-main.test.tsx',
    exports: ['yieldToMain', 'runInChunks', 'ChunkOptions'],
    summary:
      'yieldToMain pauses an async task so the browser can handle input and paint, then resumes. runInChunks runs a loop in time-boxed chunks, yielding between them, so one long task becomes many short ones, with AbortSignal support.',
    useWhen: [
      'Parsing, sorting or transforming thousands of records on the client after a click.',
      'Any loop that takes longer than about 50 ms and blocks input (a long task).',
      'Work that should stop when the user navigates away or starts another import.',
    ],
    guarantees: [
      'Uses scheduler.yield() where available, and a MessageChannel task elsewhere, avoiding the setTimeout clamp.',
      'runInChunks yields when the budget (default 10 ms) runs out, and runs at least one item per chunk.',
      'An aborted signal stops the loop between items and rejects the returned promise.',
      'Each item should stay short; jobs that take seconds of CPU belong in a Web Worker.',
    ],
    usage: [
      {
        title: 'importRows.ts',
        code: `async function importRows(lines: string[], signal: AbortSignal): Promise<Row[]> {
  const rows: Row[] = [];
  await runInChunks(lines, (line) => rows.push(parseRow(line)), { budgetMs: 10, signal });
  return rows;
}`,
      },
      {
        title: 'between steps',
        code: `for (const batch of batches) {
  applyBatch(batch);
  await yieldToMain(); // let the browser handle input and paint before the next batch
}`,
      },
    ],
    related: ['file-import-freezes-page', 'typing-lags-heavy-list'],
  },
  {
    slug: 'use-in-view',
    name: 'useInView',
    title: 'useInView: an IntersectionObserver hook for React with a callback ref',
    description:
      'A tested React IntersectionObserver hook with a callback ref, root margins, thresholds and a once latch. Re-renders only when visibility flips, never on scroll.',
    skill: 'react-large-lists',
    file: 'skills/react-large-lists/assets/use-in-view.ts',
    test: 'tests/use-in-view.test.tsx',
    exports: ['useInView', 'InViewOptions'],
    summary:
      'Tracks whether an element is within, or near, the viewport or a scroll container. It returns a callback ref, so it follows elements that mount later or get replaced, and it updates state only when visibility flips.',
    useWhen: [
      'Mounting heavy sections (charts, embeds, comments) just before they scroll into view.',
      'Infinite scroll, with a sentinel element near the end of the list.',
      'One-time impressions or animations that should start when content appears.',
    ],
    guarantees: [
      'Re-renders on crossings, not on every scroll event.',
      'rootMargin starts work early; threshold sets how much must be visible; once latches the first hit.',
      'The observer disconnects on unmount, when the element detaches, and after a once hit.',
      'initialInView sets the value for server rendering and browsers without IntersectionObserver.',
    ],
    usage: [
      {
        title: 'LazyChart.tsx',
        code: `function LazyChart({ data }: { data: Point[] }) {
  const [ref, inView] = useInView<HTMLDivElement>({ rootMargin: '300px 0px', once: true });
  return (
    <div ref={ref} style={{ minHeight: 320 }}>
      {inView ? <Chart data={data} /> : null}
    </div>
  );
}`,
      },
    ],
    related: ['infinite-scroll-duplicate-requests', 'long-page-slow-first-render'],
  },
];

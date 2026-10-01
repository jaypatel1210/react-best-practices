# Example: A 60,000-Row CSV Import Without Freezing the Page

Users import a bank export (about 60,000 rows) into a budgeting app. The app parses it, validates each row, and shows totals per category.

## Before: everything in the click handler

```tsx
function ImportButton({ onImported }: { onImported: (summary: ImportSummary) => void }) {
  const [status, setStatus] = useState<'idle' | 'working'>('idle');

  const handleFile = async (file: File) => {
    setStatus('working');
    const text = await file.text();
    const rows = parseCsv(text);        // ~600 ms
    const valid = rows.filter(isValid); // ~300 ms
    onImported(summarize(valid));       // ~200 ms
    setStatus('idle');
  };

  return (
    <>
      <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
      {status === 'working' && <p>Importing…</p>}
    </>
  );
}
```

After `await file.text()`, the parse, filter and summary run as one task of about 1.1 seconds. Clicks, scrolling and typing wait for it. A JavaScript-driven spinner freezes. Even the "Importing…" message only paints if the browser got a frame in before the task started.

## Step 1: chunk the work and yield

```tsx
import { runInChunks } from './yield-to-main'; // react-responsiveness/assets

function useCsvImport() {
  const [progress, setProgress] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []); // stop on unmount

  const importFile = async (file: File): Promise<ImportSummary | null> => {
    controllerRef.current?.abort(); // a newer import replaces an older one
    const controller = new AbortController();
    controllerRef.current = controller;

    setProgress(0);
    const lines = (await file.text()).split('\n');
    const summary = createSummary();
    let lastPercent = 0;

    try {
      await runInChunks(
        lines,
        (line, i) => {
          const row = parseLine(line);
          if (row && isValid(row)) addToSummary(summary, row);
          const percent = Math.floor((i / lines.length) * 100);
          if (percent !== lastPercent) {
            lastPercent = percent;
            setProgress(percent); // at most 100 updates, not 60,000
          }
        },
        { signal: controller.signal },
      );
      return summary;
    } catch (err) {
      if (controller.signal.aborted) return null; // replaced or unmounted: not an error
      throw err;
    } finally {
      if (controllerRef.current === controller) setProgress(null);
    }
  };

  return { importFile, progress };
}
```

- The loop now runs in slices of about 10 ms. Between slices, the browser handles input and paints the progress bar.
- **Progress updates are coarse.** Setting state per row would turn the chunked loop into 60,000 renders. Update when the visible value changes.
- **Accumulate as you go** (`addToSummary`) instead of building intermediate arrays, so memory stays flat.
- **Abort** cancels the loop at the next item when the user starts another import or leaves the page.
- Total time grows slightly because of the yields. In exchange, the page never blocks for more than a slice.

Chunking fits work that is moderate (hundreds of milliseconds) and easy to slice. For seconds of CPU work, or work that can't be sliced, use a worker.

## Step 2: move it into a worker

```ts
// import.worker.ts
import { parseLine, isValid, createSummary, addToSummary } from './csv';

self.onmessage = (event: MessageEvent<{ id: number; buffer: ArrayBuffer }>) => {
  const { id, buffer } = event.data;
  const text = new TextDecoder().decode(buffer);
  const summary = createSummary();
  for (const line of text.split('\n')) {
    const row = parseLine(line);
    if (row && isValid(row)) addToSummary(summary, row);
  }
  self.postMessage({ id, summary }); // only the totals travel back, not 60,000 rows
};
```

```tsx
const cancelled = () => new DOMException('Import cancelled', 'AbortError');

function useImportWorker() {
  const workerRef = useRef<Worker | null>(null);
  const rejectPending = useRef<((error: Error) => void) | null>(null);
  const latestId = useRef(0);

  // A busy worker can't process a "cancel" message: terminating it is the only hard stop.
  const cancel = useCallback((reason: Error = cancelled()) => {
    rejectPending.current?.(reason);
    workerRef.current?.terminate();
    workerRef.current = null; // the next import creates a fresh worker
  }, []);

  useEffect(() => () => cancel(), [cancel]); // unmount (and StrictMode's re-run) end the job

  const run = useCallback(
    async (file: File): Promise<ImportSummary> => {
      cancel(); // one import at a time: a new file replaces the one in progress
      const id = ++latestId.current;
      const buffer = await file.arrayBuffer();
      if (id !== latestId.current) throw cancelled(); // another file was picked meanwhile

      const worker = (workerRef.current ??= new Worker(new URL('./import.worker.ts', import.meta.url), {
        type: 'module',
      }));

      return new Promise<ImportSummary>((resolve, reject) => {
        const listeners = new AbortController();
        const watchdog = setTimeout(() => cancel(new Error('Import took too long')), 30_000);
        const settle = () => {
          clearTimeout(watchdog);
          listeners.abort();
          rejectPending.current = null;
        };
        rejectPending.current = (error) => {
          settle();
          reject(error);
        };

        worker.addEventListener(
          'message',
          (event: MessageEvent<{ id: number; summary: ImportSummary }>) => {
            if (event.data.id !== id) return; // a late reply from an older job
            settle();
            resolve(event.data.summary);
          },
          { signal: listeners.signal },
        );
        worker.addEventListener('error', (event) => rejectPending.current?.(new Error(event.message)), {
          signal: listeners.signal,
        });

        worker.postMessage({ id, buffer }, [buffer]); // transfer: the buffer moves, nothing is copied
      });
    },
    [cancel],
  );

  return { run, cancel };
}
```

The caller treats an `AbortError` as "replaced or cancelled", not as a failure to show.

What each part handles:

- **One worker per hook owner,** created on first use and terminated on unmount. Creating a worker per import would pay its startup cost every time.
- **`new Worker(new URL(...), { type: 'module' })`** is the form Vite, webpack 5 and Next.js recognize and bundle.
- **Transferring the `ArrayBuffer`** moves it to the worker instead of copying it, and the worker sends back a small summary. Structured cloning 60,000 row objects in either direction would cost as much as parsing them.
- **Replacing an import** terminates the old job and rejects its promise, and the ID checks discard anything that slips through. It's the same race as with `fetch` (`react-data-fetching`). For workers that serve many small requests concurrently (search-as-you-type over an index held in the worker), keep the worker alive and rely on request IDs alone.
- **Errors** thrown inside the worker arrive as `error` events on the `Worker` object.
- **The watchdog and `cancel()`** end runaway jobs. A `postMessage({ type: 'cancel' })` would sit in the queue until the current job finished.

## Choosing between them

| Work | Approach |
|---|---|
| Under ~50 ms total | Leave it on the main thread |
| Hundreds of milliseconds, easy to slice, touches React state as it goes | `runInChunks` with coarse progress |
| Seconds of CPU work, or a library you can't slice (parsers, compression, image processing) | A worker, with transferred buffers and small results |
| Needs the DOM | Main thread only; reduce the work instead (`react-large-lists`, `react-animation`) |

# Example: Frame-Aligned Updates and Idle-Time Work

## Scenario 1: a draggable playhead on an editing timeline

An audio editor shows a waveform, dozens of clips and a playhead the user drags to scrub.

### Before

```tsx
function Timeline({ clips, duration }: TimelineProps) {
  const [playheadSec, setPlayheadSec] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const secondsAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  };

  return (
    <div ref={trackRef} className="timeline" onPointerMove={(e) => e.buttons === 1 && setPlayheadSec(secondsAt(e.clientX))}>
      <Waveform />
      {clips.map((clip) => <Clip key={clip.id} clip={clip} />)}
      <div className="playhead" style={{ left: `${(playheadSec / duration) * 100}%` }} />
    </div>
  );
}
```

Each pointer move sets state in `Timeline`, which re-renders the waveform and every clip, and moves the playhead with `left`, which triggers layout. Dragging stutters, and the playhead lags behind the pointer.

### After

```tsx
function Timeline({ clips, duration, positionSec, onSeek }: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const dragSec = useRef(positionSec);

  const movePlayhead = useFrameThrottledCallback((clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect(); // one read per frame
    dragSec.current = clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
    layerRef.current!.style.transform = `translateX(${(dragSec.current / duration) * 100}%)`; // one write
  });

  return (
    <div ref={trackRef} className="timeline">
      <Waveform />
      {clips.map((clip) => <Clip key={clip.id} clip={clip} />)}
      {/* A full-width layer, so translateX(%) is a fraction of the track */}
      <div ref={layerRef} className="playhead-layer" style={{ transform: `translateX(${(positionSec / duration) * 100}%)` }}>
        <div
          className="playhead"
          role="slider"
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={positionSec}
          tabIndex={0}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && movePlayhead(e.clientX)}
          onPointerUp={() => {
            movePlayhead.flush(); // apply the last position before committing
            onSeek(dragSec.current); // one state update, owned by the player
          }}
        />
      </div>
    </div>
  );
}
```

```css
.playhead-layer { position: absolute; inset: 0; pointer-events: none; }
.playhead { pointer-events: auto; width: 2px; height: 100%; }
```

- **No React render during the drag.** The playhead layer moves through `transform`; the waveform and clips aren't touched.
- **React still owns the committed position.** `positionSec` comes from the player, and the render writes the same `transform` the drag writes, so the two never disagree after `onSeek`.
- **One read and one write per frame**, in that order, so there's no forced layout between them.
- **Pointer capture** keeps the drag going when the pointer leaves the thin playhead.
- **The committed value goes through React** on release (`onSeek`), so playback, the time readout and undo history stay in state. Keyboard users get the same result through arrow-key handlers that call `onSeek` directly.
- `useFrameThrottledCallback` is in `assets/use-frame-throttled-callback.ts`. It passes `clientX`, not the event, because React clears `currentTarget` after the handler returns.

## Scenario 2: one redraw per frame from several sources

A canvas minimap redraws when the main editor scrolls, when the user zooms with the wheel, and when the window resizes. In one frame, all three can fire, and each redraw costs 6 ms.

```tsx
function Minimap({ editorRef }: { editorRef: React.RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const redraw = useFrameThrottledCallback(() => {
    drawMinimap(canvasRef.current!, editorRef.current!); // reads scroll position and size once
  });

  useEffect(() => {
    const editor = editorRef.current!;
    const listeners = new AbortController();
    editor.addEventListener('scroll', redraw, { passive: true, signal: listeners.signal });
    editor.addEventListener('wheel', redraw, { passive: true, signal: listeners.signal });
    window.addEventListener('resize', redraw, { signal: listeners.signal });
    return () => listeners.abort();
  }, [editorRef, redraw]);

  return <canvas ref={canvasRef} className="minimap" />;
}
```

Three event sources, at most one redraw per frame, run just before paint. `redraw` is stable, so the effect subscribes once, and the pending frame is cancelled on unmount.

## Scenario 3: analytics in idle time

Analytics calls on every interaction compete with the interaction itself. Queue them, and send them when the browser is idle:

```ts
// analytics-queue.ts
type AnalyticsEvent = { name: string; at: number; props?: Record<string, unknown> };

const queue: AnalyticsEvent[] = [];
let scheduled = false;

const onIdle: (cb: () => void) => void =
  typeof requestIdleCallback === 'function'
    ? (cb) => requestIdleCallback(cb, { timeout: 3000 }) // run eventually, even on a busy page
    : (cb) => setTimeout(cb, 200); // Safari

function flush() {
  scheduled = false;
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  navigator.sendBeacon('/analytics', JSON.stringify(batch));
}

export function track(name: string, props?: Record<string, unknown>) {
  queue.push({ name, at: Date.now(), props });
  if (!scheduled) {
    scheduled = true;
    onIdle(flush);
  }
}

// Don't lose the queue when the user leaves or switches tabs
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
```

- **Handlers stay short:** `track()` only pushes into an array.
- **The timeout** guarantees delivery on pages that are never idle; the `setTimeout` fallback covers Safari.
- **`sendBeacon` on `visibilitychange` → hidden** delivers what's queued when the page goes away, which is more reliable than `unload` or `beforeunload` (especially on mobile).
- This module has no React state at all, so tracking never re-renders anything.

Don't use idle callbacks for anything visible or awaited by the user. They're for work whose timing nobody notices.

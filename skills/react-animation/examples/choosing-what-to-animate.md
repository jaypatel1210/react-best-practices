# Example: Choosing What to Animate and What Drives It

## Scenario 1: an expanding details panel

The panel slides open from `height: 0` to its content height.

### Before: JavaScript drives `height`

```tsx
function DetailsPanel({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    setHeight(open ? ref.current!.scrollHeight : 0);
  }, [open, children]);
  return (
    <div style={{ height, overflow: 'hidden', transition: 'height 250ms' }}>
      <div ref={ref}>{children}</div>
    </div>
  );
}
```

It works, but every frame of the transition re-lays out the panel and everything below it, and `scrollHeight` forces a layout on every change of `children`. With a long page below the panel, or several panels opening at once, frames drop.

### Options, from cheapest to most faithful

1. **Animate the content, not the box.** Let the box open instantly and fade and slide the content in with `opacity` and `transform`. Only one layout happens; the motion is composited.

   ```css
   .details[data-open='true'] > .details__content {
     animation: details-in 200ms ease-out;
   }
   @keyframes details-in {
     from { opacity: 0; transform: translateY(-4px); }
   }
   ```

2. **Let CSS animate the size** when the panel is small and isolated. A grid row transition needs no measurement:

   ```css
   .details { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 250ms ease; }
   .details[data-open='true'] { grid-template-rows: 1fr; }
   .details > .details__content { overflow: hidden; }
   ```

   This still lays out every frame, so wrap the panel in `contain: layout paint` when nothing inside needs to overflow it, and avoid it for tall content.
3. **`interpolate-size: allow-keywords`** lets `height` transition to `auto` directly in Chromium-based browsers. Treat it as progressive enhancement; other browsers snap open.

In all three, the component only toggles a `data-open` attribute. No state changes per frame, and no measuring.

## Scenario 2: a toast that slides in and out

```tsx
function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  return (
    <div
      role="status"
      className="toast"
      data-leaving={leaving}
      onAnimationEnd={(e) => {
        if (e.animationName === 'toast-out') onDone(); // unmount only after the exit animation
      }}
    >
      {message}
      <button onClick={() => setLeaving(true)}>Dismiss</button>
    </div>
  );
}
```

```css
.toast { animation: toast-in 200ms ease-out; }
.toast[data-leaving='true'] { animation: toast-out 150ms ease-in forwards; }
@keyframes toast-in { from { opacity: 0; transform: translateY(16px); } }
@keyframes toast-out { to { opacity: 0; transform: translateY(16px); } }
```

- Enter and exit use `transform` and `opacity` only.
- Exit animations need the element to stay mounted until they finish, so the parent removes the toast in `onDone`. A motion library's presence component (Motion's `AnimatePresence`) handles this for lists of items.
- Under reduced motion, the global rule below shortens these to an instant change, and `animationend` still fires.

## Scenario 3: a spinner that freezes during heavy work

```tsx
// Freezes: the angle comes from React state updated by a timer
function Spinner() {
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setAngle((a) => (a + 10) % 360), 16);
    return () => clearInterval(id);
  }, []);
  return <svg style={{ transform: `rotate(${angle}deg)` }} />;
}
```

While a big render, hydration or a long task runs, the interval can't fire, so the spinner stops exactly when it's needed. It also re-renders sixty times per second when nothing else happens.

```css
.spinner { animation: spin 800ms linear infinite; }
@keyframes spin { to { transform: rotate(1turn); } }
```

A CSS animation of `transform` runs on the compositor and keeps turning through main-thread work. One caveat: it must have been painted at least once before the long task starts. Showing the spinner and starting heavy synchronous work in the same task means it never appears. Start the work in a transition, after a yield, or in a worker (`react-responsiveness`).

## Scenario 4: an imperative shake on invalid input

```tsx
const SHAKE: Keyframe[] = [{ translate: '0' }, { translate: '-6px' }, { translate: '6px' }, { translate: '0' }];

function useShake<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const running = useRef<Animation | null>(null);

  useEffect(() => () => running.current?.cancel(), []);

  const shake = useCallback(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    running.current?.cancel(); // restart cleanly if triggered again mid-animation
    running.current = el.animate(SHAKE, { duration: 300, easing: 'ease-in-out' });
  }, []);

  return [ref, shake] as const;
}

function PinField() {
  const [ref, shake] = useShake<HTMLInputElement>();
  // ...
  return <input ref={ref} aria-invalid={invalid} onBlur={() => invalid && shake()} />;
}
```

- The Web Animations API starts the motion from the event, with no state, no class toggling and no `animationend` bookkeeping.
- The animation's end state equals its start state, so there's nothing to persist. For animations that end somewhere else, set that final style on the element (or call `commitStyles()` and then `cancel()`) instead of keeping a `fill: 'forwards'` animation alive.
- The cleanup cancels a running animation if the field unmounts mid-shake.

## Reduced motion, once for the whole app

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

A near-zero duration (rather than `none`) keeps `animationend` and `transitionend` firing, so components that wait for them still work. For JavaScript-driven motion, read the preference reactively:

```tsx
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(onChange: () => void) {
  const mql = window.matchMedia(reducedMotionQuery);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
}
```

Reduced motion doesn't mean no feedback: keep short opacity changes that explain what happened, and remove large movement, zooms and parallax.

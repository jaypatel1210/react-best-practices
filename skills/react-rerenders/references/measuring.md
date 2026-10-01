# Measuring Re-renders and Render Cost

Optimize only what you have measured. A re-render that costs a fraction of a millisecond is not a problem, however often it happens. Measure before and after every change, on the kind of device your users have.

## Contents

1. [Set up realistic conditions](#1-set-up-realistic-conditions)
2. [React DevTools: see what renders and why](#2-react-devtools-see-what-renders-and-why)
3. [Chrome Performance panel](#3-chrome-performance-panel)
4. [The Profiler API in code](#4-the-profiler-api-in-code)
5. [Quick checks during development](#5-quick-checks-during-development)
6. [Pitfalls that produce misleading numbers](#6-pitfalls-that-produce-misleading-numbers)
7. [Reporting a performance fix](#7-reporting-a-performance-fix)

## 1. Set up realistic conditions

- **Profile a production build.** Development builds are several times slower and include extra checks. For component-level timings in production, use a profiling build (`react-dom/profiling`; most frameworks have a flag or alias for it).
- **Throttle the CPU** by 4–6× in Chrome DevTools → Performance → CPU. Developer laptops hide problems that mid-range phones show immediately.
- **Use realistic data volumes**: the real number of rows, real text length, real images.
- **Measure the interaction users feel.** Measure the keystroke, the click that opens a menu, the scroll, not "page load" in the abstract. Interaction to Next Paint (INP) is the user-centric metric for this; aim for under 200 ms.
- **Translate milliseconds into frames.** A frame lasts 16.7 ms at 60 Hz and 8.3 ms at 120 Hz. A 50 ms render during a drag or scroll drops about three frames at 60 Hz, which users see as a stutter. That's why the example below flags renders over 16 ms.

## 2. React DevTools: see what renders and why

1. **Highlight updates.** In Components → Settings (gear) → General, enable "Highlight updates when components render". Perform the slow interaction and watch which parts of the page flash. Large flashing areas for a small interaction are the first clue.
2. **Profiler recording.** Open the Profiler tab, click record, perform the interaction once, then stop.
   - The **flame chart** shows each commit. Gray components didn't render; colored ones did, with their render time.
   - The **ranked chart** sorts components by render time. Start at the top.
3. **Why did this render?** In Profiler settings, enable "Record why each component rendered while profiling". Selecting a component then shows the reason: "Props changed: (onSelect)", "Hooks changed", "State changed", "The parent component rendered", "Context changed".
   - **"The parent component rendered"** → fix the parent's state placement (move state down, or children as props), or `memo` the component if restructuring isn't possible.
   - **"Props changed: (someFunction)"** on a `memo` component → an unstable prop is breaking memoization. See `react-memoization`.
   - **"Hooks changed"** → a hook's state or a context it reads changed. Check what the hook holds (`examples/hooks-that-hide-state.md`).
4. **React Compiler badge.** When the compiler is on, compiled components show a "Memo ✨" badge in the Components tree. A missing badge means the compiler skipped that component, usually because of a Rules of React violation.

## 3. Chrome Performance panel

Record the interaction in the Performance panel to see the whole picture: scripting, style recalculation, layout, and paint.

- **Long tasks** (red-flagged, over 50 ms) during the interaction are what users feel as jank.
- Recent React versions add React-specific tracks to this panel (scheduler priorities and component render timings) when using a development or profiling build. They make it easier to see whether time goes to React rendering, effects, or the browser's layout and paint.
- If most time goes to **Layout** or **Recalculate Style**, the problem is CSS or DOM size, not re-renders. Check for layout thrashing (reading `offsetHeight` after writing styles in a loop), huge DOM trees, and expensive selectors. See `react-animation/references/rendering-pipeline.md` and `react-large-lists`.
- **Mark your own operations** with `performance.mark()` and `performance.measure()`; they appear in the panel's *Timings* track next to React's work (`react-loading-performance/references/core-web-vitals.md`).

## 4. The Profiler API in code

For automated or production sampling, wrap a subtree in `<Profiler>`:

```tsx
import { Profiler, type ProfilerOnRenderCallback } from 'react';

const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration) => {
  // actualDuration: time spent rendering this commit (benefits from memoization)
  // baseDuration: estimated time to render the whole subtree without memoization
  if (actualDuration > 16) {
    reportMetric({ id, phase, actualDuration, baseDuration });
  }
};

<Profiler id="CustomerTable" onRender={onRender}>
  <CustomerTable rows={rows} />
</Profiler>;
```

`<Profiler>` is disabled in production builds unless you use the profiling build. It adds some overhead, so sample it rather than leaving it on everywhere.

## 5. Quick checks during development

Count renders of a suspect component:

```tsx
function SuspectComponent(props: Props) {
  if (process.env.NODE_ENV !== 'production') console.count('SuspectComponent render');
  // ...
}
```

Or log in an effect with no dependency array, which runs after every committed render:

```tsx
useEffect(() => {
  console.log('SuspectComponent committed');
});
```

Remove these before committing. Never leave render-phase side effects in shipped code.

## 6. Pitfalls that produce misleading numbers

- **StrictMode double rendering.** In development, StrictMode calls component functions twice and runs effects setup → cleanup → setup on mount. Render counts look doubled. That's expected and doesn't happen in production.
- **Development build timings.** These are not representative. Compare dev to dev or prod to prod, never across.
- **Measuring the first render only.** Many problems appear on the tenth keystroke or after data loads. Record the real interaction.
- **Averaging away spikes.** A single 300 ms render on opening a menu matters more than a 2 ms average.
- **Browser extensions** can add work to every render or DOM mutation. Profile in a clean profile or guest window.

## 7. Reporting a performance fix

State the interaction, the before and after numbers, and the conditions. For example:

> Typing in the coupon field: commit time went from 42 ms to 1.8 ms (production build, 4× CPU throttle). `OrderTimeline` and `InvoicePreview` no longer render on keystrokes.

A number like this makes the change reviewable and protects it from being "cleaned up" later.

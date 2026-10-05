# React Render Audit

A Claude Code command that finds out whether a real React or Next.js app is slow where users interact, and fixes the re-render causes that make it slow, without changing what the app does. When nothing is slow, it says so and changes nothing.

```
/optimize-renders [app-dir] [dir-to-optimize ...]
```

1. **Intake.** Detects the framework, React version, React Compiler, package manager, dev command and port. Ranks your directories by components and re-render risk, then asks which one or two to optimize, how to start the app, and whether to fix and commit, fix only, or just measure.
2. **Scenario.** Lists the page's interactive elements and writes a short, repeatable user flow with you (type in search, open a dialog, add to cart).
3. **Time it first.** Replays the flow in headless Chrome on mobile and desktop profiles, with no tracker in the page, and marks the steps users would notice: an interaction that takes over 200 ms to respond, a frame that freezes the page for over 200 ms, or a page load that blocks for over 200 ms. If nothing is slow, or the slow steps aren't slow because of re-rendering, it stops there and reports where the time goes.
4. **Find the cause.** Replays the flow again with a tracker that records every component render, why it happened, and what it cost in React's own render time. It ranks the causes by the time fixing each would save in a slow step. Causes that would save less than a frame are listed as not worth fixing, however many renders they show.
5. **Fix loop.** Takes the costliest cause inside your scope, fixes it with the matching rule from the [react-best-practices](../../README.md) skills, and runs your type check, lint and tests. The change stays only if two checks pass:
   - behavior is identical at every step;
   - a timing benchmark of the app without the fix against the app with it shows the slow step got faster by at least a frame.

   Otherwise the files are restored byte for byte.
6. **Final proof.** Runs the starting commit and the result side by side on both profiles, with the full procedure described below.
7. **Report.** Writes `report.html` and `report.md`:
   - what was slow before anything changed;
   - the measured speed-up, and each fix with its proof;
   - what was reverted, and what wasn't worth fixing;
   - before/after render counts and render time per step and per component.

Why time first: cutting renders is easy and often changes nothing users can feel. When each render takes microseconds, removing thousands of them saves a few milliseconds. Timing first means the command only changes code where re-rendering is what makes users wait.

## What it measures

A small tracker is injected into the page before any app script runs. It installs React's DevTools hook, so React reports every commit to it, with no change to your code or dependencies. For every commit it records which components rendered and why:

| reason | meaning |
|---|---|
| `state` | its own `useState`/`useReducer`/`useSyncExternalStore` changed, named by call order (`useState #2`) with old → new values |
| `context` / `contextUnstable` | a context changed value, or became a new object with the same content (wasted) |
| `props` / `propsUnstable` | a prop changed, or only got a new identity: a new function, a new object or array with the same content, new JSX (wasted) |
| `parent` | its parent re-rendered and every prop was equal (wasted) |
| remounts and identity churn | the same component mounted again, or a component type created during render |
| effect cascades | a second commit started by `setState` in an effect right after a render |

The tracker also records which state change started each cascade, which component created the props, long animation frames and slow interactions. It records what each render cost, from React's own profiling timers in development builds: the component's own time and, for a wasted render, the time of the subtree it re-rendered along with it. Those times add up per component and per cause, which is how fixes are ranked by the time they'd save. Each component is mapped to its source file and line through the dev server's source maps (webpack, Turbopack and Vite).

Counts are per commit, so StrictMode's double render doesn't inflate them. They're checked against components that count their own commits: in real Chrome on React 19, with and without StrictMode, and in unit tests on React 18 and 19.

## How speed is measured

Render counts say what changed. Timing says whether users feel it, and it's measured three times:

- **Triage, before any change.** Each step's response time, longest frame and blocking time, judged against the Core Web Vitals and Lighthouse limits (200 ms each), and how much of a slow step is re-rendering, first render, other script, or style and layout.
- **A proof for every fix.** The app without the fix against the app with it, 8 alternating pairs, judged on the slow steps. A fix stays only when a slow step got faster by at least a frame (16.7 ms) and nothing got slower.
- **The final benchmark,** with the full procedure below.

They share a fixed, versioned procedure ([protocol v1](skills/optimize-renders/references/benchmark-protocol.md)), so results are comparable between runs and machines. The final benchmark runs all of it:

- **No tracker.** It times the app with no render tracker in the page, so the measurement doesn't change what it measures.
- **Standard metrics.** It reports:
  - each interaction's response time, measured the way INP is and rated against the Core Web Vitals bands;
  - main-thread time and blocking time;
  - long animation frames and dropped frames;
  - React render time.
  The collector agrees exactly with Google's `web-vitals` library on the same interactions.
- **Side by side.** The baseline commit is checked out in a temporary git worktree outside your repository and gets its own dev server. The new code gets another. Runs alternate AB, BA, AB, each in a fresh browser profile.
- **Lighthouse's device profiles.** Mobile is a mid-tier phone screen with the CPU slowdown calibrated on your machine (measured with Lighthouse's BenchmarkIndex, then verified). Desktop is a 1350×940 screen at full speed.
- **Frozen network.** API responses are recorded once and replayed to every run, so backend speed and changing data don't count.
- **Honest statistics.** A same-vs-same (A/A) check measures the noise first and decides how many pairs to run. Every change comes with a 95% confidence interval (sign test: distribution-free and deterministic). A change counts only when the interval excludes zero.
- **Impact levels from known thresholds**, judged on the cautious end of the interval:
  - high: the interaction changes Core Web Vitals band, or moves by 100 ms or more;
  - medium: at least one frame (16.7 ms), or 20% of main-thread time;
  - low: smaller than that, so users won't notice.
- **Evidence you can re-check.** A Chrome trace per side opens in DevTools. The raw runs are in `bench.json`, and the same commands reproduce the result.

```
On mobile (store), the slowest response went from 176 ms to 40 ms, main-thread time fell 44%
(1,370 ms → 762 ms; 95% CI −46% to −43%), blocking time 738 ms → 277 ms.
  2  add Trail Runner   response time   148 ms → 40 ms   −104 ms (−112 to −104)   high
```
<sub>From the test lab, with expensive renders planted on purpose.</sub>

Beyond the lab, two more kinds of evidence are available ([details](skills/optimize-renders/references/field-and-ci.md)):
- **Real users.** `field crux` reads the Chrome UX Report around a deploy, and `field compare` compares your own data from the bundled `web-vitals` reporter.
- **CI.** `ci` writes a GitHub Actions workflow that benchmarks every pull request against its base.

## How "without changing behavior" is enforced

- After every scenario step, the visible text, the accessibility tree, the DOM, the data requests and the console errors are compared with the baseline. Generated `useId` values and CSS-in-JS class hashes are normalized first. Lines that already varied between baseline runs, such as clocks, are learned as noise and ignored.
- Your project's own type check, lint and related tests run after every fix.
- Fixes are classified: `auto` (behavior-preserving refactors), `ask` (changes timing or state lifetime, so it asks you first) and `suggest` (changes the DOM, such as virtualization, so it's only reported).
- Every file is backed up before an edit and restored exactly on failure, without touching git. Kept fixes are committed one per commit on a new branch, and nothing is pushed.

The check proves equivalence for the steps in the scenarios, so put your critical flows in them.

## Requirements

- Node 18 or newer, and Chrome, Chromium or Edge (or set `CHROME_PATH`). The benchmark needs Chrome 123 or newer.
- The app running in development mode locally.
- The [react-best-practices](../../README.md) plugin (installed automatically as a dependency).
- In a sandboxed shell, Chrome and the dev server need to run outside the sandbox. The command asks for that when it needs to.

## Install

```
/plugin marketplace add jaypatel1210/react-best-practices
/plugin install react-render-audit@react-best-practices
```

Then open Claude Code in your app's repository and run `/optimize-renders`.

## The script

Everything deterministic lives in one dependency-free script that you can also run yourself:

```bash
node skills/optimize-renders/scripts/render-audit.mjs help
node skills/optimize-renders/scripts/render-audit.mjs inspect --url http://localhost:3000/
node skills/optimize-renders/scripts/render-audit.mjs measure --audit .render-audit/audits/a1 --scenario flow.json --label baseline
```

| command | does |
|---|---|
| `doctor` | checks Node and starts Chrome |
| `detect`, `inventory` | describe the project and rank directories by re-render risk |
| `init` | writes the audit config |
| `wait`, `inspect` | wait for the dev server; list React status, renders on load and interactive elements |
| `triage` | times the current code and decides which steps are slow, and whether re-rendering is why |
| `measure` | replays a scenario N times and records renders, their cost and behavior per step |
| `analyze` | ranks hotspots inside the scope by the time they'd save in slow steps and maps each to a skill rule and a fix |
| `compare` | behavior check, plus how render work changed (exit 3 when behavior changed) |
| `backup`, `restore` | save files before a fix and put them back exactly |
| `baseline` | checks out the baseline commit outside the repository and installs it; `--sync --without fix-N` makes it "the app without this fix", `--reset` puts it back |
| `bench` | times A against B (or profiles A) on mobile and desktop, with confidence intervals and impact levels; `--quick --target` is the per-fix proof (exit 0 keep, 5 no gain, 4 slower) |
| `field crux`, `field compare` | real-user p75 from the Chrome UX Report, or from your own `web-vitals` data, before and after |
| `ci` | writes a GitHub Actions workflow that benchmarks each pull request |
| `changes`, `report` | the change log and the HTML/Markdown report |

Scenario format: [`skills/optimize-renders/references/scenarios.md`](skills/optimize-renders/references/scenarios.md).

## Development

```bash
bun run test:render-audit   # unit tests: tracker on React 18/19 (jsdom), statistics, triage, time ranking, per-fix decisions, replay, field data, CI, report
bun run e2e:render-audit    # real Chrome against fixtures/lab (about 8 minutes; SKIP_BENCH=1 skips the timing runs)
```

`fixtures/lab` is a small store with:
- planted problems (`?variant=broken`);
- the same store fixed (`?variant=fixed`);
- a "fix" that changes behavior (`?variant=wrong`).

Three options support the timing tests: `?cost=N` makes each render more expensive, `?api=` fetches from a cross-origin API, and `?rum=1` loads the real-user reporter. The end-to-end test requires:
- the tracker to match the lab's own commit counters exactly;
- the fixed variant to pass the behavior check, and the wrong variant to fail it;
- the timing collector to agree with `web-vitals`;
- network replay to serve a second origin;
- the CPU calibration to land within 20% of its target;
- triage to find typing in the broken store slow because of re-rendering, and in the fixed store not slow;
- the analysis to rank the two causes of slow typing first and mark the cheap ones (a remounting chip, an effect that copies a prop) as not worth fixing;
- the same code on two servers to show no meaningful difference and no gain for a targeted step;
- the per-fix proof to keep broken → fixed, and to reject fixed → broken;
- broken → fixed to be faster on both profiles, and fixed → broken to fail `--fail-on slower`.

## Limits

- It measures React DOM apps; React Native isn't supported. Server Components don't re-render in the browser, so only client components appear.
- Triage judges the scenario's steps only, with API responses replayed instantly: slow backends and flows outside the scenario need real-user data. Development builds are slower than production, so a step that's slow here may be fine in production; one that's fast here is fast there too.
- Render times come from React's profiling timers, which development builds have. In a production build the ranking falls back to render counts and nothing is judged worth fixing.
- The benchmark compares development builds on both sides: like for like, but slower than production in absolute terms. Production servers work too, if you build each side and pass their start commands.
- Equivalence covers the scenario steps, not every possible interaction.

MIT © 2026 Jay Patel

# React Render Audit

A Claude Code command that measures and cuts re-renders in a real React or Next.js app without changing what the app does, then proves how much faster it got.

```
/optimize-renders [app-dir] [dir-to-optimize ...]
```

1. **Intake.** Detects the framework, React version, React Compiler, package manager, dev command and port. Ranks your directories by components and re-render risk, then asks which one or two to optimize, how to start the app, and whether to fix and commit, fix only, or just measure.
2. **Scenario.** Lists the page's interactive elements and writes a short, repeatable user flow with you (type in search, open a dialog, add to cart).
3. **Baseline.** Replays the flow in headless Chrome several times, with real mouse and keyboard input, and records every component render and its cause.
4. **Fix loop.** Takes the worst cause inside your scope, fixes it with the matching rule from the [react-best-practices](../../README.md) skills, and runs your type check, lint and tests. It then measures again and keeps the change only if behavior is identical at every step and renders went down. Otherwise the files are restored byte for byte.
5. **Speed proof.** Runs the old and the new code side by side on the mobile and desktop profiles and times every step, as described below.
6. **Report.** Writes `report.html` and `report.md`:
   - the measured speed-up;
   - before/after renders per step and per component;
   - each change with its evidence;
   - what was reverted, and what's left.

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

The tracker also records which state change started each cascade, which component created the props, render time (development build), long animation frames and slow interactions. Each component is mapped to its source file and line through the dev server's source maps (webpack, Turbopack and Vite).

Counts are per commit, so StrictMode's double render doesn't inflate them. They're checked against components that count their own commits: in real Chrome on React 19, with and without StrictMode, and in unit tests on React 18 and 19.

## How the speed-up is proven

Render counts say what changed. The timing benchmark says whether users feel it. It follows a fixed, versioned procedure ([protocol v1](skills/optimize-renders/references/benchmark-protocol.md)), so results are comparable between runs and machines:

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
| `measure` | replays a scenario N times and records renders and behavior per step |
| `analyze` | ranks hotspots inside the scope and maps each to a skill rule and a fix |
| `compare` | behavior check and render deltas (exit 3 behavior changed, 4 regressed, 5 no improvement) |
| `backup`, `restore` | save files before a fix and put them back exactly |
| `baseline` | checks out the baseline commit outside the repository and installs it, for the benchmark |
| `bench` | times A against B (or profiles A) on mobile and desktop, with confidence intervals and impact levels |
| `field crux`, `field compare` | real-user p75 from the Chrome UX Report, or from your own `web-vitals` data, before and after |
| `ci` | writes a GitHub Actions workflow that benchmarks each pull request |
| `changes`, `report` | the change log and the HTML/Markdown report |

Scenario format: [`skills/optimize-renders/references/scenarios.md`](skills/optimize-renders/references/scenarios.md).

## Development

```bash
bun run test:render-audit   # unit tests: tracker on React 18/19 (jsdom), statistics, replay, field data, CI, report
bun run e2e:render-audit    # real Chrome against fixtures/lab (about 5 minutes; SKIP_BENCH=1 skips the benchmark runs)
```

`fixtures/lab` is a small store with:
- planted problems (`?variant=broken`);
- the same store fixed (`?variant=fixed`);
- a "fix" that changes behavior (`?variant=wrong`).

Three options support the timing tests: `?cost=N` makes each render more expensive, `?api=` fetches from a cross-origin API, and `?rum=1` loads the real-user reporter. The end-to-end test requires:
- the tracker to match the lab's own commit counters exactly;
- the fixed variant to pass the behavior check with fewer renders, and the wrong variant to fail it;
- the timing collector to agree with `web-vitals`;
- network replay to serve a second origin;
- the CPU calibration to land within 20% of its target;
- the same code on two servers to show no meaningful difference;
- broken → fixed to be faster on both profiles, and fixed → broken to fail `--fail-on slower`.

## Limits

- It measures React DOM apps; React Native isn't supported. Server Components don't re-render in the browser, so only client components appear.
- The benchmark compares development builds on both sides: like for like, but slower than production in absolute terms. Production servers work too, if you build each side and pass their start commands.
- Equivalence covers the scenario steps, not every possible interaction.

MIT © 2026 Jay Patel

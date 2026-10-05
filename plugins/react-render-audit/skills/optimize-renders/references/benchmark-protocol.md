# Timing benchmark protocol (v1)

Render counts show what a fix changed. The timing benchmark (`ra bench`) shows whether users feel it: how long interactions take to respond, and how much main-thread work the flow costs. It follows the fixed procedure below, so results are comparable between runs, machines and projects. Every report prints the protocol version; compare numbers only between reports with the same version and device profile.

## Metrics

Measured per scenario step in every run, with no render tracker in the page:

| Metric | Definition | Source |
|---|---|---|
| Response time | The step's slowest interaction: the longest Event Timing duration among the entries that share an `interactionId`, which is how INP measures one interaction. Split into input delay, processing and presentation delay. Only clicks, taps and key presses are interactions. The browser doesn't report interactions under 16 ms; they count as 16 ms and show as "≤16 ms". | Event Timing API |
| Main-thread time | Wall time of all tasks on the page's main thread during the step, also split into script, style and layout | Chrome's `Performance.getMetrics` (`TaskDuration`) |
| Blocking time | The sum, over the step's long tasks, of each task's time beyond 50 ms (the Total Blocking Time definition) | Long Tasks API |
| Long frames | Animation frames over 50 ms, with the scripts that ran in the worst one | Long Animation Frames API |
| Dropped frames, smoothness | Gaps between `requestAnimationFrame` callbacks while the step is active | `requestAnimationFrame` |
| React render time, commits | The sum of each commit's root `actualDuration` (development builds), and the number of commits | React DevTools hook, constant work per commit |

For the whole flow, page load included: main-thread time, blocking time, long frames, dropped frames and React time are summed, and the slowest response is the maximum over the steps.

The collector agrees with Google's `web-vitals` library on the same interactions; the end-to-end test checks this.

## Procedure

1. **Two sides.** A is the baseline and B the candidate. Each is served by a fresh development server started with the same command (`--a-cmd`, `--b-cmd`, with `{port}` for the port). The baseline is a git worktree of the baseline commit, outside the repository, with dependencies installed from the same lockfile and the app's untracked `.env` files linked in (`ra baseline`).
2. **Device profiles**, matching Lighthouse:
   - mobile: 412×823 at 1.75× density, with a phone user agent and the CPU slowed to a mid-tier phone;
   - desktop: 1350×940 at 1× density, at full CPU speed.
3. **CPU calibration** (mobile only):
   - The tool measures this machine's BenchmarkIndex, using the same measurement as Lighthouse, so Lighthouse's device-class table applies.
   - Slowdown = index ÷ 437.5, clamped to 1–20×. 437.5 is what Lighthouse's default 4× slowdown makes of the middle of its high-end desktop range (1500–2000).
   - It measures again under that slowdown and corrects once if the result is more than 10% off target.
4. **Frozen network.** The first run of A records the responses to cross-origin `fetch`/XHR requests (the app's APIs). Every later run, on both sides, gets those responses instantly. CORS allow-origin is adjusted for B's origin. Requests to the app's own dev server are never replayed, because they are part of the code under test.
5. **Warm-up.** One run per side, because dev servers compile routes on first request.
6. **A/A check.** Six pairs of A against A, labeled the same way real pairs are.
   - It estimates the noise and sets how many pairs to run (8 to 20). That's enough to detect one frame (16.7 ms) of response time, or the larger of 16.7 ms and 5% of main-thread time, with 80% power.
   - With 6 or more pairs it must also report no difference big enough to matter (see Impact levels). If it doesn't, the machine was noisy and the report says so.
7. **Pairs.** Runs alternate AB, BA, AB and so on, so drift and warm caches affect both sides equally.
   - Each run uses a fresh browser profile and real (trusted) input.
   - A step ends once React and the network have been quiet for 500 ms after its action.
8. **Traces.** One extra run per side records a Chrome trace. Traces aren't counted in the statistics, because tracing adds overhead. Open them in DevTools: Performance, then Load profile.
9. **Environment record.** Each report records:
   - Chrome version, CPU model and cores, OS;
   - power source (battery triggers a warning), load average and CI flag;
   - commit SHAs and the tool version.

## Statistics

- **Paired differences.** For each metric, d = B − A in every pair. The estimate is the median of d. Its 95% confidence interval comes from order statistics: the sign-test interval, with ranks from Binomial(n, ½). This method is:
  - distribution-free, because timings are skewed and have outliers;
  - exact, so coverage is at least 95%;
  - deterministic, so the same raw runs always give the same interval.
- **Relative change** is d divided by the median of A.
- **Verdict.** "Faster" when the whole interval is below zero, "slower" when it's above, otherwise "no measurable change".
- **Profile mode** (`--a` only) reports each metric's median with the same kind of interval.
- **Field data** (`ra field compare`) compares the 75th percentiles of two independent samples. Each sample gets a √0.95 order-statistic interval, and the difference interval spans their extremes, giving at least 95% coverage.

## Impact levels

Judged on the cautious end of the interval, which is the change we're 95% sure of:

| Level | Rule |
|---|---|
| High | An interaction moves to another INP band (good up to 200 ms, poor above 500 ms), or a response or blocking time changes by 100 ms or more (the long-standing limit for a response to feel instant) |
| Medium | 16.7 ms or more of response or main-thread time, 20% or more of main-thread time, all long frames removed (or new ones), or 2 or more dropped frames |
| Low | A real change smaller than that, which users won't notice |
| None | Not distinguishable from noise |

The whole flow's impact is its most important step's (or "mixed" when steps at that level go opposite ways); its totals are reported as numbers with their own intervals. The A/A check fails only on a difference that would otherwise show up as a medium or high impact: one frame of response or main-thread time, or 100 ms of blocking time.

`--fail-on slower` fails (exit 4) on any slowdown of medium impact or more. `--fail-on no-gain` fails (exit 5) when no scenario's whole flow got faster.

## Reading a result

- Quote the cautious bound, for example "responds at least 104 ms faster (95% confidence)", and the rating change if there is one.
- If render counts fell but timing didn't move, those renders were cheap. Say so: it's a real finding, and it argues against adding memoization for its own sake.
- Both sides run development builds. Absolute times are higher than in production, but the comparison is like for like. To compare production builds, build each side and pass production start commands (`next start -p {port}`, `vite preview --port {port}`) to `--a-cmd` and `--b-cmd`.
- Milliseconds differ between machines; verdicts shouldn't. Mobile numbers are roughly comparable across machines because of the calibration.
- A noisy machine produces wide intervals and "no measurable change", not false wins. Plug in, close heavy apps, and run again.

## What it doesn't claim

- **Real users.** It doesn't show improvement for real users; use CrUX or your own real-user data (`references/field-and-ci.md`).
- **Other flows.** It doesn't cover behavior or speed outside the scenarios.
- **Production timings.** It gives none unless both sides are production servers.

## Reproducing a result

Each benchmark writes `bench.json`, with every run, step and setting, plus the Chrome traces. To reproduce on the same commits:

```
ra baseline --audit <audit> --root <app> --ref <baseline sha>
ra bench --audit <audit> --scenario <file> --a <url A> --a-cmd "<dev command with {port}>" --b <url B> --b-cmd "<same command>"
```

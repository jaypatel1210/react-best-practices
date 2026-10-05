---
name: optimize-renders
description: Find out whether a real React or Next.js app is slow where users interact, and fix the re-render causes that make it slow, without changing what it does. Asks which app, directories and user flow to target, then times the flow first on mobile and desktop profiles to find the steps users would notice. Where re-rendering is a big part of a slow step, it records every component render with its cost, fixes the causes that cost the most time using the react-best-practices skills, and keeps a fix only if behavior stayed identical (text, accessibility tree, DOM, network, console) and a timing benchmark shows the slow step got faster. Writes a before/after report; when nothing is slow, it says so and changes nothing. Run it as /optimize-renders, optionally with the app folder and the directories to optimize.
argument-hint: "[app-dir] [dir-to-optimize ...]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/render-audit.mjs *)
license: MIT
---

# Optimize React re-renders

This workflow times a real app before touching it, finds the steps users would find slow, and fixes only the re-render causes that make those steps slow. Every fix must keep behavior identical and make its slow step measurably faster, or it's reverted. One script does the deterministic work: driving Chrome, timing, counting renders and their cost, comparing behavior and writing the report. Your job is the judgment: choosing the scope and the flow, reading the code, and applying the right fix from the react-* skills.

Run the script as:

```
node ${CLAUDE_SKILL_DIR}/scripts/render-audit.mjs <command> [options]
```

`help` lists every command. Below it's written as `ra <command>`.

## Ground rules

1. **Time decides.** Fix only what makes a slow step slow, and keep a fix only when the benchmark shows that step got faster by at least a frame. Render counts explain where render time goes; they never justify a change on their own. If nothing is slow, say so and change nothing.
2. **Behavior first.** Never keep a change that fails the behavior comparison, the type check, lint or tests. When in doubt, revert.
3. **One fix per measurement.** Change one cause, check it, prove it, decide. Never batch fixes.
4. **Evidence only.** Fix hotspots `analyze` marks worth fixing. Don't sprinkle `memo`, `useMemo` or `useCallback`; don't touch code outside the chosen scope without asking.
5. **Respect the safety class** of each hotspot: `auto` fixes are behavior-preserving refactors you may apply; ask the user before an `ask` fix (it changes timing or state lifetime); never apply a `suggest` fix (it changes the DOM, such as virtualization), only list it.
6. **Respect the codebase.** Follow its conventions and libraries. If React Compiler is on, don't hand-write memoization; fix what stops the compiler instead.
7. **Protect the user's work.** Back up every file before editing it (`ra backup`) and revert with `ra restore`, never with `git checkout`, `git reset` or `git stash`. Commit only the files you changed, never push, never skip hooks.
8. **Privacy.** Never read or print `.env` files or secrets. Keep credentials out of scenario files (use `${ENV_VAR}`). The report stays local unless the user asks to share it.
9. **Quote numbers honestly.** Claim a speed-up only from benchmark verdicts, quote the cautious bound ("at least 104 ms faster"), and say when timings come from a development build.

## 1. Intake

1. **Find the app.** Use the first argument, or the current directory. In a monorepo root, find apps (folders whose `package.json` depends on `react`) and ask which one.
2. **Detect and survey:**
   ```
   ra detect --root <app>
   ra inventory --root <app> --top 10
   ```
   Show the detect summary in two or three lines. Warn and stop for React Native (no DOM).
3. **Ask the user** in one AskUserQuestion call (skip what the arguments already answered):
   - **Scope** (multi-select, at most two): the top directories from the inventory, with a short reason each ("38 components, 6 inline provider values"). They can type a different directory or a single file.
   - **Dev server:** the detected command and URL (recommended), "it's already running", or their own command, port or URL.
   - **Mode:** *Fix and commit each kept fix on a new branch* (recommended) · *Fix, but leave changes uncommitted* · *Measure and report only*.
   - **Device profiles:** *Mobile and desktop* (recommended) · *Mobile only* · *Desktop only*. Timing runs first in every mode, because it decides what's worth fixing.
   Then ask in plain text which page and flow matter (for example "the company page: search a service, pick a slot"), unless it's obvious from the scope. Ask which interactions feel slow, if any: those belong in the flow.
4. **Choose the audit directory.** Measure-only: a temporary folder outside the repo, so nothing in the repo changes. Fix modes: `<app>/.render-audit/audits/<YYYYMMDD-HHMM>`, and suggest adding `.render-audit/audits/` to `.gitignore` (ask first).
5. **Write the config:**
   ```
   ra init --audit <audit> --root <app> --url <page-url> --scope <dir1>,<dir2> --dev "<command>"
   ```
   Defaults are 3 runs plus 1 warm-up and 4× CPU slowdown during interactions; change them with `--runs` or `--cpu` if the user asks.
6. **Fix modes only:** if the working tree is clean, create a branch `perf/render-audit-<date>`. If it isn't, tell the user which files are modified and ask whether to continue on the current branch; never stash or discard their changes. Note the starting commit (`git rev-parse HEAD`): it's the final benchmark's baseline.

## 2. Start the app

If the app isn't running, start the dev command in the background (from the directory `detect` reports), then `ra wait --url <url>`. A dev server often compiles on the first request; every measurement's warm-up run absorbs that.

If the page needs a login, ask how to get a test session: a scenario that types `${TEST_USER}`/`${TEST_PASSWORD}` read from environment variables the user sets, or a cookies file exported from a logged-in browser (`--cookies file.json`). Never use a real user's credentials.

## 3. Write the scenario

1. `ra inspect --url <page-url> --root <app>` prints whether React is in development mode, what renders on load, and the interactive elements with ready-made targets. If the Chrome DevTools MCP is available, you can also use it to look around.
2. Write `<app>/.render-audit/scenarios/<name>.json` (in measure-only mode, inside the audit directory instead): 3 to 8 steps that a real user does on this page and that render the components in scope. Include the interactions the user said feel slow. Prefer role and name targets. The format, actions and tips are in `references/scenarios.md`.
3. Avoid irreversible actions: real purchases, deletions, messages sent. Use test data, or stop the flow before the final submit.
4. Check it quickly: `ra measure --audit <audit> --scenario <file> --label check --runs 1 --warmup 0`. Fix any step that fails.
5. **Phone layout** (mobile profile): `ra inspect --url <page> --root <app> --profile mobile`. Every target must exist at 412 px. If one doesn't, write a mobile variant of the scenario, or time desktop only.
6. Show the user the steps, one line each, and get a yes.

## 4. Time it first

Read `references/benchmark-protocol.md` once; it defines the measurements, thresholds and statistics.

```
ra triage --audit <audit> --scenario <file> --url <page-url> --profiles <profiles>
```

It times the flow on the running app with no tracker in the page, 6 runs per profile, calibrating the CPU for mobile (a few minutes; run it in the background). It marks each step:

- **slow** when an interaction takes over 200 ms to respond, a single frame takes over 200 ms, or the page load blocks for over 200 ms;
- **re-rendering** when re-rendering is a big part of a slow step: at least 100 ms, or one frame and a fifth of the step's main-thread time.

Tell the user, in a few lines, each slow step, what makes it slow and where the time goes. Then follow the decision it prints:

- **NOTHING SLOW:** stop. Fewer renders wouldn't make this flow noticeably faster. Go to step 8, and say so plainly. If the user knows of a slow interaction elsewhere, offer to time that flow instead.
- **NOT RE-RENDERS:** don't run the fix loop. Report where the time goes (first render, other script, style and layout, the long-frame scripts) and the skill that addresses it, then go to step 8. Fix nothing unless the user asks; those fixes are outside this workflow's checks.
- **FIX RENDERS:** continue with the slow steps the triage names.
- **SLOW, CAUSE UNKNOWN:** the app ran a production build, which doesn't show React's render time. Time a development build instead.

Development builds run slower than production. A step that's fast in development is fast in production, but a slow one may be fine there; say so when you report it. To check how slow a step is for real users, run `triage` once more against a production server, with `--label production`, `--cmd "<build and start command with {port}>"` and a `--url` on that port. It's saved as `triage-production.json`, beside the development triage, which still ranks the fixes.

## 5. Find what makes the slow steps slow

```
ra measure --audit <audit> --scenario <file> --label baseline
ra analyze --audit <audit> --label baseline
```

The tracker records every component render, why it happened, and its cost in React's own render time. `analyze` reads the triage and ranks hotspots by the render time each fix would save in a slow step, scaled to the device profile it was slow on. Hotspots that would save less than a frame (16.7 ms) are listed as **not worth fixing**: skip them, whatever their render counts.

Read the analysis. If render counts varied between runs, find out why (live data, timers, A/B flags) and stabilize the flow, or note it. Then tell the user, in a few lines: the React time in the slow steps, the top hotspots worth fixing with their estimated saving, and how many were too cheap to matter. Fixes in the scope often save their time in shared components that live elsewhere (design-system primitives, icons). In measure-only mode, go to step 8.

## 6. Fix loop

**Before the first fix**, prepare the copy that the per-fix proofs time as "before". It installs dependencies, so start it in the background while you work on the first fix. It needs an unsandboxed shell, and untracked `.env` files are linked by name, never read.

```
ra baseline --audit <audit> --root <app> --ref <starting commit>
```

Write the dev command with `{port}` where the port goes (`next dev -p {port}`, `vite --port {port}`, `<root script> -- --port {port}`), run from the folder `detect` reported. For Next.js, prefix the copy's command (`--a-cmd`) with `rm -rf .next &&`: the copy is disposable, and a leftover `.next` can stop it from starting.

Take the in-scope hotspots marked worth fixing, in ranked order. Stop when none is left, when the last proof shows the slow steps within the limits, or after about five kept fixes (or the number the user chose). For hotspot `H<k>` and fix number `N`:

1. **Understand it.** Read the file and line `fix in` points to, plus the components in the evidence. Open the skill the hotspot names (`react-rerenders`, `react-memoization`, `react-context`, `react-reconciliation`, `react-effects` and so on) and `references/fix-playbook.md`. Confirm the cause in code before changing anything. If the evidence doesn't match the code, skip it and say why.
2. **Decide the fix.** Prefer structural fixes (move state down, pass children, memoize a context value, define components at module scope, derive instead of syncing) over memoization. Ask first for `ask` fixes; record `suggest` ones as `proposed` and move on.
3. **Back up**, listing every file you'll edit or create: `ra backup --audit <audit> --label fix-N <files...>`
4. **Make the smallest change** that removes the cause: no reformatting, renames or drive-by edits. Keep the rendered DOM identical (same elements, order and attributes); use fragments when you extract a component.
5. **Run the gates** from the config (`detected.gates`): type check, lint on the changed files, and the tests related to them. If a gate fails, fix the change; if it can't be fixed, `ra restore --label fix-N`.
6. **Check behavior:**
   ```
   ra measure --audit <audit> --scenario <file> --label after-N
   ra compare --audit <audit> --after after-N --prev <last kept label, or baseline>
   ```
   Behavior is always compared with the baseline. On `BEHAVIOR CHANGED`, revert (see 8). If compare reports that render work didn't go down and the fix doesn't defer work, revert without benchmarking.
7. **Prove it's faster.** Make the copy "the app without this fix", then time it against the running app:
   ```
   ra baseline --audit <audit> --sync --without fix-N
   ra bench --audit <audit> --scenario <file> --label proof-N --quick \
     --a http://localhost:<free port> --a-cmd "<dev command>" --b <page URL on the running app>
   ```
   `--quick` runs 8 alternating pairs on the profiles where the triage found the steps slow, at the triage's CPU slowdown, and judges those steps (`--target <step numbers>` narrows it). It takes 5 to 10 minutes; run it in the background. Exit 0: a slow step got faster by at least a frame and nothing got slower. Exit 5: no gain users would notice. Exit 4: something got slower.
8. **Decide:**
   - **Exit 0:** keep it. In commit mode: `git add <only your files>` then `git commit -m "perf(render-audit): <title>" -- <files>`, with the hotspot and the proof's numbers in the body. Record it:
     `ra changes add --audit <audit> --title "<title>" --status kept --hotspot H<k> --component <name> --file <path> --skill <skill> --rule "<rule>" --safety <class> --measure after-N --proof proof-N --commit <sha> --gates typecheck=pass,lint=pass,tests=pass`
     (save `git diff` of the change to a file in the audit directory and pass `--diff-file`).
   - **Behavior changed, exit 5 or exit 4:** `ra restore --audit <audit> --label fix-N`, then record it with `--status reverted --reason "<what compare or the proof showed>"` (and `--proof proof-N` when the proof ran). If only the DOM differs and you can show it's a harmless artifact, you may re-run compare with `--allow-dom` and explain why in `--reason`.
9. **Re-rank:** after a kept fix, run `ra analyze --audit <audit> --label after-N` and continue with what's still worth fixing, because fixing one cause often removes or reorders others.

## 7. Final proof

Skip this step when no fix was kept.

1. `ra baseline --audit <audit> --reset` puts the copy back at the starting commit.
2. Stop the dev server from step 2, so both sides start fresh.
3. Run the full benchmark in the background and wait. It calibrates the CPU, then runs the A/A check, the alternating pairs and the traces:
   ```
   ra bench --audit <audit> --scenario <file> --label final --profiles <profiles> \
     --a http://localhost:<port A> --a-cmd "<dev command>" \
     --b http://localhost:<port B> --b-cmd "<dev command>"
   ```
   As in the proofs, only the copy's command (`--a-cmd`) gets `rm -rf .next &&`.
   For CORS errors, running on battery or a failed A/A check, see `references/troubleshooting.md`.
4. **Read the result**, per profile: each slow step before → after, with any rating change; main-thread time with its interval; any step that got slower.
5. **Clean up:** `ra baseline --remove --audit <audit>`.

## 8. Report

1. In fix modes, run the full build or the project's check script once if there is one, and report the result.
2. `ra report --audit <audit>` writes `report.html` and `report.md`. They lead with the triage, then the measured speed-up and each fix's proof; render counts follow.
3. Tell the user, briefly:
   - what was slow before, and the speed result as in step 7;
   - each kept fix in one line, with what its proof showed;
   - what was reverted and why (behavior changed, or no gain users would notice);
   - what was left alone as not worth fixing, in one line;
   - that behavior was identical at every step;
   - where the report is, and the branch name (not pushed).
   When nothing was slow, the report is the triage: say the flow is fast and that nothing was changed.
   Offer to open the report, or to publish it as a private page if they want to share it (it contains their code, so only on request).

## 9. Optional: real users and CI

Offer each of these in one line, and do one only on a yes, as its own commit. Details are in `references/field-and-ci.md`.

- **Chrome UX Report** (public sites): `ra field crux --origin <site> --history --deploy <date>` shows real users' 75th percentile around the deploy. It needs an API key the user exports.
- **Own real-user data:** add `assets/web-vitals-reporter.js` to the app; `ra field compare` reads what it sends. It adds a dependency and an endpoint, so ask first.
- **CI:** `ra ci --app <app> --scenario <file> --dev "<dev command>"` writes a workflow that benchmarks each pull request against its base and fails the ones that are measurably slower.

## References

- `references/benchmark-protocol.md`: the triage thresholds, the per-fix proof, the full benchmark's procedure, statistics and impact levels, and how to read and reproduce a result.
- `references/fix-playbook.md`: every hotspot kind with the skill rule, the fix pattern, how to keep behavior identical, and the pitfalls (stale closures, SSR, resets). Read it before the first fix.
- `references/scenarios.md`: scenario format, actions, targets, logins, and keeping runs deterministic.
- `references/field-and-ci.md`: the Chrome UX Report, the real-user reporter and `field compare`, and the pull-request workflow.
- `references/troubleshooting.md`: sandboxed shells, Chrome not found, React not detected, steps that never settle, noisy comparisons, benchmark problems, Next.js and monorepo notes.

---
name: optimize-renders
description: Measure and cut React re-renders in a real React or Next.js app without changing what it does. Asks which app, which directories and which user flow to target, replays the flow in headless Chrome to count every component render and why it happened, fixes the worst causes one at a time using the react-best-practices skills, proves each fix kept behavior identical (text, accessibility tree, DOM, network, console), proves the speed-up with a timing benchmark on mobile and desktop profiles, and writes a before/after report. Run it as /optimize-renders, optionally with the app folder and the directories to optimize.
argument-hint: "[app-dir] [dir-to-optimize ...]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/render-audit.mjs *)
license: MIT
---

# Optimize React re-renders

This workflow measures a real app, fixes the causes of wasted renders one at a time, proves every kept fix left behavior unchanged, and then proves how much faster the app got. One script does the deterministic work (driving Chrome, counting renders, comparing behavior, timing both versions, writing the report). Your job is the judgment: choosing the scope and the flow, reading the code, and applying the right fix from the react-* skills.

Run the script as:

```
node ${CLAUDE_SKILL_DIR}/scripts/render-audit.mjs <command> [options]
```

`help` lists every command. Below it's written as `ra <command>`.

## Ground rules

1. **Behavior first.** Never keep a change that fails the behavior comparison, the type check, lint or tests. When in doubt, revert.
2. **One fix per measurement.** Change one cause, measure, decide. Never batch fixes before measuring.
3. **Evidence only.** Fix hotspots the measurement shows. Don't sprinkle `memo`, `useMemo` or `useCallback`; don't touch code outside the chosen scope without asking.
4. **Respect the safety class** of each hotspot: `auto` fixes are behavior-preserving refactors you may apply; ask the user before an `ask` fix (it changes timing or state lifetime); never apply a `suggest` fix (it changes the DOM, such as virtualization), only list it.
5. **Respect the codebase.** Follow its conventions and libraries. If React Compiler is on, don't hand-write memoization; fix what stops the compiler instead.
6. **Protect the user's work.** Back up every file before editing it (`ra backup`) and revert with `ra restore`, never with `git checkout`, `git reset` or `git stash`. Commit only the files you changed, never push, never skip hooks.
7. **Privacy.** Never read or print `.env` files or secrets. Keep credentials out of scenario files (use `${ENV_VAR}`). The report stays local unless the user asks to share it.
8. **Speed claims need the benchmark.** Fewer renders is a count, not proof of speed. Say the app got faster only from `ra bench` verdicts, quote the cautious bound ("at least 104 ms faster"), and say plainly when timing didn't change.

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
   - **Speed proof:** *Benchmark on mobile and desktop at the end* (recommended; it runs the old and new code side by side and takes roughly 10–30 minutes) · *Mobile only* · *Desktop only* · *Skip*. In measure-only mode it profiles the current speed instead.
   Then ask in plain text which page and flow matter (for example "the company page: search a service, pick a slot"), unless it's obvious from the scope.
4. **Choose the audit directory.** Measure-only: a temporary folder outside the repo, so nothing in the repo changes. Fix modes: `<app>/.render-audit/audits/<YYYYMMDD-HHMM>`, and suggest adding `.render-audit/audits/` to `.gitignore` (ask first).
5. **Write the config:**
   ```
   ra init --audit <audit> --root <app> --url <page-url> --scope <dir1>,<dir2> --dev "<command>"
   ```
   Defaults are 3 runs plus 1 warm-up and 4× CPU slowdown during interactions; change them with `--runs` or `--cpu` if the user asks.
6. **Fix modes only:** if the working tree is clean, create a branch `perf/render-audit-<date>`. If it isn't, tell the user which files are modified and ask whether to continue on the current branch; never stash or discard their changes. Note the starting commit (`git rev-parse HEAD`): it's the benchmark's baseline.

## 2. Start the app

If the app isn't running, start the dev command in the background (from the directory `detect` reports), then `ra wait --url <url>`. A dev server often compiles on the first request; the measurement's warm-up run absorbs that.

If the page needs a login, ask how to get a test session: a scenario that types `${TEST_USER}`/`${TEST_PASSWORD}` read from environment variables the user sets, or a cookies file exported from a logged-in browser (`--cookies file.json`). Never use a real user's credentials.

## 3. Write the scenario

1. `ra inspect --url <page-url> --root <app>` prints whether React is in development mode, what renders on load, and the interactive elements with ready-made targets. If the Chrome DevTools MCP is available, you can also use it to look around.
2. Write `<app>/.render-audit/scenarios/<name>.json` (in measure-only mode, inside the audit directory instead): 3 to 8 steps that a real user does on this page and that render the components in scope. Prefer role and name targets. The format, actions and tips are in `references/scenarios.md`.
3. Avoid irreversible actions: real purchases, deletions, messages sent. Use test data, or stop the flow before the final submit.
4. Check it quickly: `ra measure --audit <audit> --scenario <file> --label check --runs 1 --warmup 0`. Fix any step that fails.
5. Show the user the steps, one line each, and get a yes before the baseline.

## 4. Baseline

```
ra measure --audit <audit> --scenario <file> --label baseline
ra analyze --audit <audit> --label baseline
```

Read the analysis. If render counts varied between runs, find out why (live data, timers, A/B flags) and stabilize the flow, or note it. Then tell the user, in a few lines, the totals, how many renders were started by state inside the scope, and the top hotspots. Fixes in the scope usually save most of their renders in shared components that live elsewhere (design-system primitives, icons), so judge results by total and wasted renders, not only by components in the scope. In measure-only mode, go to step 6.

## 5. Fix loop

Take in-scope hotspots in ranked order. Stop after about five kept fixes (or the number the user chose), or when nothing in scope is left above the thresholds. For hotspot `H<k>` and fix number `N`:

1. **Understand it.** Read the file and line `fix in` points to, plus the components in the evidence. Open the skill the hotspot names (`react-rerenders`, `react-memoization`, `react-context`, `react-reconciliation`, `react-effects` and so on) and `references/fix-playbook.md`. Confirm the cause in code before changing anything. If the evidence doesn't match the code, skip it and say why.
2. **Decide the fix.** Prefer structural fixes (move state down, pass children, memoize a context value, define components at module scope, derive instead of syncing) over memoization. Ask first for `ask` fixes; record `suggest` ones as `proposed` and move on.
3. **Back up**, listing every file you'll edit or create: `ra backup --audit <audit> --label fix-N <files...>`
4. **Make the smallest change** that removes the cause: no reformatting, renames or drive-by edits. Keep the rendered DOM identical (same elements, order and attributes); use fragments when you extract a component.
5. **Run the gates** from the config (`detected.gates`): type check, lint on the changed files, and the tests related to them. If a gate fails, fix the change; if it can't be fixed, `ra restore --label fix-N`.
6. **Measure and compare:**
   ```
   ra measure --audit <audit> --scenario <file> --label after-N
   ra compare --audit <audit> --after after-N --prev <last kept label, or baseline>
   ```
   Behavior is always compared with the baseline; renders are compared with the last kept state.
7. **Decide:**
   - `PASS`: keep it. In commit mode: `git add <only your files>` then `git commit -m "perf(render-audit): <title>" -- <files>`, with the hotspot and before/after numbers in the body. Record it:
     `ra changes add --audit <audit> --title "<title>" --status kept --hotspot H<k> --component <name> --file <path> --skill <skill> --rule "<rule>" --safety <class> --measure after-N --commit <sha> --gates typecheck=pass,lint=pass,tests=pass`
     (save `git diff` of the change to a file in the audit directory and pass `--diff-file`).
   - `BEHAVIOR CHANGED`, `REGRESSED` or `NO IMPROVEMENT`: `ra restore --audit <audit> --label fix-N`, then record it with `--status reverted --reason "<what the compare showed>"`. If only the DOM differs and you can show it's a harmless artifact, you may re-run compare with `--allow-dom` and explain why in `--reason`.
8. **Re-rank:** after a kept fix, run `ra analyze --audit <audit> --label after-N` and continue with its hotspots, because fixing one cause often removes or reorders others.

## 6. Prove the speed-up

Skip this step if the user chose *Skip*. Read `references/benchmark-protocol.md` once; it defines the procedure.

1. **Baseline checkout.** `ra baseline --audit <audit> --root <app> --ref <starting commit>` checks the baseline out in the temp folder and installs its dependencies.
   - It needs an unsandboxed shell.
   - Untracked `.env` files are linked by name and never read.
   - In *fix but uncommitted* mode the baseline is `HEAD`.
2. **Dev command.** Write it with `{port}` where the port goes (`next dev -p {port}`, `vite --port {port}`, `<root script> -- --port {port}`), run from the folder `detect` reported. Stop the dev server from step 2 so both sides start fresh.
3. **Phone layout.** Run `ra inspect --url <page> --root <app> --profile mobile`. Every target must exist at 412 px. If one doesn't, write a mobile variant of the scenario, or use `--profiles desktop`.
4. **Run it** in the background and wait. It calibrates the CPU, then runs the A/A check, the alternating pairs and the traces:
   ```
   ra bench --audit <audit> --scenario <file> --label final \
     --a http://localhost:<port A> --a-cmd "<dev command>" \
     --b http://localhost:<port B> --b-cmd "<dev command>"
   ```
   For CORS errors, running on battery or a failed A/A check, see `references/troubleshooting.md`.
5. **Read the result**, per profile:
   - the slowest response before → after, with any rating change;
   - main-thread time, with its interval;
   - the steps with medium or high impact.
   If nothing changed measurably, say so: the renders removed were cheap.
6. **Clean up:** `ra baseline --remove --audit <audit>`.

In measure-only mode, run `ra bench` with only `--a` and `--a-cmd`. That profiles today's speed: each interaction's response time, with its rating.

## 7. Report

1. In fix modes, run the full build or the project's check script once if there is one, and report the result.
2. `ra report --audit <audit>` writes `report.html` and `report.md`, with the speed section from the latest benchmark (`--bench <label>` picks another).
3. Tell the user, briefly:
   - the speed result first, if there is one, as in step 6;
   - the render numbers: component renders and wasted renders before → after (across every step, page load included), remounts, and that behavior was identical at every step;
   - each kept fix in one line;
   - what was reverted and why;
   - what's left (`ask` and `suggest` items);
   - where the report is, and the branch name (not pushed).
   Offer to open the report, or to publish it as a private page if they want to share it (it contains their code, so only on request).

## 8. Optional: real users and CI

Offer each of these in one line, and do one only on a yes, as its own commit. Details are in `references/field-and-ci.md`.

- **Chrome UX Report** (public sites): `ra field crux --origin <site> --history --deploy <date>` shows real users' 75th percentile around the deploy. It needs an API key the user exports.
- **Own real-user data:** add `assets/web-vitals-reporter.js` to the app; `ra field compare` reads what it sends. It adds a dependency and an endpoint, so ask first.
- **CI:** `ra ci --app <app> --scenario <file> --dev "<dev command>"` writes a workflow that benchmarks each pull request against its base and fails the ones that are measurably slower.

## References

- `references/fix-playbook.md`: every hotspot kind with the skill rule, the fix pattern, how to keep behavior identical, and the pitfalls (stale closures, SSR, resets). Read it before the first fix.
- `references/scenarios.md`: scenario format, actions, targets, logins, and keeping runs deterministic.
- `references/benchmark-protocol.md`: the timing benchmark's metrics, procedure, statistics and impact levels, and how to read and reproduce a result.
- `references/field-and-ci.md`: the Chrome UX Report, the real-user reporter and `field compare`, and the pull-request workflow.
- `references/troubleshooting.md`: sandboxed shells, Chrome not found, React not detected, steps that never settle, noisy comparisons, benchmark problems, Next.js and monorepo notes.

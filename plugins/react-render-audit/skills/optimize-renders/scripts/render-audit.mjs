#!/usr/bin/env node
// render-audit: time a scripted user flow first to find the steps users would find slow, measure
// which React components re-render there and what that costs, rank the causes by the time they
// would save, verify that a refactor kept behavior identical, prove each fix and the result with a
// timing benchmark, and report before/after.
// No dependencies: Node 18+ and a local Chrome or Chromium.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { list, parseViewport, readJson, writeJson } from './lib/util.mjs';

const HELP = `render-audit — find, fix and prove React re-render fixes that make a slow app faster

Usage: node render-audit.mjs <command> [options]

Setup
  doctor                         Check Node and Chrome
  detect   --root DIR            Framework, React version, Compiler, scripts, port (JSON with --json)
  inventory --root DIR [--dirs a,b] [--top N]
                                 Rank directories by components and re-render risk signals
  init     --audit DIR --root DIR --url URL [--scope a,b] [--dev CMD] [--runs N] [--cpu N]
                                 Write the audit config (DIR/config.json)
  wait     --url URL [--timeout S]
                                 Wait until the dev server answers

Time first
  triage   --audit DIR --scenario FILE [--scenario FILE ...] [--url URL] [--cmd CMD] [--cwd DIR]
           [--profiles mobile,desktop] [--runs N] [--cpu-mobile N] [--trace] [--json]
                                 Time the current code (no render tracker) and decide which steps are
                                 slow and whether re-rendering is a big part of them (writes
                                 DIR/triage.json; uses the running app at URL, or starts CMD)

Measure
  inspect  --url URL [--root DIR] [--profile mobile|desktop]
                                 React status, renders on load, interactive elements for scenarios
  measure  --audit DIR --scenario FILE --label NAME [--runs N] [--warmup N] [--cpu N] [--headed]
                                 Replay the scenario and record every render and its render time
                                 (writes DIR/runs/NAME/)
  analyze  --audit DIR [--label NAME] [--top N] [--json]
                                 Rank render hotspots by the time they cost in the slow steps and map
                                 them to fixes; marks the ones not worth fixing
  compare  --audit DIR --after NAME [--base baseline] [--prev NAME] [--allow-dom] [--json]
                                 Check behavior is unchanged; shows how render work changed

Fix loop
  backup   --audit DIR --label fix-N FILE...
                                 Save files before a fix edits or creates them
  restore  --audit DIR --label fix-N
                                 Put them back exactly (and delete files the fix created)

Timing benchmark (speed, not counts)
  baseline --audit DIR --root DIR [--ref REF] [--dir PATH] [--install CMD|none] [--setup CMD] [--no-env]
                                 Check out REF (default HEAD) outside the repository and install it,
                                 to run as the "before" side (writes DIR/baseline.json); an existing
                                 copy moves to REF and keeps its dependencies unless they changed
  baseline --sync --audit DIR [--without fix-N]
                                 Make the copy match your working tree, minus the files fix-N's
                                 backup saved: "before this fix" for the per-fix proof
  baseline --reset --audit DIR   Put the copy back at its commit
  baseline --remove --audit DIR  Remove that checkout (or --dir PATH)
  bench    --audit DIR --scenario FILE [--scenario FILE ...] --a URL [--a-cmd CMD] [--a-cwd DIR]
           [--a-label NAME] [--b URL [--b-cmd CMD] [--b-cwd DIR] [--b-label NAME]]
           [--profiles mobile,desktop] [--pairs auto|N] [--max-pairs N] [--aa N] [--cpu-mobile N]
           [--quick] [--target STEP,...] [--no-replay] [--no-trace] [--disable-cors] [--label NAME]
           [--markdown FILE] [--fail-on slower|no-gain] [--json]
                                 Time B against A (or profile A alone) in alternating runs under
                                 device profiles; a command may contain {port} (writes DIR/bench/NAME/).
                                 --quick is the per-fix proof: 8 pairs, no A/A check, no traces, on
                                 the profiles where the triage found the targets slow. --target
                                 (step numbers or names; default with --quick: the triage's slow
                                 steps) decides: exit 0 when a target got faster by at least a frame
                                 and nothing got slower, 5 when it didn't, 4 when something got slower

Real users and CI
  field crux (--origin URL | --url URL) [--form-factor phone|desktop|tablet|all] [--history
             [--weeks N] [--deploy DATE]] [--key-env CRUX_API_KEY] [--audit DIR --save NAME]
                                 Chrome UX Report: p75 INP, LCP and CLS now, or week by week
  field compare (--before FILE --after FILE | --data FILE --split-at DATE)
             [--metric INP] [--by page|target|deviceType] [--audit DIR --save NAME]
                                 Real-user p75 before and after a deploy, with confidence intervals
  ci       --app DIR --scenario FILE --dev "CMD with {port}" [--dev-cwd DIR] [--paths GLOB,...]
           [--profiles mobile,desktop] [--max-pairs N] [--tool-ref REF] [--fail-on slower|no-gain|none]
           [--out FILE] [--force]
                                 Write a GitHub Actions workflow that benchmarks every pull request

Report
  changes  add --audit DIR --title T --status kept|reverted|proposed [--component C] [--file F]
               [--skill S] [--rule R] [--safety auto|ask|suggest] [--measure NAME] [--proof BENCH]
               [--commit SHA] [--reason TEXT] [--diff-file FILE] [--gates typecheck=pass,lint=pass,tests=pass]
  changes  list --audit DIR
  report   --audit DIR [--final NAME] [--bench NAME]
                                 Write DIR/report.html and DIR/report.md

Exit codes: 0 ok, 1 error, 3 behavior changed (compare), 4 slower (bench --target, --fail-on slower),
5 no gain (bench --target, --fail-on no-gain).`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const rawKey = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    let value;
    if (eq !== -1) value = arg.slice(eq + 1);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) value = true;
    else value = argv[++i];
    // A repeated flag (--scenario a.json --scenario b.json) collects its values.
    if (flags[key] !== undefined && value !== true && flags[key] !== true) flags[key] = [].concat(flags[key], value);
    else flags[key] = value;
  }
  return { positional, flags };
}

function gitInfo(dir) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
    return { sha, dirty };
  } catch {
    return { sha: null, dirty: false };
  }
}

function number(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function need(flags, key, hint) {
  if (!flags[key] || flags[key] === true) throw new Error(`Missing --${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}${hint ? ` (${hint})` : ''}`);
  return flags[key];
}

function loadConfig(flags) {
  const audit = flags.audit ? resolve(flags.audit) : null;
  const file = flags.config ? resolve(flags.config) : audit ? join(audit, 'config.json') : null;
  const config = file && existsSync(file) ? readJson(file) : {};
  const appRoot = resolve(flags.root || config.appRoot || process.cwd());
  return {
    ...config,
    audit,
    appRoot,
    repoRoot: resolve(flags.repoRoot || config.repoRoot || appRoot),
    scope: (flags.scope ? list(flags.scope).map((dir) => resolve(appRoot, dir)) : config.scope) || [],
    url: flags.url || config.url,
  };
}

function readCookies(file) {
  if (!file) return undefined;
  const data = readJson(resolve(file));
  return Array.isArray(data) ? data : data.cookies;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || command === 'help' || flags.help) {
    console.log(HELP);
    return 0;
  }
  const out = (text) => process.stdout.write(`${text}\n`);

  switch (command) {
    case 'doctor': {
      const { findChrome, launchChrome } = await import('./lib/chrome.mjs');
      const major = Number(process.versions.node.split('.')[0]);
      out(`Node ${process.versions.node} ${major >= 18 ? 'ok' : '(needs 18 or newer)'}`);
      const chrome = findChrome();
      if (!chrome) {
        out('Chrome: not found. Install Google Chrome or set CHROME_PATH.');
        return 1;
      }
      out(`Chrome: ${chrome}`);
      try {
        const browser = await launchChrome({ executablePath: chrome });
        out(`Started ${browser.version.product} headless over the DevTools pipe: ok`);
        await browser.close();
        const chromeMajor = Number((/\/(\d+)\./.exec(browser.version.product) || [])[1]);
        if (chromeMajor && chromeMajor < 123) out(`Chrome ${chromeMajor} works for render counts; the timing benchmark needs 123 or newer for long-frame data.`);
      } catch (error) {
        out(`Could not start Chrome: ${error.message}`);
        out('In a sandboxed shell, Chrome often needs to run outside the sandbox (it creates a profile socket).');
        return 1;
      }
      return 0;
    }

    case 'detect': {
      const { detect, formatDetect } = await import('./lib/detect.mjs');
      const result = detect(resolve(flags.root || process.cwd()));
      out(flags.json ? JSON.stringify(result, null, 2) : formatDetect(result));
      return 0;
    }

    case 'inventory': {
      const { inventory, formatInventory } = await import('./lib/inventory.mjs');
      const root = resolve(flags.root || process.cwd());
      const result = inventory(root, { dirs: list(flags.dirs).map((dir) => resolve(root, dir)), depth: number(flags.depth, undefined) });
      out(flags.json ? JSON.stringify(result, null, 2) : formatInventory(result, { top: number(flags.top, 12) }));
      return 0;
    }

    case 'init': {
      const audit = resolve(need(flags, 'audit', 'where to keep this audit'));
      const { detect } = await import('./lib/detect.mjs');
      const appRoot = resolve(need(flags, 'root', 'the app directory with package.json'));
      const detected = detect(appRoot);
      const previous = existsSync(join(audit, 'config.json')) ? readJson(join(audit, 'config.json')) : {};
      const config = {
        ...previous,
        version: 1,
        appRoot,
        repoRoot: resolve(flags.repoRoot || detected.repoRoot || appRoot),
        url: flags.url || previous.url || detected.url,
        devCommand: flags.dev || previous.devCommand || detected.devCommand,
        scope: flags.scope ? list(flags.scope).map((dir) => resolve(appRoot, dir)) : previous.scope || [],
        runs: number(flags.runs, previous.runs ?? 3),
        warmup: number(flags.warmup, previous.warmup ?? 1),
        cpu: number(flags.cpu, previous.cpu ?? 4),
        viewport: flags.viewport || previous.viewport || '1280x800',
        ignoreSelectors: flags.ignoreSelectors ? list(flags.ignoreSelectors) : previous.ignoreSelectors || [],
        ignoreRequests: flags.ignoreRequests ? list(flags.ignoreRequests) : previous.ignoreRequests || [],
        policy: flags.policy || previous.policy || 'auto',
        branch: flags.branch || previous.branch || null,
        createdAt: previous.createdAt || new Date().toISOString(),
        detected,
      };
      mkdirSync(audit, { recursive: true });
      writeJson(join(audit, 'config.json'), config);
      out(`Wrote ${join(audit, 'config.json')}`);
      out(JSON.stringify({ appRoot: config.appRoot, url: config.url, scope: config.scope, runs: config.runs, cpu: config.cpu }, null, 2));
      return 0;
    }

    case 'wait': {
      const url = need(flags, 'url');
      const timeout = number(flags.timeout, 180) * 1000;
      const started = Date.now();
      let last = '';
      while (Date.now() - started < timeout) {
        try {
          const response = await fetch(url, { redirect: 'manual' });
          if (response.status < 500) {
            out(`${url} answered ${response.status} after ${((Date.now() - started) / 1000).toFixed(1)} s`);
            return 0;
          }
          last = `HTTP ${response.status}`;
        } catch (error) {
          last = error.cause ? error.cause.code || error.cause.message : error.message;
        }
        await new Promise((done) => setTimeout(done, 1000));
      }
      out(`${url} did not answer within ${timeout / 1000} s (last: ${last})`);
      return 1;
    }

    case 'triage': {
      const { bench } = await import('./lib/bench.mjs');
      const { formatTriage, triageOf } = await import('./lib/triage.mjs');
      const { loadScenario } = await import('./lib/scenario.mjs');
      const config = loadConfig(flags);
      if (!config.audit) throw new Error('Missing --audit (the folder that keeps the audit)');
      const files = list(flags.scenario);
      if (!files.length) throw new Error('Missing --scenario (one or more scenario files)');
      const scenarios = files.map((file) => loadScenario(resolve(file)));
      const url = typeof flags.url === 'string' ? flags.url : config.url;
      if (!url) throw new Error('Missing --url (the running app, or the address --cmd will serve it on)');
      const cwd = typeof flags.cwd === 'string' ? resolve(flags.cwd) : (config.detected && config.detected.devCwd) || config.appRoot;
      const info = gitInfo(cwd);
      const label = typeof flags.label === 'string' ? flags.label : 'triage';
      if (!/^[\w.-]+$/.test(label)) throw new Error('--label may only contain letters, digits, ".", "_" and "-"');
      const result = await bench({
        label,
        outDir: join(config.audit, 'bench', label),
        scenarios,
        profiles: list(flags.profiles || 'mobile,desktop'),
        a: { label: info.dirty ? 'working tree' : 'current code', url, command: typeof flags.cmd === 'string' ? flags.cmd : null, cwd, sha: info.sha },
        b: null,
        kind: 'triage',
        pairs: number(flags.runs, 6),
        warmup: number(flags.warmup, 1),
        replay: !flags.noReplay,
        trace: !!flags.trace,
        cpuMobile: flags.cpuMobile ? number(flags.cpuMobile, null) : null,
        quietMs: number(flags.quiet, config.quietMs ?? 500),
        maxSettleMs: number(flags.maxSettle, config.maxSettleMs ?? 10000),
        cookies: readCookies(flags.cookies || config.cookies),
        headers: config.headers,
        ignoreRequests: config.ignoreRequests,
        headless: !flags.headed,
        chromeArgs: flags.disableCors ? ['--disable-web-security'] : [],
        serverTimeoutS: number(flags.serverTimeout, 240),
      });
      const triage = triageOf(result);
      // The default label is the audit's triage, which ranks fixes and leads the report; others (a
      // production check, say) are kept beside it.
      const file = join(config.audit, label === 'triage' ? 'triage.json' : `triage-${label}.json`);
      writeJson(file, triage);
      out(flags.json ? JSON.stringify(triage, null, 2) : formatTriage(triage));
      out(`\nSaved ${file} (raw runs in bench/${label}/)${label === 'triage' ? '' : '; the audit\'s triage.json is unchanged'}`);
      return 0;
    }

    case 'inspect': {
      const { inspect, formatInspect } = await import('./lib/inspect.mjs');
      const config = loadConfig(flags);
      const url = need(flags, 'url');
      const viewport = parseViewport(flags.viewport || config.viewport);
      const result = await inspect({
        url,
        ...viewport,
        profile: typeof flags.profile === 'string' ? flags.profile : undefined,
        headless: !flags.headed,
        appRoot: config.appRoot,
        repoRoot: config.repoRoot,
        cookies: readCookies(flags.cookies || config.cookies),
        headers: config.headers,
      });
      out(flags.json ? JSON.stringify(result, null, 2) : formatInspect(result, { appRoot: config.appRoot }));
      return 0;
    }

    case 'measure': {
      const { measure } = await import('./lib/measure.mjs');
      const { loadScenario } = await import('./lib/scenario.mjs');
      const config = loadConfig(flags);
      if (!config.audit) throw new Error('Missing --audit');
      const scenario = loadScenario(resolve(need(flags, 'scenario', 'a scenario JSON file')));
      const label = need(flags, 'label', 'e.g. baseline or after-1');
      if (!/^[\w.-]+$/.test(label)) throw new Error('--label may only contain letters, digits, ".", "_" and "-"');
      const scenarioDir = join(config.audit, 'scenarios');
      mkdirSync(scenarioDir, { recursive: true });
      const keep = join(scenarioDir, `${scenario.name}.json`);
      if (resolve(scenario.file) !== keep) copyFileSync(scenario.file, keep);
      const viewport = parseViewport(scenario.viewport || flags.viewport || config.viewport);
      const outDir = join(config.audit, 'runs', label, scenario.name);
      const meta = await measure({
        scenario,
        outDir,
        baseUrl: flags.url || config.url,
        runs: number(flags.runs, config.runs ?? 3),
        warmup: number(flags.warmup, config.warmup ?? 1),
        cpu: number(flags.cpu, config.cpu ?? 1),
        headless: !flags.headed,
        ...viewport,
        appRoot: config.appRoot,
        repoRoot: config.repoRoot,
        screenshots: flags.screenshots || 'first',
        ignoreSelectors: config.ignoreSelectors,
        ignoreRequests: config.ignoreRequests,
        cookies: readCookies(flags.cookies || config.cookies),
        headers: config.headers,
        quietMs: number(flags.quiet, config.quietMs ?? 500),
        maxSettleMs: number(flags.maxSettle, config.maxSettleMs ?? 10000),
      });
      out(`Saved ${meta.runs} run(s) of "${meta.scenario}" to ${outDir}`);
      return 0;
    }

    case 'analyze': {
      const { analyzeLabel, formatAnalysis } = await import('./lib/analyze.mjs');
      const config = loadConfig(flags);
      if (!config.audit) throw new Error('Missing --audit');
      const label = flags.label || 'baseline';
      const results = analyzeLabel(config, label, { scenario: flags.scenario });
      if (flags.json) out(JSON.stringify(results, null, 2));
      else for (const result of results) out(formatAnalysis(result, { top: number(flags.top, 8), appRoot: config.appRoot }));
      return 0;
    }

    case 'compare': {
      const { compareLabels, formatCompare } = await import('./lib/compare.mjs');
      const config = loadConfig(flags);
      if (!config.audit) throw new Error('Missing --audit');
      const result = compareLabels(config, {
        base: flags.base || 'baseline',
        after: need(flags, 'after', 'the label you just measured'),
        prev: flags.prev,
        allowDom: !!flags.allowDom,
      });
      out(flags.json ? JSON.stringify(result, null, 2) : formatCompare(result));
      return result.exitCode;
    }

    case 'changes': {
      const { addChange, formatChanges } = await import('./lib/changes.mjs');
      const config = loadConfig(flags);
      if (!config.audit) throw new Error('Missing --audit');
      const action = positional[0] || 'list';
      if (action === 'add') {
        const entry = addChange(config.audit, flags);
        out(`Recorded change #${entry.id}: ${entry.title} (${entry.status})`);
      } else {
        out(formatChanges(config.audit));
      }
      return 0;
    }

    case 'backup': {
      const { backup } = await import('./lib/backup.mjs');
      const config = loadConfig(flags);
      if (!config.audit) throw new Error('Missing --audit');
      const label = need(flags, 'label', 'e.g. fix-1');
      if (!positional.length) throw new Error('List the files the fix will edit or create');
      const added = backup(config.audit, label, config.repoRoot, positional);
      for (const entry of added) out(`${entry.existed ? 'saved' : 'noted (new file)'} ${entry.path}`);
      if (!added.length) out('Already saved; nothing new.');
      return 0;
    }

    case 'restore': {
      const { restore } = await import('./lib/backup.mjs');
      const config = loadConfig(flags);
      if (!config.audit) throw new Error('Missing --audit');
      for (const line of restore(config.audit, need(flags, 'label', 'the backup label used before the fix'))) out(line);
      return 0;
    }

    case 'baseline': {
      const { prepareBaseline, removeBaseline, resetBaseline, syncBaseline } = await import('./lib/baseline.mjs');
      const audit = flags.audit ? resolve(flags.audit) : null;
      const saved = audit ? readJson(join(audit, 'baseline.json'), null) : null;
      if (flags.remove) {
        const dir = typeof flags.dir === 'string' ? resolve(flags.dir) : saved && saved.dir;
        if (!dir) throw new Error('Pass --dir, or --audit of an audit that has a baseline.json');
        removeBaseline({ repoRoot: (saved && saved.repo) || resolve(flags.root || process.cwd()), dir });
        out(`Removed the baseline checkout ${dir}`);
        return 0;
      }
      if (flags.sync || flags.reset) {
        if (!saved) throw new Error('--sync and --reset need --audit of an audit with a baseline copy; create it with baseline --ref first');
        if (!existsSync(saved.dir)) throw new Error(`The baseline copy ${saved.dir} is gone; create it again with baseline --ref`);
        if (flags.reset) {
          resetBaseline(saved);
          writeJson(join(audit, 'baseline.json'), { ...saved, synced: [], without: null, syncedAt: null });
          out(`Baseline copy back at ${saved.ref} (${saved.sha.slice(0, 10)}): ${saved.dir}`);
          return 0;
        }
        const without = typeof flags.without === 'string' ? flags.without : null;
        const done = syncBaseline(saved, { audit, without });
        writeJson(join(audit, 'baseline.json'), { ...saved, synced: done.synced, without, syncedAt: new Date().toISOString() });
        out(`Baseline copy now matches your working tree${without ? ` without ${without}` : ''}: ${done.copied} file(s) copied, ${done.removed} removed${without ? `, ${done.restored.length} as they were before ${without}: ${done.restored.join(', ') || 'none'}` : ''}.`);
        if (without && !done.restored.length) out(`warning: the backup ${without} lists no files in this repository, so both sides are the same code`);
        if (done.dependenciesChanged) out('warning: dependency files changed since the copy\'s commit; run baseline --ref HEAD to reinstall the copy\'s dependencies');
        return 0;
      }
      const config = loadConfig(flags);
      const reuse = typeof flags.dir !== 'string' && saved && existsSync(saved.dir);
      const info = await prepareBaseline({
        repoRoot: config.appRoot,
        appRoot: config.appRoot,
        ref: typeof flags.ref === 'string' ? flags.ref : 'HEAD',
        dir: typeof flags.dir === 'string' ? flags.dir : reuse ? saved.dir : undefined,
        install: typeof flags.install === 'string' ? flags.install : undefined,
        setup: typeof flags.setup === 'string' ? flags.setup : undefined,
        linkEnv: !flags.noEnv,
        logFile: audit ? join(audit, 'baseline-install.log') : undefined,
        synced: reuse ? saved.synced || [] : [],
      });
      if (audit) {
        mkdirSync(audit, { recursive: true });
        writeJson(join(audit, 'baseline.json'), info);
      }
      out(`Baseline ${info.ref} (${info.sha.slice(0, 10)}) ${info.moved ? `moved there from ${info.moved.slice(0, 10)}` : info.reused ? 'already checked out' : 'checked out'} at ${info.dir}`);
      out(`App folder in the copy: ${info.appDir}`);
      if (info.envLinks.length) out(`Linked env files (not read): ${info.envLinks.join(', ')}`);
      out(info.install ? `Dependencies: ${info.installed ? `installed with "${info.install}"` : 'already installed'} (log: ${info.log})` : 'Dependencies: not installed (--install none)');
      return 0;
    }

    case 'bench': {
      const { bench, benchExitCode, benchMarkdown, formatBench, isTarget } = await import('./lib/bench.mjs');
      const { loadScenario, stepLabel } = await import('./lib/scenario.mjs');
      const { readTriage } = await import('./lib/triage.mjs');
      const config = loadConfig(flags);
      if (!config.audit) throw new Error('Missing --audit (the folder that keeps the benchmark)');
      const files = list(flags.scenario);
      if (!files.length) throw new Error('Missing --scenario (one or more scenario files)');
      const scenarios = files.map((file) => loadScenario(resolve(file)));
      // The per-fix proof judges the steps the triage found slow, on the profiles where they were.
      const quick = !!flags.quick;
      const triage = readTriage(config.audit);
      const slowIn = (scenario) => ((triage && triage.scenarios[scenario.name]) || { steps: [] }).steps.filter((step) => step && step.slow);
      let target = list(flags.target);
      if (!target.length && quick && triage) target = [...new Set(scenarios.flatMap((scenario) => slowIn(scenario).map((step) => step.name)))];
      const stepsOf = (scenario) => [{ ...scenario.load, action: 'goto', url: scenario.url, name: scenario.load.name || 'load' }, ...scenario.steps].map((step, index) => ({ index, name: stepLabel(step, index) }));
      for (const wanted of target) {
        if (!scenarios.some((scenario) => stepsOf(scenario).some((step) => isTarget(step, [wanted])))) {
          throw new Error(`--target ${wanted} matches no step. Steps: ${stepsOf(scenarios[0]).map((step) => `${step.index} ${step.name}`).join(', ')}`);
        }
      }
      let profiles = list(flags.profiles);
      if (!profiles.length && quick && triage) profiles = [...new Set(scenarios.flatMap((scenario) => slowIn(scenario).filter((step) => !target.length || isTarget(step, target)).flatMap((step) => step.profiles)))];
      if (!profiles.length) profiles = quick ? ['mobile'] : ['mobile', 'desktop'];
      const label = typeof flags.label === 'string' ? flags.label : new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      if (!/^[\w.-]+$/.test(label)) throw new Error('--label may only contain letters, digits, ".", "_" and "-"');
      const saved = readJson(join(config.audit, 'baseline.json'), null);
      const devCwd = (config.detected && config.detected.devCwd) || config.appRoot;
      const sideOf = (key) => {
        const url = flags[key];
        if (!url || url === true) return null;
        const command = typeof flags[`${key}Cmd`] === 'string' ? flags[`${key}Cmd`] : null;
        let cwd = typeof flags[`${key}Cwd`] === 'string' ? resolve(flags[`${key}Cwd`]) : null;
        if (!cwd && key === 'a' && saved) {
          // The same folder inside the copy. The repository path is real, so the dev folder's must be.
          let real = devCwd;
          try {
            real = realpathSync(devCwd);
          } catch {
            // keep it as given
          }
          const inside = relative(saved.repo, real);
          if (inside.startsWith('..')) throw new Error(`The dev folder ${devCwd} isn't inside ${saved.repo}; pass --a-cwd with the folder inside the baseline copy`);
          cwd = config.detected ? join(saved.dir, inside) : saved.appDir;
        }
        if (!cwd) cwd = devCwd;
        const info = key === 'a' && saved && !flags.aCwd ? { sha: saved.sha, dirty: false } : gitInfo(cwd);
        // A runs the baseline copy unless --a-cwd points elsewhere; a synced copy isn't its commit.
        const usesCopy = key === 'a' && !!saved && !flags.aCwd;
        const synced = usesCopy && !!saved.syncedAt;
        const savedLabel = usesCopy ? (synced ? (saved.without ? `without ${saved.without}` : 'working tree copy') : `baseline ${saved.ref}`) : 'A';
        return {
          label: typeof flags[`${key}Label`] === 'string' ? flags[`${key}Label`] : key === 'a' ? savedLabel : info.dirty ? 'working tree' : 'candidate',
          url,
          command,
          cwd,
          ref: usesCopy && !synced ? saved.ref : null,
          sha: synced ? null : info.sha,
        };
      };
      const a = sideOf('a');
      if (!a) throw new Error('Missing --a (the URL of the baseline app; add --a-cmd to start it)');
      const b = sideOf('b');
      if (target.length && !b) throw new Error('--target and --quick compare two sides: pass --b too');
      const outDir = join(config.audit, 'bench', label);
      const result = await bench({
        label,
        outDir,
        scenarios,
        profiles,
        a,
        b,
        kind: quick ? 'proof' : 'full',
        target: target.length ? target : null,
        pairs: flags.pairs && flags.pairs !== true && flags.pairs !== 'auto' ? number(flags.pairs, 10) : quick ? 8 : 'auto',
        minPairs: number(flags.minPairs, 8),
        maxPairs: number(flags.maxPairs, 20),
        aaPairs: quick ? number(flags.aa, 0) : number(flags.aa, 6),
        warmup: number(flags.warmup, 1),
        replay: !flags.noReplay,
        trace: quick ? !!flags.trace : !flags.noTrace,
        // A per-fix proof runs at the slowdown the triage calibrated, like the estimates it checks.
        cpuMobile: flags.cpuMobile ? number(flags.cpuMobile, null) : quick && triage && triage.calibration ? triage.calibration.rate : null,
        quietMs: number(flags.quiet, config.quietMs ?? 500),
        maxSettleMs: number(flags.maxSettle, config.maxSettleMs ?? 10000),
        cookies: readCookies(flags.cookies || config.cookies),
        headers: config.headers,
        ignoreRequests: config.ignoreRequests,
        headless: !flags.headed,
        chromeArgs: flags.disableCors ? ['--disable-web-security'] : [],
        serverTimeoutS: number(flags.serverTimeout, 240),
      });
      out(flags.json ? JSON.stringify(result, null, 2) : formatBench(result));
      if (typeof flags.markdown === 'string') {
        writeFileSync(flags.markdown, `${benchMarkdown(result)}\n`, { flag: 'a' });
      }
      out(`\nSaved to ${outDir} (bench.json${result.results.some((item) => item.traces.a) ? ', Chrome traces in traces/' : ''})`);
      if (result.target && typeof flags.failOn !== 'string') return result.target.exitCode;
      return benchExitCode(result, typeof flags.failOn === 'string' ? flags.failOn : null);
    }

    case 'field': {
      const field = await import('./lib/field.mjs');
      const action = positional[0];
      const audit = flags.audit ? resolve(flags.audit) : null;
      const save = (kind, data) => {
        if (typeof flags.save !== 'string') return;
        if (!audit) throw new Error('--save needs --audit');
        const file = join(audit, 'field', `${flags.save}.json`);
        writeJson(file, { kind, createdAt: new Date().toISOString(), ...data });
        out(`Saved ${file}`);
      };
      if (action === 'crux') {
        const keyEnv = typeof flags.keyEnv === 'string' ? flags.keyEnv : 'CRUX_API_KEY';
        const history = !!flags.history || typeof flags.deploy === 'string';
        const result = await field.queryCrux({
          origin: typeof flags.origin === 'string' ? flags.origin : undefined,
          url: typeof flags.url === 'string' ? flags.url : undefined,
          formFactor: typeof flags.formFactor === 'string' ? flags.formFactor : undefined,
          history,
          weeks: number(flags.weeks, 25),
          key: process.env[keyEnv],
        });
        const deploy = typeof flags.deploy === 'string' ? flags.deploy : undefined;
        out(flags.json ? JSON.stringify(result, null, 2) : field.formatCrux(result, { history, deploy }));
        save('crux', { history, deploy: deploy || null, split: history && deploy ? field.aroundDeploy(result, deploy) : null, result });
        return 0;
      }
      if (action === 'compare') {
        let before;
        let after;
        if (typeof flags.data === 'string') {
          ({ before, after } = field.splitRecords(field.readRecords(resolve(flags.data)), {
            at: typeof flags.splitAt === 'string' ? flags.splitAt : undefined,
            beforeRelease: typeof flags.beforeRelease === 'string' ? flags.beforeRelease : undefined,
            afterRelease: typeof flags.afterRelease === 'string' ? flags.afterRelease : undefined,
          }));
        } else {
          before = field.readRecords(resolve(need(flags, 'before', 'records from before the change')));
          after = field.readRecords(resolve(need(flags, 'after', 'records from after the change')));
        }
        const result = field.compareRecords(before, after, {
          metric: typeof flags.metric === 'string' ? flags.metric : 'INP',
          by: typeof flags.by === 'string' ? flags.by : null,
          minSamples: number(flags.minSamples, 50),
        });
        out(flags.json ? JSON.stringify(result, null, 2) : field.formatFieldCompare(result));
        save('compare', { result });
        return 0;
      }
      throw new Error('Use "field crux" or "field compare" (see help)');
    }

    case 'ci': {
      const { ciWorkflow } = await import('./lib/ci.mjs');
      const { detect } = await import('./lib/detect.mjs');
      const appRoot = resolve(need(flags, 'app', 'the app folder'));
      const detected = detect(appRoot);
      let top;
      try {
        top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: appRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        throw new Error(`${appRoot} isn't inside a git repository`);
      }
      const rootPkg = readJson(join(top, 'package.json'), {});
      const scenarios = list(flags.scenario);
      for (const file of scenarios) {
        if (!existsSync(resolve(file))) throw new Error(`Scenario not found: ${file}`);
      }
      let packageManager = typeof flags.pm === 'string' ? flags.pm : detected.packageManager;
      if (packageManager === 'yarn' && existsSync(join(top, '.yarnrc.yml'))) packageManager = 'yarn-berry';
      const yaml = ciWorkflow({
        app: relative(top, appRoot) || '.',
        scenarios: scenarios.map((file) => relative(top, resolve(file))),
        dev: need(flags, 'dev', 'the dev command with {port}, e.g. "pnpm dev -- --port {port}"'),
        devCwd: relative(top, typeof flags.devCwd === 'string' ? resolve(flags.devCwd) : detected.devCwd) || '.',
        packageManager,
        pnpmVersion: packageManager === 'pnpm' && !rootPkg.packageManager ? '10' : undefined,
        install: typeof flags.install === 'string' ? flags.install : undefined,
        profiles: typeof flags.profiles === 'string' ? flags.profiles : 'mobile,desktop',
        paths: list(flags.paths),
        toolRef: typeof flags.toolRef === 'string' ? flags.toolRef : 'main',
        failOn: typeof flags.failOn === 'string' ? flags.failOn : 'slower',
        maxPairs: flags.maxPairs ? number(flags.maxPairs, undefined) : undefined,
        replay: !flags.noReplay,
      });
      const file = resolve(typeof flags.out === 'string' ? flags.out : join(top, '.github', 'workflows', 'render-benchmark.yml'));
      if (existsSync(file) && !flags.force) throw new Error(`${file} exists; pass --force to replace it`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, yaml);
      out(`Wrote ${file}`);
      out('Commit it together with the scenario files. Each pull request then gets a timing comparison in its job summary.');
      return 0;
    }

    case 'report': {
      const { writeReport } = await import('./lib/report.mjs');
      const config = loadConfig(flags);
      if (!config.audit) throw new Error('Missing --audit');
      const { html, markdown } = writeReport(config, { final: flags.final, bench: typeof flags.bench === 'string' ? flags.bench : undefined });
      out(`Wrote ${html}\nWrote ${markdown}`);
      return 0;
    }

    case 'labels': {
      const config = loadConfig(flags);
      const dir = join(config.audit || '.', 'runs');
      out(existsSync(dir) ? readdirSync(dir).join('\n') : '(no runs yet)');
      return 0;
    }

    default:
      out(`Unknown command "${command}".\n\n${HELP}`);
      return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (error) => {
    process.stderr.write(`render-audit ${basename(process.argv[2] || '')}: ${error.message}\n`);
    if (process.env.RENDER_AUDIT_DEBUG) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  },
);

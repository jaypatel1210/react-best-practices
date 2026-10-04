#!/usr/bin/env node
// render-audit: measure which React components re-render during a scripted user flow, rank the
// causes, verify that a refactor kept behavior identical, and report before/after.
// No dependencies: Node 18+ and a local Chrome or Chromium.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { list, parseViewport, readJson, writeJson } from './lib/util.mjs';

const HELP = `render-audit — find and verify React re-render fixes

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

Measure
  inspect  --url URL [--root DIR]
                                 React status, renders on load, interactive elements for scenarios
  measure  --audit DIR --scenario FILE --label NAME [--runs N] [--warmup N] [--cpu N] [--headed]
                                 Replay the scenario and record every render (writes DIR/runs/NAME/)
  analyze  --audit DIR [--label NAME] [--top N] [--json]
                                 Rank render hotspots inside the scope and map them to fixes
  compare  --audit DIR --after NAME [--base baseline] [--prev NAME] [--allow-dom] [--json]
                                 Check behavior is unchanged and renders went down

Fix loop
  backup   --audit DIR --label fix-N FILE...
                                 Save files before a fix edits or creates them
  restore  --audit DIR --label fix-N
                                 Put them back exactly (and delete files the fix created)

Report
  changes  add --audit DIR --title T --status kept|reverted|proposed [--component C] [--file F]
               [--skill S] [--rule R] [--safety auto|ask|suggest] [--measure NAME] [--commit SHA]
               [--reason TEXT] [--diff-file FILE] [--gates typecheck=pass,lint=pass,tests=pass]
  changes  list --audit DIR
  report   --audit DIR [--final NAME]
                                 Write DIR/report.html and DIR/report.md

Exit codes: 0 ok, 1 error, 3 behavior changed, 4 renders regressed, 5 no improvement.`;

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
    if (eq !== -1) flags[key] = arg.slice(eq + 1);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) flags[key] = true;
    else flags[key] = argv[++i];
  }
  return { positional, flags };
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

    case 'inspect': {
      const { inspect, formatInspect } = await import('./lib/inspect.mjs');
      const config = loadConfig(flags);
      const url = need(flags, 'url');
      const viewport = parseViewport(flags.viewport || config.viewport);
      const result = await inspect({
        url,
        ...viewport,
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

    case 'report': {
      const { writeReport } = await import('./lib/report.mjs');
      const config = loadConfig(flags);
      if (!config.audit) throw new Error('Missing --audit');
      const { html, markdown } = writeReport(config, { final: flags.final });
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

// End-to-end check in real Chrome against the lab fixture. Needs Chrome and a free port 5199,
// so it isn't part of the unit suite. Run it with:  node plugins/react-render-audit/tests/e2e.mjs
//
// 1. Ground truth: for every lab variant (with and without StrictMode), the tracker's render
//    count for each component in each step must equal the lab's own commit counters.
// 2. The CLI pipeline: measure the broken, fixed and wrong variants, then analyze, compare and
//    report. The fixed variant must pass the equivalence check with fewer renders; the wrong one
//    (a "fix" that shows fewer suggestions) must fail it.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../skills/optimize-renders/scripts/lib/chrome.mjs';
import { TRACKER_PATH } from '../skills/optimize-renders/scripts/lib/measure.mjs';
import { NetworkLog, evaluate, navigate, openPage, performAction, settle, sleep } from '../skills/optimize-renders/scripts/lib/page.mjs';
import { loadScenario } from '../skills/optimize-renders/scripts/lib/scenario.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const labDir = join(here, '..', 'fixtures', 'lab');
const cli = join(here, '..', 'skills', 'optimize-renders', 'scripts', 'render-audit.mjs');
const LAB = 'http://127.0.0.1:5199';
const scenario = loadScenario(join(labDir, 'scenarios', 'store.json'));

let failures = 0;
function check(condition, message) {
  if (condition) console.log(`  ok   ${message}`);
  else {
    failures++;
    console.log(`  FAIL ${message}`);
  }
}

async function labUp() {
  try {
    return (await fetch(LAB)).ok;
  } catch {
    return false;
  }
}

async function startLab() {
  if (await labUp()) return null;
  const server = spawn(process.execPath, [join(repo, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', join(labDir, 'vite.config.mjs')], {
    cwd: repo,
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    if (await labUp()) return server;
    await sleep(200);
  }
  server.kill();
  throw new Error('The lab dev server did not start on port 5199');
}

async function groundTruth(browser, variant, strict) {
  const tracker = readFileSync(TRACKER_PATH, 'utf8');
  const { page, close } = await openPage(browser, { tracker });
  const network = new NetworkLog(page);
  const mismatches = [];
  let before = {};
  const compareStep = async (label, next) => {
    const stats = await evaluate(page, `__RENDER_AUDIT__.endStep(${JSON.stringify(next)})`);
    const types = await evaluate(page, '__RENDER_AUDIT__.types()');
    const truth = await evaluate(page, 'JSON.parse(JSON.stringify(window.__truth || {}))');
    const counted = {};
    const mounts = {};
    for (const row of stats.components) {
      const name = types[row.id].name;
      counted[name] = (counted[name] || 0) + row.renders;
      mounts[name] = (mounts[name] || 0) + row.mounts;
    }
    const names = new Set([...Object.keys(counted), ...Object.keys(truth)]);
    for (const name of names) {
      const delta = (truth[name] || 0) - (before[name] || 0);
      // StrictMode replays mount effects once more, so the counter sees each mount twice.
      const expected = (counted[name] || 0) + (strict ? mounts[name] || 0 : 0);
      if (delta !== expected) mismatches.push(`${label}: ${name} tracker=${counted[name] || 0} truth=${delta}`);
    }
    before = truth;
    return stats;
  };
  try {
    await navigate(page, `${LAB}/?variant=${variant}${strict ? '&strict=1' : ''}`);
    await settle(page, network);
    let label = 'load';
    for (const step of scenario.steps) {
      await compareStep(label, step.name);
      await performAction(page, step);
      await settle(page, network);
      label = step.name;
    }
    await compareStep(label, undefined);
  } finally {
    await close();
  }
  return mismatches;
}

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: repo, encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

async function main() {
  const server = await startLab();
  const audit = mkdtempSync(join(tmpdir(), 'render-audit-e2e-'));
  try {
    console.log('Ground truth (tracker vs. the lab components’ own commit counters)');
    const browser = await launchChrome();
    try {
      for (const variant of ['broken', 'fixed', 'wrong']) {
        for (const strict of [false, true]) {
          const mismatches = await groundTruth(browser, variant, strict);
          check(mismatches.length === 0, `${variant}${strict ? ' + StrictMode' : ''}: every component's renders match${mismatches.length ? `\n       ${mismatches.join('\n       ')}` : ''}`);
        }
      }
    } finally {
      await browser.close();
    }

    console.log('CLI pipeline');
    const scenarioFile = join(labDir, 'scenarios', 'store.json');
    let r = run(['init', '--audit', audit, '--root', labDir, '--url', `${LAB}/`, '--scope', 'src', '--runs', '2', '--cpu', '1']);
    check(r.code === 0, `init (${r.code})${r.code ? `\n${r.out}` : ''}`);
    for (const [label, variant] of [['baseline', 'broken'], ['after-1', 'fixed'], ['after-wrong', 'wrong']]) {
      r = run(['measure', '--audit', audit, '--scenario', scenarioFile, '--label', label, '--url', `${LAB}/?variant=${variant}`]);
      check(r.code === 0, `measure ${label} (${variant})${r.code ? `\n${r.out}` : ''}`);
    }
    r = run(['analyze', '--audit', audit, '--label', 'baseline']);
    check(r.code === 0, 'analyze baseline');
    for (const expected of ['Store', 'ProductCard', 'Chip', 'CartTicker', 'CartContext']) {
      check(r.out.includes(expected), `analysis mentions ${expected}`);
    }
    if (process.env.VERBOSE) console.log(r.out);

    r = run(['compare', '--audit', audit, '--after', 'after-1']);
    check(r.code === 0, `compare after-1 passes (exit ${r.code})`);
    check(/PASS/.test(r.out), 'compare after-1 says PASS');
    if (process.env.VERBOSE || r.code !== 0) console.log(r.out);

    r = run(['compare', '--audit', audit, '--after', 'after-wrong']);
    check(r.code === 3, `compare after-wrong fails the equivalence check (exit ${r.code})`);
    check(/Suggestions|Road Racer|Rain Cap/.test(r.out), 'the failure shows what changed');
    if (process.env.VERBOSE || r.code !== 3) console.log(r.out);

    r = run(['changes', 'add', '--audit', audit, '--title', 'Move search text into SearchArea', '--status', 'kept', '--component', 'Store', '--file', join(labDir, 'src', 'broken.jsx'), '--skill', 'react-rerenders', '--rule', 'Move state down', '--safety', 'auto', '--measure', 'after-1', '--gates', 'typecheck=pass,lint=pass,tests=skip']);
    check(r.code === 0, 'changes add');
    r = run(['report', '--audit', audit, '--final', 'after-1']);
    check(r.code === 0 && existsSync(join(audit, 'report.html')) && existsSync(join(audit, 'report.md')), `report written${r.code ? `\n${r.out}` : ''}`);
    if (process.env.KEEP) console.log(`Audit kept at ${audit}`);
  } finally {
    if (!process.env.KEEP) rmSync(audit, { recursive: true, force: true });
    if (server) server.kill();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// End-to-end check in real Chrome against the lab fixture. Needs Chrome and free ports 5193-5199,
// so it isn't part of the unit suite. Run it with:  node plugins/react-render-audit/tests/e2e.mjs
// (SKIP_BENCH=1 skips the timing benchmark runs, the slowest part.)
//
// 1. Ground truth: for every lab variant (with and without StrictMode), the tracker's render
//    count for each component in each step must equal the lab's own commit counters.
// 2. The CLI pipeline: measure the broken, fixed and wrong variants, then analyze, compare and
//    report. The fixed variant must pass the equivalence check with fewer renders; the wrong one
//    (a "fix" that shows fewer suggestions) must fail it.
// 3. The timing collector: its interaction times must equal what Google's web-vitals library
//    reports for the same interactions.
// 4. Network replay: a second origin gets the first run's API answer, CORS included.
// 5. CPU calibration lands near the mid-tier phone target.
// 6. The real-user reporter sends INP with attribution, and `field compare` reads it.
// 7. Time first: triage finds the broken store's typing slow because of re-rendering, and the
//    fixed store's not slow; the analysis ranks fixes by the time they'd save and marks the cheap
//    ones as not worth fixing.
// 8. The benchmark: same code on two servers shows no meaningful change and no gain for a
//    targeted step; the quick per-fix proof keeps broken -> fixed; broken -> fixed is faster on
//    both profiles; fixed -> broken fails the per-fix proof; the report shows it.
// 9. `ci` writes a workflow and `inspect --profile mobile` emulates the phone.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from '../skills/optimize-renders/scripts/lib/chrome.mjs';
import { inPageSource } from '../skills/optimize-renders/scripts/lib/inpage.mjs';
import { NetworkLog, evaluate, navigate, openPage, performAction, settle, sleep } from '../skills/optimize-renders/scripts/lib/page.mjs';
import { MOBILE_TARGET_INDEX, calibrate } from '../skills/optimize-renders/scripts/lib/profiles.mjs';
import { NetworkReplay } from '../skills/optimize-renders/scripts/lib/replay.mjs';
import { loadScenario } from '../skills/optimize-renders/scripts/lib/scenario.mjs';
import { startServer } from '../skills/optimize-renders/scripts/lib/servers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const labDir = join(here, '..', 'fixtures', 'lab');
const cli = join(here, '..', 'skills', 'optimize-renders', 'scripts', 'render-audit.mjs');
const LAB = 'http://127.0.0.1:5199';
const scenarioFile = join(labDir, 'scenarios', 'store.json');
const scenario = loadScenario(scenarioFile);
const VITE = `node ${join(repo, 'node_modules', 'vite', 'bin', 'vite.js')} --config ${join(labDir, 'vite.config.mjs')} --port {port} --strictPort`;

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
  const { page, close } = await openPage(browser, { source: inPageSource('tracker') });
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

// The collector and web-vitals watch the same page; their slowest interaction must agree.
async function crossCheckWebVitals(browser) {
  const webVitals = readFileSync(join(repo, 'node_modules', 'web-vitals', 'dist', 'web-vitals.attribution.iife.js'), 'utf8');
  const listen = 'webVitals.onINP((metric) => { window.__webVitalsINP = metric.value; }, { reportAllChanges: true, durationThreshold: 16 });';
  const { page, close } = await openPage(browser, { source: `${inPageSource('vitals')}\n${webVitals}\n${listen}` });
  const network = new NetworkLog(page);
  try {
    await navigate(page, `${LAB}/?variant=broken&cost=150`);
    await settle(page, network, { quietMs: 300 });
    await evaluate(page, '__RA_VITALS__.end()');
    let ours = 0;
    let interactions = 0;
    for (const [i, step] of scenario.steps.entries()) {
      await evaluate(page, `__RA_VITALS__.begin(${i + 1}, ${JSON.stringify(step.name)})`);
      await performAction(page, step);
      await settle(page, network, { quietMs: 300 });
      const data = await evaluate(page, '__RA_VITALS__.end()');
      if (data.inp !== null) ours = Math.max(ours, data.inp);
      interactions += data.interactions.count;
    }
    const theirs = await evaluate(page, 'window.__webVitalsINP ?? null');
    return { ours, theirs, interactions };
  } finally {
    await close();
  }
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  return { code: result.status, out: `${result.stdout}${result.stderr}`, stdout: result.stdout };
}

async function main() {
  const server = await startLab();
  const audit = mkdtempSync(join(tmpdir(), 'render-audit-e2e-'));
  const work = mkdtempSync(join(tmpdir(), 'render-audit-e2e-work-'));
  const cleanups = [];
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

      console.log('Timing collector vs. web-vitals');
      const vitals = await crossCheckWebVitals(browser);
      check(vitals.interactions >= 3, `the collector saw the interactions (${vitals.interactions})`);
      check(vitals.ours > 16 && vitals.ours === vitals.theirs, `slowest interaction: collector ${vitals.ours} ms, web-vitals INP ${vitals.theirs} ms`);

      console.log('Network replay');
      let hits = 0;
      const api = createServer((request, response) => {
        hits++;
        // Only the lab's usual origin may read this answer.
        response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': LAB });
        response.end(JSON.stringify({ count: hits }));
      });
      await new Promise((resolve) => api.listen(5196, '127.0.0.1', resolve));
      cleanups.push(() => new Promise((resolve) => api.close(resolve)));
      const second = await startServer({ name: 'second lab', command: VITE, cwd: repo, url: 'http://127.0.0.1:5193/', logFile: join(work, 'second-lab.log') });
      cleanups.push(() => second.stop());
      check(!!second.pid, 'a second dev server started from a {port} command');
      const replay = new NetworkReplay();
      const answerOn = async (origin) => {
        const { page, close } = await openPage(browser, { source: inPageSource('vitals') });
        const counters = await replay.attach(page, { appOrigin: origin });
        try {
          await navigate(page, `${origin}/?variant=fixed&api=${encodeURIComponent('http://127.0.0.1:5196/count')}`);
          let text = '';
          for (let i = 0; i < 50 && !/answer: (\d+|failed)/.test(text); i++) {
            await sleep(100);
            text = await evaluate(page, 'document.querySelector("[data-testid=api-answer]")?.textContent || ""');
          }
          return { text, counters };
        } finally {
          await close();
        }
      };
      const recorded = await answerOn(LAB);
      replay.freeze();
      const replayed = await answerOn('http://127.0.0.1:5193');
      check(recorded.text === 'API answer: 1' && recorded.counters.recorded === 1, `the first run recorded the API answer (${recorded.text})`);
      check(replayed.text === 'API answer: 1' && replayed.counters.served === 1 && hits === 1, `another origin got the recorded answer, CORS rewritten, without hitting the API (${replayed.text}, ${hits} hit)`);

      console.log('CPU calibration');
      const calibration = await calibrate(browser);
      check(calibration.rate >= 1 && calibration.rate <= 20, `slowdown ${calibration.rate}× for BenchmarkIndex ${calibration.hostIndex}`);
      check(Math.abs(calibration.throttledIndex - MOBILE_TARGET_INDEX) / MOBILE_TARGET_INDEX < 0.2 || calibration.rate === 1, `throttled index ${calibration.throttledIndex} is within 20% of the target ${Math.round(MOBILE_TARGET_INDEX)}`);

      console.log('Real-user reporter');
      await fetch(`${LAB}/__vitals`); // clear
      {
        const { page, close } = await openPage(browser, {});
        const network = new NetworkLog(page);
        try {
          await navigate(page, `${LAB}/?variant=broken&cost=200&rum=1&release=r1`);
          for (let i = 0; i < 50 && !(await evaluate(page, 'window.__rumReady === true')); i++) await sleep(100);
          await settle(page, network, { quietMs: 300 });
          await performAction(page, scenario.steps[1]);
          await settle(page, network, { quietMs: 300 });
          await navigate(page, 'about:blank');
        } finally {
          await close();
        }
      }
      let records = [];
      for (let i = 0; i < 30 && !records.some((record) => record.name === 'INP'); i++) {
        await sleep(100);
        records = records.concat(await (await fetch(`${LAB}/__vitals`)).json());
      }
      const inp = records.find((record) => record.name === 'INP');
      check(!!inp && inp.value > 0 && inp.interactionType === 'pointer' && inp.release === 'r1' && inp.page === '/', `the reporter sent INP with attribution (${inp ? `${inp.value} ms on ${inp.target}` : 'nothing'})`);
      check(records.some((record) => record.name === 'LCP'), 'and LCP');
      const before = join(work, 'before.jsonl');
      const after = join(work, 'after.jsonl');
      writeFileSync(before, Array.from({ length: 60 }, (_, i) => JSON.stringify({ ...inp, value: inp.value + 100 + i })).join('\n'));
      writeFileSync(after, Array.from({ length: 60 }, (_, i) => JSON.stringify({ ...inp, value: inp.value + i })).join('\n'));
      const field = run(['field', 'compare', '--before', before, '--after', after, '--by', 'page', '--audit', audit, '--save', 'rum']);
      check(field.code === 0 && /faster/.test(field.out) && existsSync(join(audit, 'field', 'rum.json')), `field compare reads the reporter's records${field.code ? `\n${field.out}` : ''}`);
    } finally {
      await browser.close();
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    }

    console.log('CLI pipeline');
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

    if (!process.env.SKIP_BENCH) {
      console.log('Time first');
      const typingStep = 'type "ra" in search';
      const triageArgs = ['--scenario', scenarioFile, '--profiles', 'mobile', '--cpu-mobile', '4', '--quiet', '250'];
      r = run(['triage', '--audit', audit, '--url', `${LAB}/?variant=broken&cost=500`, ...triageArgs]);
      const triage = existsSync(join(audit, 'triage.json')) ? JSON.parse(readFileSync(join(audit, 'triage.json'), 'utf8')) : null;
      const typing = triage ? triage.profiles[0].steps.find((step) => step.name === typingStep) : null;
      check(r.code === 0 && !!typing && triage.decision === 'renders' && typing.slow && typing.renderBound, `triage: typing in the broken store is slow because of re-rendering (${typing ? `${typing.reasons.join(', ')}; re-rendering ${typing.reactUpdates} of ${typing.mainThread} ms` : r.out.slice(-800)})`);
      if (process.env.VERBOSE) console.log(r.out);
      const fixedAudit = join(work, 'fixed-audit');
      r = run(['triage', '--audit', fixedAudit, '--url', `${LAB}/?variant=fixed&cost=500`, ...triageArgs]);
      const fixedTriage = existsSync(join(fixedAudit, 'triage.json')) ? JSON.parse(readFileSync(join(fixedAudit, 'triage.json'), 'utf8')) : null;
      const fixedTyping = fixedTriage ? fixedTriage.profiles[0].steps.find((step) => step.name === typingStep) : null;
      check(r.code === 0 && !!fixedTyping && !fixedTyping.slow, `triage: typing in the fixed store is not slow (${fixedTyping ? `${fixedTyping.response.median} ms` : r.out.slice(-800)})`);

      r = run(['measure', '--audit', audit, '--scenario', scenarioFile, '--label', 'timed', '--url', `${LAB}/?variant=broken&cost=500`, '--screenshots', 'none']);
      check(r.code === 0, `measure the broken store with render times${r.code ? `\n${r.out}` : ''}`);
      r = run(['analyze', '--audit', audit, '--label', 'timed', '--json']);
      const analysis = r.code === 0 ? JSON.parse(r.stdout)[0] : null;
      const inScope = analysis ? analysis.hotspots.filter((hotspot) => hotspot.inScope) : [];
      const worth = inScope.filter((hotspot) => hotspot.worth === true);
      const cheap = inScope.filter((hotspot) => hotspot.worth === false);
      const describe = (list) => list.map((hotspot) => `${hotspot.kind} ${hotspot.component} ${hotspot.saves ? hotspot.saves.ms : 0} ms`).join(', ');
      check(!!analysis && analysis.timed && worth.length > 0 && worth.every((hotspot) => hotspot.saves.ms >= 16.7) && ['cascade', 'memo-broken'].includes(inScope[0].kind), `analysis ranks by time saved in slow steps; worth fixing: ${describe(worth) || r.out.slice(-600)}`);
      check(cheap.some((hotspot) => hotspot.kind === 'component-in-render') && cheap.some((hotspot) => hotspot.kind === 'effect-cascade'), `cheap causes are marked not worth fixing: ${describe(cheap)}`);
      if (process.env.VERBOSE) console.log(run(['analyze', '--audit', audit, '--label', 'timed']).out);

      console.log('Timing benchmark');
      const common = ['bench', '--audit', audit, '--scenario', scenarioFile, '--quiet', '250'];
      // The same code on two servers: nothing may come out as a meaningful change, and a targeted
      // step shows no gain (exit 5).
      r = run([...common, '--label', 'same', '--a', 'http://127.0.0.1:5193/?variant=broken&cost=80', '--a-cmd', VITE, '--a-cwd', repo, '--b', `${LAB}/?variant=broken&cost=80`, '--profiles', 'desktop', '--pairs', '8', '--aa', '0', '--no-trace', '--target', '1', '--json']);
      const same = r.stdout.includes('"protocol"') ? JSON.parse(r.stdout.slice(0, r.stdout.lastIndexOf('}') + 1)) : null;
      const sameLevels = same ? [same.results[0].analysis.flow.impact.level, ...same.results[0].analysis.steps.map((step) => step.impact.level)] : [];
      check(!!same && sameLevels.every((level) => level === 'none' || level === 'low'), `same code, two servers: no meaningful difference (${sameLevels.join(', ') || r.out.slice(-600)})`);
      check(r.code === 5 && !!same && same.target.decision === 'no-gain', `same code: the targeted step shows no gain (exit ${r.code})`);

      // The per-fix proof with the triage's defaults: its slow steps, on the profile they were slow on.
      r = run([...common, '--label', 'proof-1', '--quick', '--cpu-mobile', '4', '--a', `${LAB}/?variant=broken&cost=500`, '--a-label', 'without fix-1', '--b', `${LAB}/?variant=fixed&cost=500`]);
      const proof = existsSync(join(audit, 'bench', 'proof-1', 'bench.json')) ? JSON.parse(readFileSync(join(audit, 'bench', 'proof-1', 'bench.json'), 'utf8')) : null;
      check(r.code === 0 && !!proof && proof.target.decision === 'faster' && proof.results.length === 1 && proof.results[0].profile === 'mobile' && !proof.results[0].aa, `quick proof keeps broken -> fixed on mobile (exit ${r.code})${r.code ? `\n${r.out.slice(-1500)}` : ''}`);
      check(!!proof && proof.target.steps.includes(typingStep) && proof.target.lines.some((line) => line.includes(`${typingStep}: faster`)), `the proof judged the triage's slow steps: ${proof ? proof.target.lines.join(' | ') : ''}`);
      if (process.env.VERBOSE) console.log(r.out);
      r = run(['changes', 'add', '--audit', audit, '--title', 'Give ProductCard stable props', '--status', 'kept', '--component', 'ProductGrid', '--measure', 'after-1', '--proof', 'proof-1']);
      check(r.code === 0, 'changes add --proof');

      const summary = join(work, 'summary.md');
      r = run([...common, '--label', 'final', '--a', `${LAB}/?variant=broken&cost=150`, '--a-label', 'broken', '--b', `${LAB}/?variant=fixed&cost=150`, '--b-label', 'fixed', '--pairs', '8', '--cpu-mobile', '4', '--markdown', summary, '--fail-on', 'slower']);
      check(r.code === 0, `broken -> fixed benchmark (exit ${r.code})${r.code ? `\n${r.out.slice(-1500)}` : ''}`);
      const final = existsSync(join(audit, 'bench', 'final', 'bench.json')) ? JSON.parse(readFileSync(join(audit, 'bench', 'final', 'bench.json'), 'utf8')) : null;
      for (const item of final ? final.results : []) {
        const click = item.analysis.steps.find((step) => step.name === 'add Trail Runner');
        check(click.impact.direction === 'better' && click.impact.level !== 'low', `${item.profile}: the click is faster (${click.impact.level}: ${click.impact.reasons.join('; ')})`);
        check(item.analysis.flow.impact.direction === 'better', `${item.profile}: the whole flow is faster (${item.analysis.flow.mainThread.a} -> ${item.analysis.flow.mainThread.b} ms main thread)`);
        check(existsSync(join(audit, 'bench', 'final', item.traces.a)) && existsSync(join(audit, 'bench', 'final', item.traces.b)), `${item.profile}: Chrome traces saved`);
      }
      check(!!final && final.results.length === 2, 'both profiles measured');
      check(existsSync(summary) && readFileSync(summary, 'utf8').includes('## Measured speed-up'), 'markdown summary written');
      if (process.env.VERBOSE) console.log(r.out);

      r = run([...common, '--label', 'reverse', '--a', `${LAB}/?variant=fixed&cost=150`, '--b', `${LAB}/?variant=broken&cost=150`, '--profiles', 'desktop', '--quick', '--target', '1']);
      check(r.code === 4 && /SLOWER: revert this fix/.test(r.out), `fixed -> broken fails the per-fix proof (exit ${r.code})`);
      r = run([...common, '--label', 'reverse-gate', '--a', `${LAB}/?variant=fixed&cost=150`, '--b', `${LAB}/?variant=broken&cost=150`, '--profiles', 'desktop', '--pairs', '8', '--aa', '0', '--no-trace', '--fail-on', 'slower']);
      check(r.code === 4, `fixed -> broken fails with --fail-on slower (exit ${r.code})`);
    }

    r = run(['report', '--audit', audit, '--final', 'after-1', ...(process.env.SKIP_BENCH ? [] : ['--bench', 'final'])]);
    check(r.code === 0 && existsSync(join(audit, 'report.html')) && existsSync(join(audit, 'report.md')), `report written${r.code ? `\n${r.out}` : ''}`);
    const html = existsSync(join(audit, 'report.html')) ? readFileSync(join(audit, 'report.html'), 'utf8') : '';
    if (!process.env.SKIP_BENCH) {
      check(html.includes('Measured speed-up') && html.includes('Real users'), 'the report has the speed and real-user sections');
      check(html.includes('Is anything slow?') && html.includes('Timing proof: <span class="good">KEEP'), 'the report leads with the triage and shows the fix\'s timing proof');
    }

    console.log('CI workflow and device profiles');
    const workflow = join(work, 'render-benchmark.yml');
    r = run(['ci', '--app', labDir, '--scenario', scenarioFile, '--dev', 'bun run dev -- --port {port}', '--paths', 'plugins/react-render-audit/fixtures/lab/**', '--out', workflow]);
    const yaml = existsSync(workflow) ? readFileSync(workflow, 'utf8') : '';
    check(r.code === 0 && yaml.includes('uses: oven-sh/setup-bun@v2') && yaml.includes('--scenario "plugins/react-render-audit/fixtures/lab/scenarios/store.json"'), `ci wrote a workflow for this repository${r.code ? `\n${r.out}` : ''}`);
    r = run(['inspect', '--url', `${LAB}/`, '--root', labDir, '--profile', 'mobile']);
    check(r.code === 0 && r.out.includes('(mobile profile)') && r.out.includes('Add Trail Runner to cart'), `inspect emulates the phone${r.code ? `\n${r.out}` : ''}`);
    if (process.env.KEEP) console.log(`Audit kept at ${audit}`);
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
    if (!process.env.KEEP) rmSync(audit, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
    if (server) server.kill();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

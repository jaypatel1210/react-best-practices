// The timing benchmark. It replays scenarios on two builds of the app, A (the baseline) and B
// (the candidate), in alternating order under fixed device profiles, with the timing collector
// instead of the render tracker, and compares them with paired, distribution-free statistics.
// With only A it profiles the current app: medians with confidence intervals.
//
// Procedure (protocol v1, see references/benchmark-protocol.md): calibrate the CPU slowdown for
// the mobile profile; per profile and scenario, record the app's API responses in a first run and
// replay them to every later run; warm up both sides; run a same-vs-same (A/A) check whose noise
// decides the number of pairs; run the pairs as AB, BA, AB, ...; save one Chrome trace per side.
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './chrome.mjs';
import { inPageSource } from './inpage.mjs';
import { NetworkLog, evaluate, navigate, openPage, performAction, settle } from './page.mjs';
import { calibrate, chromeMajor, profile as profileOf } from './profiles.mjs';
import { NetworkReplay } from './replay.mjs';
import { stepLabel } from './scenario.mjs';
import { startServer } from './servers.mjs';
import { FRAME_MS, impactOf, median, pairedDiff, plannedPairs, quantileCI, rating, ratingLabel, verdict } from './stats.mjs';
import { round, table, writeJson } from './util.mjs';

export const PROTOCOL_VERSION = 1;
// Clicks, taps and key presses are interactions (Event Timing gives them an interactionId);
// hovering, scrolling and resizing are not.
const INTERACTIVE_ACTIONS = new Set(['click', 'type', 'press']);
// Event Timing doesn't report interactions faster than this, so an interaction without an entry
// took at most this long.
export const MIN_REPORTED_MS = 16;
// The categories Chrome DevTools records, so traces open there with flame charts and frames.
const TRACE_CATEGORIES = [
  'devtools.timeline',
  'v8.execute',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'toplevel',
  'blink.console',
  'blink.user_timing',
  'latencyInfo',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler',
];

function toolVersion() {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '.claude-plugin', 'plugin.json');
    return JSON.parse(readFileSync(file, 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

function powerSource() {
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
      if (/AC Power/.test(out)) return 'AC power';
      if (/Battery Power/.test(out)) return 'battery';
    } else if (process.platform === 'linux') {
      const base = '/sys/class/power_supply';
      for (const name of ['AC', 'AC0', 'ACAD', 'ADP1']) {
        const file = join(base, name, 'online');
        if (existsSync(file)) return readFileSync(file, 'utf8').trim() === '1' ? 'AC power' : 'battery';
      }
    }
  } catch {
    // unknown
  }
  return null;
}

export function environment(chrome) {
  const cpus = os.cpus();
  return {
    os: `${os.type()} ${os.release()} (${process.arch})`,
    cpu: cpus.length ? cpus[0].model.trim() : 'unknown',
    cores: cpus.length,
    memoryGB: Math.round(os.totalmem() / 1024 ** 3),
    loadAverage: os.loadavg().map((value) => round(value, 2)),
    power: powerSource(),
    node: process.versions.node,
    chrome,
    ci: !!process.env.CI,
  };
}

function absoluteUrl(url, base) {
  try {
    return new URL(url || '', base || undefined).href;
  } catch {
    throw new Error(`"${url}" isn't a valid URL${base ? ` relative to ${base}` : ''}.`);
  }
}

async function perfMetrics(page) {
  try {
    const { metrics } = await page.send('Performance.getMetrics');
    return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
  } catch {
    return {};
  }
}

// Seconds of main-thread work between two readings, in ms. The counters belong to the renderer
// process, which a cross-site navigation replaces; then the new reading is the whole delta.
function metricDelta(before, after, name) {
  const a = before[name] ?? 0;
  const b = after[name] ?? 0;
  return round((b >= a ? b - a : b) * 1000, 1);
}

async function startTrace(page) {
  await page.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    traceConfig: { includedCategories: TRACE_CATEGORIES, excludedCategories: ['*'] },
  });
}

async function stopTrace(page, file) {
  let off;
  const complete = new Promise((resolve) => {
    off = page.on('Tracing.tracingComplete', (event) => resolve(event.stream));
  });
  await page.send('Tracing.end');
  let timer;
  const stream = await Promise.race([complete, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('the trace did not finish within 60 s')), 60000)))]).finally(() => {
    clearTimeout(timer);
    off();
  });
  mkdirSync(dirname(file), { recursive: true });
  const out = createWriteStream(file);
  for (;;) {
    const { data, eof, base64Encoded } = await page.send('IO.read', { handle: stream, size: 1 << 20 });
    out.write(base64Encoded ? Buffer.from(data, 'base64') : data);
    if (eof) break;
  }
  await page.send('IO.close', { handle: stream }).catch(() => {});
  await new Promise((resolve) => out.end(resolve));
}

/** One run of a scenario on one side. Returns { steps, status, replay }. */
async function runOnce(browser, ctx) {
  const { scenario, baseUrl, prof, cpuRate, replay, traceFile, quietMs, maxSettleMs } = ctx;
  const { page, close } = await openPage(browser, {
    source: ctx.source,
    width: prof.width,
    height: prof.height,
    deviceScaleFactor: prof.deviceScaleFactor,
    mobile: prof.mobile,
    userAgent: prof.userAgent,
    userAgentMetadata: prof.userAgentMetadata,
    cookies: ctx.cookies,
    headers: ctx.headers,
  });
  const network = new NetworkLog(page, [...(ctx.ignoreRequests || []), ...scenario.ignoreRequests]);
  const steps = [{ ...scenario.load, action: 'goto', url: scenario.url, name: scenario.load.name || 'load' }, ...scenario.steps];
  const records = [];
  try {
    await page.send('Performance.enable', { timeDomain: 'timeTicks' });
    if (cpuRate > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    const replayed = replay ? await replay.attach(page, { appOrigin: new URL(baseUrl).origin }) : null;
    if (traceFile) await startTrace(page);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const name = stepLabel(step, i);
      const isNavigation = step.action === 'goto';
      const before = await perfMetrics(page);
      if (!isNavigation) await evaluate(page, `__RA_VITALS__.begin(${i}, ${JSON.stringify(name)})`);
      network.begin(i);
      try {
        if (isNavigation) {
          network.skipNextDocument();
          await navigate(page, absoluteUrl(step.url, baseUrl));
        } else {
          await performAction(page, step, prof);
        }
      } catch (error) {
        throw new Error(`Step ${i} "${name}" failed on ${baseUrl}: ${error.message}`);
      }
      const settled = await settle(page, network, {
        quietMs: step.quietMs ?? quietMs,
        maxMs: step.maxSettleMs ?? (isNavigation ? maxSettleMs * 3 : maxSettleMs),
      });
      const data = (await evaluate(page, '__RA_VITALS__.end()').catch(() => null)) || {};
      const after = await perfMetrics(page);
      const interactive = INTERACTIVE_ACTIONS.has(step.action);
      const worst = data.interactions ? data.interactions.worst : null;
      records.push({
        index: i,
        name,
        action: step.action || 'goto',
        interactive,
        settled: settled.settled,
        inp: typeof data.inp === 'number' ? data.inp : null,
        interactions: data.interactions ? data.interactions.count : 0,
        interaction: worst,
        tbt: data.tbt ?? 0,
        longTasks: data.longTasks ?? 0,
        longFrames: data.longFrames ? data.longFrames.count : 0,
        longestFrame: data.longFrames ? data.longFrames.maxMs : 0,
        frameScripts: data.longFrames ? data.longFrames.scripts : [],
        dropped: data.frames ? data.frames.dropped : 0,
        smoothness: data.frames ? data.frames.smoothness : null,
        reactMs: data.react ? data.react.renderMs : 0,
        commits: data.react ? data.react.commits : 0,
        mainThread: metricDelta(before, after, 'TaskDuration'),
        script: metricDelta(before, after, 'ScriptDuration'),
        layout: metricDelta(before, after, 'LayoutDuration'),
        style: metricDelta(before, after, 'RecalcStyleDuration'),
        heapMB: after.JSHeapUsedSize ? round(after.JSHeapUsedSize / 1048576, 1) : null,
        activeMs: data.activeMs ?? null,
      });
    }
    const status = await evaluate(page, '__RA_VITALS__.status()').catch(() => null);
    if (traceFile) await stopTrace(page, traceFile);
    return {
      steps: records,
      status,
      replay: replayed ? { mode: replayed.mode, recorded: replayed.recorded, served: replayed.served, passed: replayed.passed, misses: replayed.misses } : null,
    };
  } finally {
    await close();
  }
}

/** The value statistics use for a step's response time: Event Timing's floor when it reported nothing. */
export function responseTime(step) {
  if (!step || !step.interactive) return null;
  return typeof step.inp === 'number' ? step.inp : MIN_REPORTED_MS;
}

/** Whole-scenario numbers for one run. */
export function flowOf(run) {
  const steps = run.steps;
  const sum = (key) => round(steps.reduce((total, step) => total + (step[key] || 0), 0), 1);
  const responses = steps.map(responseTime).filter((value) => value !== null);
  return {
    inp: responses.length ? Math.max(...responses) : null,
    mainThread: sum('mainThread'),
    tbt: sum('tbt'),
    longFrames: sum('longFrames'),
    dropped: sum('dropped'),
    reactMs: sum('reactMs'),
    commits: sum('commits'),
  };
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values) if (value) counts.set(value, (counts.get(value) || 0) + 1);
  let best = null;
  for (const [value, count] of counts) if (!best || count > best[1]) best = [value, count];
  return best ? best[0] : null;
}

function breakdown(runs, index) {
  const parts = runs.map((run) => run.steps[index] && run.steps[index].interaction).filter(Boolean);
  if (!parts.length) return null;
  return {
    inputDelay: round(median(parts.map((part) => part.inputDelay)), 1),
    processing: round(median(parts.map((part) => part.processing)), 1),
    presentation: round(median(parts.map((part) => part.presentation)), 1),
    target: mostCommon(parts.map((part) => part.target)),
  };
}

const FLOW_KEYS = ['inp', 'mainThread', 'tbt', 'longFrames', 'dropped', 'reactMs', 'commits'];
const STEP_KEYS = ['mainThread', 'tbt', 'longFrames', 'dropped', 'reactMs', 'commits', 'script', 'layout', 'style'];

/** Paired analysis of A and B runs (runsA[i] and runsB[i] ran back to back). */
export function analyzePairs(runsA, runsB) {
  const template = runsA[0].steps;
  const steps = template.map((step, index) => {
    const pick = (runs, key) => runs.map((run) => (run.steps[index] ? run.steps[index][key] : null));
    const result = { index, name: step.name, action: step.action, interactive: step.interactive };
    if (step.interactive) {
      result.inp = pairedDiff(runsA.map((run) => responseTime(run.steps[index])), runsB.map((run) => responseTime(run.steps[index])));
      result.rating = { a: rating('INP', result.inp.a), b: rating('INP', result.inp.b) };
      result.breakdown = { a: breakdown(runsA, index), b: breakdown(runsB, index) };
    }
    for (const key of STEP_KEYS) result[key] = pairedDiff(pick(runsA, key), pick(runsB, key));
    result.smoothness = { a: median(pick(runsA, 'smoothness')), b: median(pick(runsB, 'smoothness')) };
    result.settled = { a: pick(runsA, 'settled').filter(Boolean).length, b: pick(runsB, 'settled').filter(Boolean).length, of: runsA.length };
    result.impact = impactOf(result);
    return result;
  });
  const flowsA = runsA.map(flowOf);
  const flowsB = runsB.map(flowOf);
  const flow = {};
  for (const key of FLOW_KEYS) {
    if (key === 'inp' && flowsA[0].inp === null) continue;
    flow[key] = pairedDiff(flowsA.map((item) => item[key]), flowsB.map((item) => item[key]));
  }
  if (flow.inp) flow.rating = { a: rating('INP', flow.inp.a), b: rating('INP', flow.inp.b) };
  flow.impact = impactOf(flow);
  return { steps, flow };
}

function medianWithCI(values) {
  const ci = quantileCI(values, 0.5);
  return { median: ci.estimate === null ? null : round(ci.estimate, 1), low: ci.low, high: ci.high, n: ci.n, exact: ci.exact };
}

/** Profile of one side only: medians with sign-test confidence intervals. */
export function analyzeSingle(runs) {
  const template = runs[0].steps;
  const steps = template.map((step, index) => {
    const pick = (key) => runs.map((run) => (run.steps[index] ? run.steps[index][key] : null));
    const result = { index, name: step.name, action: step.action, interactive: step.interactive };
    if (step.interactive) {
      result.inp = medianWithCI(runs.map((run) => responseTime(run.steps[index])));
      result.rating = rating('INP', result.inp.median);
      result.breakdown = breakdown(runs, index);
    }
    for (const key of STEP_KEYS) result[key] = medianWithCI(pick(key));
    result.smoothness = median(pick('smoothness'));
    return result;
  });
  const flows = runs.map(flowOf);
  const flow = {};
  for (const key of FLOW_KEYS) if (!(key === 'inp' && flows[0].inp === null)) flow[key] = medianWithCI(flows.map((item) => item[key]));
  if (flow.inp) flow.rating = rating('INP', flow.inp.median);
  return { steps, flow };
}

/**
 * Same-vs-same check. Pairs are labeled like real A/B pairs (which run counts as "A" alternates),
 * so an order effect cancels out here as it does there. It passes or fails only with enough pairs
 * for a 95% interval; with fewer it just estimates the noise.
 */
export function aaSummary(pairs) {
  const xs = pairs.map(([first, second], i) => flowOf(i % 2 === 0 ? first : second));
  const ys = pairs.map(([first, second], i) => flowOf(i % 2 === 0 ? second : first));
  const out = { pairs: pairs.length };
  let judged = true;
  for (const key of ['mainThread', 'inp', 'tbt']) {
    if (key === 'inp' && xs[0].inp === null) continue;
    const diff = pairedDiff(xs.map((item) => item[key]), ys.map((item) => item[key]));
    if (!diff.exact) judged = false;
    out[key] = { ...diff, verdict: verdict(diff), diffs: xs.map((item, i) => (item[key] === null ? null : round(ys[i][key] - item[key], 1))) };
  }
  out.judged = judged;
  out.ok = !judged || ['mainThread', 'inp', 'tbt'].every((key) => !out[key] || out[key].verdict === 'same');
  return out;
}

async function runWithRetry(run, describe, log) {
  try {
    return await run();
  } catch (error) {
    log(`  ${describe} failed (${error.message.split('\n')[0]}); retrying once`);
    return run();
  }
}

/**
 * Runs the benchmark. Options:
 *   outDir, scenarios (from loadScenario), profiles ['mobile', 'desktop'],
 *   a: { label, url, command?, cwd?, ref? }, b: same or null (profile mode),
 *   pairs ('auto' or a number), minPairs, maxPairs, aaPairs, warmup, replay, trace, cpuMobile,
 *   quietMs, maxSettleMs, cookies, headers, ignoreRequests, headless, chromeArgs, serverTimeoutS, log
 */
export async function bench(options) {
  const {
    outDir,
    scenarios,
    profiles = ['mobile', 'desktop'],
    a,
    b = null,
    pairs = 'auto',
    minPairs = 8,
    maxPairs = 20,
    aaPairs = 6,
    warmup = 1,
    replay: useReplay = true,
    trace = true,
    cpuMobile = null,
    quietMs = 500,
    maxSettleMs = 10000,
    headless = true,
    chromeArgs = [],
    serverTimeoutS = 240,
    log = (line) => process.stderr.write(`${line}\n`),
  } = options;
  mkdirSync(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const servers = [];
  const result = {
    protocol: PROTOCOL_VERSION,
    tool: { name: 'react-render-audit', version: toolVersion() },
    label: options.label || null,
    startedAt,
    finishedAt: null,
    sides: {
      a: { label: a.label || 'A', url: a.url, ref: a.ref || null, sha: a.sha || null, command: a.command || null },
      b: b ? { label: b.label || 'B', url: b.url, ref: b.ref || null, sha: b.sha || null, command: b.command || null } : null,
    },
    mode: b ? 'compare' : 'profile',
    settings: { profiles, pairs, minPairs, maxPairs, aaPairs, warmup, replay: useReplay, trace, quietMs, maxSettleMs },
    environment: null,
    calibration: null,
    results: [],
  };
  const shared = {
    source: inPageSource('vitals'),
    quietMs,
    maxSettleMs,
    cookies: options.cookies,
    headers: options.headers,
    ignoreRequests: options.ignoreRequests,
  };

  try {
    for (const [key, side] of [['a', a], ['b', b]]) {
      if (!side || !side.command) continue;
      log(`Starting ${side.label || key.toUpperCase()}: ${side.command} (in ${side.cwd})`);
      servers.push(await startServer({ name: side.label || key.toUpperCase(), command: side.command, cwd: side.cwd, url: side.url, logFile: join(outDir, `server-${key}.log`), timeoutS: serverTimeoutS }));
    }
    const browser = await launchChrome({ headless, args: chromeArgs });
    try {
      result.environment = environment(browser.version.product);
      if (result.environment.power === 'battery') log('warning: running on battery power; timings are noisier and CPUs may slow down. Plug in for a fair result.');
      const major = chromeMajor(browser.version.product);
      for (const profileName of profiles) {
        const prof = profileOf(profileName, { chromeMajor: major || '140' });
        let cpuRate = 1;
        if (prof.mobile) {
          if (cpuMobile) cpuRate = Number(cpuMobile);
          else {
            result.calibration = result.calibration || (await calibrate(browser, { log }));
            cpuRate = result.calibration.rate;
          }
        }
        for (const scenario of scenarios) {
          const tag = `${profileName} · ${scenario.name}`;
          const replay = useReplay ? new NetworkReplay() : null;
          const run = (side, extra = {}) =>
            runWithRetry(() => runOnce(browser, { ...shared, scenario, baseUrl: side.url, prof, cpuRate, replay, ...extra }), `${tag} run on ${side.label || side.url}`, log);

          // The first run records the network (A's data is what both sides get), then warm-ups.
          log(`${tag}: ${replay ? 'recording API responses, then ' : ''}warming up (CPU ${cpuRate}×)`);
          const recording = await run(a);
          if (replay) replay.freeze();
          for (let i = 1; i < warmup; i++) await run(a);
          if (b) for (let i = 0; i < warmup; i++) await run(b);

          const item = {
            profile: profileName,
            scenario: scenario.name,
            scenarioFile: scenario.file,
            viewport: { width: prof.width, height: prof.height, deviceScaleFactor: prof.deviceScaleFactor, mobile: prof.mobile },
            cpuRate,
            react: recording.status && recording.status.renderers && recording.status.renderers[0] ? { version: recording.status.renderers[0].version, development: recording.status.renderers[0].bundleType === 1 } : null,
            replay: null,
            aa: null,
            pairs: 0,
            traces: {},
            analysis: null,
            runs: { a: [], b: [] },
            replayed: [],
          };

          if (!b) {
            const count = pairs === 'auto' ? 10 : Number(pairs);
            for (let i = 0; i < count; i++) {
              item.runs.a.push(await run(a));
              log(`${tag}: run ${i + 1}/${count}`);
            }
            item.pairs = count;
            item.analysis = analyzeSingle(item.runs.a);
          } else {
            // Same-vs-same: how much the numbers move when nothing changed.
            const aa = [];
            for (let i = 0; i < aaPairs; i++) aa.push([await run(a), await run(a)]);
            item.aa = aaPairs ? aaSummary(aa) : null;
            let count = Number(pairs);
            if (pairs === 'auto') {
              const flows = aa.map(([first]) => flowOf(first));
              const mainEffect = Math.max(FRAME_MS, 0.05 * (median(flows.map((flow) => flow.mainThread)) || 0));
              count = Math.max(
                aa.length ? plannedPairs(item.aa.mainThread.diffs, mainEffect, { min: minPairs, max: maxPairs }) : minPairs,
                aa.length && item.aa.inp ? plannedPairs(item.aa.inp.diffs, FRAME_MS, { min: minPairs, max: maxPairs }) : minPairs,
              );
            }
            if (item.aa) log(`${tag}: A/A check ${!item.aa.judged ? 'estimated the noise' : item.aa.ok ? 'found no difference, as expected' : 'found a difference between identical runs: this machine is noisy right now'}; running ${count} pairs`);
            for (let i = 0; i < count; i++) {
              // Alternate the order so drift and warm caches affect both sides alike.
              let runA;
              let runB;
              if (i % 2 === 0) {
                runA = await run(a);
                runB = await run(b);
              } else {
                runB = await run(b);
                runA = await run(a);
              }
              item.runs.a.push(runA);
              item.runs.b.push(runB);
              const fa = flowOf(runA);
              const fb = flowOf(runB);
              log(`${tag}: pair ${i + 1}/${count}  main thread A ${Math.round(fa.mainThread)} ms · B ${Math.round(fb.mainThread)} ms${fa.inp !== null ? `  slowest response A ${fa.inp} ms · B ${fb.inp} ms` : ''}`);
            }
            item.pairs = count;
            item.analysis = analyzePairs(item.runs.a, item.runs.b);
          }
          item.replay = replay ? { ...replay.summary(), served: sumReplay([...item.runs.a, ...item.runs.b], 'served'), passed: sumReplay([...item.runs.a, ...item.runs.b], 'passed') } : null;

          if (trace) {
            const base = `${profileName}-${scenario.name}`.replace(/[^\w.-]+/g, '_');
            item.traces.a = join('traces', `${base}-a.json`);
            await run(a, { traceFile: join(outDir, item.traces.a) });
            if (b) {
              item.traces.b = join('traces', `${base}-b.json`);
              await run(b, { traceFile: join(outDir, item.traces.b) });
            }
          }
          result.results.push(item);
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    for (const server of servers.reverse()) await server.stop().catch(() => {});
  }
  result.finishedAt = new Date().toISOString();
  writeJson(join(outDir, 'bench.json'), result);
  return result;
}

function sumReplay(runs, key) {
  return runs.reduce((total, run) => total + ((run.replay && run.replay[key]) || 0), 0);
}

// ---------------------------------------------------------------------------------------------
// Presentation

const MINUS = '−';
export function ms(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const text = abs >= 10 ? Math.round(abs).toLocaleString('en-US') : String(round(abs, 1));
  return `${value < 0 ? MINUS : ''}${text} ms`;
}

function signedMs(value) {
  if (value === null || value === undefined) return '—';
  return value > 0 ? `+${ms(value)}` : ms(value);
}

function pct(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100);
  if (rounded === 0) return '0%';
  return rounded > 0 ? `+${rounded}%` : `${MINUS}${Math.abs(rounded)}%`;
}

function count(value) {
  return value === null || value === undefined ? '—' : String(round(value, 1));
}

/** A response time; Event Timing doesn't report faster interactions, so its floor reads "≤16 ms". */
export function responseMs(value) {
  if (typeof value === 'number' && value <= MIN_REPORTED_MS) return `≤${MIN_REPORTED_MS} ms`;
  return ms(value);
}

/** "−118 ms (−131 to −97)" */
export function changeText(diff, { unit = 'ms' } = {}) {
  if (!diff || diff.diff === null) return '—';
  const fmt = unit === 'ms' ? signedMs : (value) => (value > 0 ? `+${count(value)}` : value < 0 ? `${MINUS}${count(-value)}` : '0');
  const strip = (text) => text.replace(/ ms$/, '');
  return `${fmt(diff.diff)} (${strip(fmt(diff.low))} to ${strip(fmt(diff.high))})`;
}

function relativeText(diff) {
  if (!diff || diff.relative === null) return '';
  return `${pct(diff.relative)} (${pct(diff.relativeLow)} to ${pct(diff.relativeHigh)})`;
}

const IMPACT_WORD = { high: 'high', medium: 'medium', low: 'low', none: '—' };
function impactText(impact) {
  if (!impact || impact.level === 'none') return 'no measurable change';
  return `${impact.direction === 'worse' ? 'SLOWER, ' : ''}${IMPACT_WORD[impact.level]}`;
}

/** Rows for one result's comparison table: what to show per step, plus the whole flow. */
export function comparisonRows(item) {
  const rows = [];
  for (const step of item.analysis.steps) {
    const metric = step.interactive ? step.inp : step.mainThread;
    rows.push({
      index: step.index,
      name: step.name,
      metric: step.interactive ? 'response time' : 'main-thread time',
      before: metric.a,
      after: metric.b,
      beforeText: step.interactive ? responseMs(metric.a) : ms(metric.a),
      afterText: step.interactive ? responseMs(metric.b) : ms(metric.b),
      change: changeText(metric),
      relative: relativeText(metric),
      rating: step.interactive ? `${ratingLabel(step.rating.a)} → ${ratingLabel(step.rating.b)}` : '',
      verdict: verdict(metric),
      impact: step.impact,
      reasons: step.impact.reasons,
    });
  }
  return rows;
}

export function flowLine(item) {
  const flow = item.analysis.flow;
  const main = flow.mainThread;
  const parts = [`main thread ${ms(main.a)} → ${ms(main.b)}${main.relative !== null ? ` (${pct(main.relative)}; 95% CI ${pct(main.relativeLow)} to ${pct(main.relativeHigh)})` : ''}`];
  if (flow.inp) parts.push(`slowest response ${responseMs(flow.inp.a)} → ${responseMs(flow.inp.b)}`);
  parts.push(`blocking time ${ms(flow.tbt.a)} → ${ms(flow.tbt.b)}`);
  if (flow.reactMs.a || flow.reactMs.b) parts.push(`React render time ${ms(flow.reactMs.a)} → ${ms(flow.reactMs.b)}`);
  parts.push(`long frames ${count(flow.longFrames.a)} → ${count(flow.longFrames.b)}`);
  return parts.join(', ');
}

function profileTitle(item) {
  const vp = item.viewport;
  return `${item.profile} (${vp.width}×${vp.height}${vp.deviceScaleFactor !== 1 ? ` @${vp.deviceScaleFactor}x` : ''}, CPU ${item.cpuRate}×)`;
}

function aaText(item) {
  if (!item.aa) return 'no A/A check';
  const noise = item.aa.mainThread ? ` (main thread differed by ${ms(item.aa.mainThread.low)} to ${ms(item.aa.mainThread.high)} between identical runs)` : '';
  if (!item.aa.judged) return `A/A noise estimate from ${item.aa.pairs} pairs${noise}`;
  return item.aa.ok ? `A/A check passed${noise}` : `A/A check FAILED: identical runs differed${noise}; treat small differences with caution`;
}

/** Plain-text summary for the terminal. */
export function formatBench(result) {
  const lines = [];
  const { a, b } = result.sides;
  lines.push(`Timing benchmark (protocol v${result.protocol}) — ${result.environment ? `${result.environment.chrome}, ${result.environment.cpu}${result.environment.power ? `, ${result.environment.power}` : ''}` : ''}`);
  lines.push(`A = ${a.label}: ${a.url}${a.sha ? ` @ ${a.sha.slice(0, 10)}` : ''}`);
  if (b) lines.push(`B = ${b.label}: ${b.url}${b.sha ? ` @ ${b.sha.slice(0, 10)}` : ''}`);
  if (result.calibration) lines.push(`CPU calibration: BenchmarkIndex ${result.calibration.hostIndex} → ${result.calibration.rate}× slowdown (measured ${result.calibration.throttledIndex}, target ${result.calibration.target})`);
  for (const item of result.results) {
    lines.push('', `${item.scenario} — ${profileTitle(item)}, ${item.pairs} ${b ? 'alternating pairs' : 'runs'}${item.react && item.react.development ? ', React development build' : ''}`);
    if (!b) {
      const rows = [['#', 'step', 'response time (95% CI)', 'rating', 'main thread', 'blocking']];
      for (const step of item.analysis.steps) {
        rows.push([
          step.index,
          step.name,
          step.inp ? `${responseMs(step.inp.median)} (${count(step.inp.low)}–${count(step.inp.high)})` : '—',
          step.inp ? ratingLabel(step.rating) : '',
          ms(step.mainThread.median),
          ms(step.tbt.median),
        ]);
      }
      lines.push(table(rows, { indent: '  ' }));
      continue;
    }
    lines.push(`  ${aaText(item)}`);
    const rows = [['#', 'step', 'measured', 'A → B', 'change (95% CI)', 'rating', 'impact']];
    for (const row of comparisonRows(item)) {
      rows.push([row.index, row.name, row.metric, `${row.beforeText} → ${row.afterText}`, row.change, row.rating, impactText(row.impact)]);
    }
    lines.push(table(rows, { indent: '  ' }));
    lines.push(`  Whole flow: ${flowLine(item)} — ${impactText(item.analysis.flow.impact)}${item.analysis.flow.impact.reasons.length ? ` (${item.analysis.flow.impact.reasons.join('; ')})` : ''}`);
    for (const step of item.analysis.steps) {
      if (step.impact.level !== 'none') lines.push(`  ${step.index}. ${step.name}: ${step.impact.reasons.join('; ')}`);
    }
    if (item.replay && item.replay.requests) lines.push(`  Network: ${item.replay.distinct} API request(s) recorded once and replayed (${item.replay.served} served, ${item.replay.passed} not in the recording)`);
  }
  return lines.join('\n');
}

/** Markdown summary (CI job summaries and report.md). */
export function benchMarkdown(result) {
  const md = [];
  const { a, b } = result.sides;
  md.push(`## Measured speed${b ? '-up' : ''}`, '');
  md.push(`A = **${a.label}**${a.sha ? ` (\`${a.sha.slice(0, 10)}\`)` : ''}${b ? ` · B = **${b.label}**${b.sha ? ` (\`${b.sha.slice(0, 10)}\`)` : ''}` : ''}. Protocol v${result.protocol}${result.environment ? `, ${result.environment.chrome} on ${result.environment.cpu}` : ''}${result.calibration ? `, CPU calibrated to ${result.calibration.rate}× for mobile` : ''}.`, '');
  for (const item of result.results) {
    md.push(`### ${item.scenario} — ${profileTitle(item)}, ${item.pairs} ${b ? 'alternating pairs' : 'runs'}`, '');
    if (!b) {
      md.push('| # | Step | Response time (95% CI) | Rating | Main thread | Blocking time |', '|---:|---|---|---|---:|---:|');
      for (const step of item.analysis.steps) {
        md.push(`| ${step.index} | ${step.name.replace(/\|/g, '\\|')} | ${step.inp ? `${responseMs(step.inp.median)} (${count(step.inp.low)}–${count(step.inp.high)})` : '—'} | ${step.inp ? ratingLabel(step.rating) : ''} | ${ms(step.mainThread.median)} | ${ms(step.tbt.median)} |`);
      }
      md.push('');
      continue;
    }
    md.push('| # | Step | Measured | A → B | Change (95% CI) | Rating | Impact |', '|---:|---|---|---|---|---|---|');
    for (const row of comparisonRows(item)) {
      md.push(`| ${row.index} | ${row.name.replace(/\|/g, '\\|')} | ${row.metric} | ${row.beforeText} → ${row.afterText} | ${row.change} | ${row.rating} | ${row.impact.level === 'none' ? 'no measurable change' : `**${impactText(row.impact)}**`} |`);
    }
    md.push('', `**Whole flow:** ${flowLine(item)} — ${impactText(item.analysis.flow.impact)}.`, '', `_${aaText(item)}._`, '');
  }
  return md.join('\n');
}

/** Exit status for --fail-on: 4 when anything got slower (medium impact or more), 5 when nothing got faster. */
export function benchExitCode(result, failOn) {
  if (!failOn || result.mode !== 'compare') return 0;
  const impacts = result.results.flatMap((item) => [item.analysis.flow.impact, ...item.analysis.steps.map((step) => step.impact)]);
  if (failOn === 'slower' && impacts.some((impact) => impact.direction === 'worse' && impact.level !== 'low' && impact.level !== 'none')) return 4;
  if (failOn === 'no-gain' && !result.results.some((item) => item.analysis.flow.impact.direction === 'better')) return 5;
  return 0;
}

/** One sentence per profile: the slowest response and the main-thread time, before → after. */
export function speedHeadline(result) {
  if (!result || !result.results.length) return '';
  const parts = [];
  for (const item of result.results) {
    const flow = item.analysis.flow;
    if (result.mode !== 'compare') {
      parts.push(`On ${item.profile} (${item.scenario}), the slowest response is ${responseMs(flow.inp ? flow.inp.median : null)}${flow.rating ? ` (${ratingLabel(flow.rating)})` : ''} and the flow takes ${ms(flow.mainThread.median)} of main-thread time.`);
      continue;
    }
    const pieces = [];
    if (flow.inp && verdict(flow.inp) !== 'same') {
      pieces.push(`the slowest response went from ${responseMs(flow.inp.a)} to ${responseMs(flow.inp.b)}${flow.rating && flow.rating.a !== flow.rating.b ? ` (${ratingLabel(flow.rating.a)} → ${ratingLabel(flow.rating.b)})` : ''}`);
    }
    if (verdict(flow.mainThread) !== 'same') {
      pieces.push(`main-thread time ${verdict(flow.mainThread) === 'better' ? 'fell' : 'rose'} ${pct(Math.abs(flow.mainThread.relative)).replace(/^[+−]/, '')} (${ms(flow.mainThread.a)} → ${ms(flow.mainThread.b)}; 95% CI ${pct(flow.mainThread.relativeLow)} to ${pct(flow.mainThread.relativeHigh)})`);
    }
    if (verdict(flow.tbt) === 'better' && flow.tbt.a >= 50) pieces.push(`blocking time ${ms(flow.tbt.a)} → ${ms(flow.tbt.b)}`);
    parts.push(pieces.length ? `On ${item.profile} (${item.scenario}), ${pieces.join(', ')}.` : `On ${item.profile} (${item.scenario}), no measurable change in timing.`);
  }
  return parts.join(' ');
}

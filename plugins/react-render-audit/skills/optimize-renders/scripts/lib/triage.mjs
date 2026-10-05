// Time first. Before any code changes, the timing benchmark profiles the current app (no render
// tracker in the page), and this module decides which scenario steps are slow enough for users to
// notice, and whether React re-rendering is a big enough part of them for re-render fixes to help.
// The render analysis then ranks fixes by the time they would save in those steps.
//
// A step is slow when an interaction in it takes more than 200 ms to respond (where Core Web Vitals
// INP stops being "good"), when a single frame in it takes more than 200 ms (the page is frozen
// longer than a good interaction may take), or, for a page load, when its blocking time is over
// 200 ms (where Lighthouse's Total Blocking Time stops being "good"). Each rule judges one
// interaction or frame at a time, so a step's verdict doesn't depend on how many keys it types.
// Re-rendering is a big part of a slow step when it takes at least 100 ms, or at least one frame
// and a fifth of the step's main-thread time. Production builds don't expose React's render time,
// so there the share is unknown.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ms, refreshAnalysis, responseMs } from './bench.mjs';
import { FRAME_MS, INSTANT_MS, THRESHOLDS, rating, ratingLabel } from './stats.mjs';
import { readJson, round, table } from './util.mjs';

export const SLOW_RESPONSE_MS = THRESHOLDS.INP[0];
export const SLOW_FRAME_MS = THRESHOLDS.INP[0];
export const SLOW_BLOCKING_MS = THRESHOLDS.TBT[0];
export const RENDER_SHARE = 0.2;

const median = (ci) => (ci && typeof ci.median === 'number' ? ci.median : 0);

// Where the step's main-thread time goes, biggest first. React's render phase is JavaScript, so
// it's taken out of the script time; the rest of the script time is the app's other code.
function timeSplit(step, timed) {
  const parts = timed
    ? [
        ['re-rendering', step.reactUpdates],
        ['first render', step.reactInitial],
        ['other script', Math.max(0, step.script - step.react)],
        ['style and layout', step.style + step.layout],
      ]
    : [
        ['script', step.script],
        ['style and layout', step.style + step.layout],
      ];
  return parts
    .filter(([, value]) => value >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, ms: round(value, 1) }));
}

// The scripts that ran in each run's worst long frame, merged across runs: the functions and
// files where time went outside React.
function frameScripts(runs, index) {
  const byKey = new Map();
  for (const run of runs) {
    const seen = new Set();
    for (const script of (run.steps[index] && run.steps[index].frameScripts) || []) {
      const file = String(script.source || '').replace(/[?#].*$/, '').split('/').pop() || '';
      const key = `${script.fn || ''}|${file}|${script.invoker || ''}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { fn: script.fn || '', file, invoker: script.invoker || '', times: [], runs: 0 };
        byKey.set(key, entry);
      }
      entry.times.push(script.ms);
      if (!seen.has(key)) entry.runs++;
      seen.add(key);
    }
  }
  return [...byKey.values()]
    .map((entry) => ({ fn: entry.fn, file: entry.file, invoker: entry.invoker, runs: entry.runs, ms: round(entry.times.sort((a, b) => a - b)[entry.times.length >> 1], 1) }))
    .filter((entry) => entry.runs * 2 >= runs.length)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3);
}

/**
 * Classifies one step of a profile run (`step` from analyzeSingle, `runs` the raw runs). `timed`
 * says whether React's render time was measurable (development builds); without it, whether a
 * slow step is slow because of re-rendering is unknown (renderBound null).
 */
export function classifyStep(step, runs = [], { timed = true } = {}) {
  const response = step.interactive && step.inp ? step.inp.median : null;
  const react = median(step.reactMs);
  const initial = Math.min(react, median(step.reactInitialMs));
  const out = {
    index: step.index,
    name: step.name,
    action: step.action,
    interactive: !!step.interactive,
    response: response === null ? null : { median: response, low: step.inp.low, high: step.inp.high, rating: rating('INP', response) },
    breakdown: step.breakdown || null,
    blocking: median(step.tbt),
    longFrames: median(step.longFrames),
    longestFrame: median(step.longestFrame),
    smoothness: step.smoothness ?? null,
    mainThread: median(step.mainThread),
    script: median(step.script),
    layout: median(step.layout),
    style: median(step.style),
    react,
    reactInitial: round(initial, 1),
    reactUpdates: round(Math.max(0, react - initial), 1),
  };
  out.renderShare = out.mainThread > 0 ? round(out.reactUpdates / out.mainThread, 2) : 0;
  out.reasons = [];
  if (step.action === 'goto') {
    if (out.blocking > SLOW_BLOCKING_MS) out.reasons.push(`blocks the page for ${ms(out.blocking)} while loading`);
  } else {
    if (response !== null && response > SLOW_RESPONSE_MS) out.reasons.push(`responds in ${responseMs(response)} (${ratingLabel(out.response.rating)})`);
    if (out.longestFrame > SLOW_FRAME_MS) out.reasons.push(`freezes the page for ${ms(out.longestFrame)} in one frame`);
  }
  out.slow = out.reasons.length > 0;
  const big = out.reactUpdates >= INSTANT_MS || (out.reactUpdates >= FRAME_MS && out.renderShare >= RENDER_SHARE);
  out.renderBound = !out.slow ? false : timed ? big : null;
  out.split = timeSplit(out, timed);
  out.scripts = out.slow ? frameScripts(runs, step.index) : [];
  return out;
}

const HINT = {
  'first render': 'the first render and hydration: react-loading-performance (split code, lazy-load what is below the fold, keep work on the server)',
  'other script': 'JavaScript outside React rendering, in event handlers, effects or libraries: react-responsiveness (break up long tasks, defer non-urgent work) and react-effects',
  'style and layout': 'style and layout recalculation: a large DOM or layout thrashing (react-large-lists, react-animation)',
};

function stepList(steps, { withCause = false, timed = true } = {}) {
  return steps
    .map((step) => {
      const worst = step.worst;
      const cause = withCause && worst.split[0] ? `; most of it is ${worst.split[0].label} (${ms(worst.split[0].ms)})` : '';
      const share = timed ? `; re-rendering ${ms(worst.reactUpdates)} of ${ms(worst.mainThread)} main-thread time` : `; ${ms(worst.mainThread)} of main-thread time`;
      return `“${step.name}” (${worst.profile}: ${worst.reasons[0]}${share}${cause})`;
    })
    .join('; ');
}

function slowestResponse(triage) {
  let slowest = null;
  for (const profile of triage.profiles) {
    for (const step of profile.steps) {
      if (step.response && (!slowest || step.response.median > slowest.value)) slowest = { value: step.response.median, rating: step.response.rating, profile: profile.profile };
    }
  }
  return slowest;
}

/** One sentence for a report's headline. */
function headlineOf(triage) {
  const slow = Object.values(triage.scenarios).flatMap((scenario) => scenario.steps.filter((step) => step && step.slow));
  const bound = slow.filter((step) => step.renderBound);
  const steps = `${slow.length} step${slow.length === 1 ? ' is' : 's are'} slow`;
  if (triage.decision === 'nothing-slow') {
    const slowest = slowestResponse(triage);
    return `Nothing in this flow is slow enough to notice${slowest ? `: the slowest response is ${responseMs(slowest.value)} (${ratingLabel(slowest.rating)}) on ${slowest.profile}` : ''}.`;
  }
  if (triage.decision === 'renders') return `${steps}, and re-rendering is a big part of ${bound.length < slow.length ? `${bound.length} of them` : slow.length === 1 ? 'it' : 'all of them'}.`;
  if (triage.decision === 'unknown') return `${steps}; whether re-rendering is why needs a development build.`;
  return `${steps}, but re-rendering is a small part of ${slow.length === 1 ? 'it' : 'each'}.`;
}

function summaryOf(triage) {
  const slow = Object.values(triage.scenarios).flatMap((scenario) => scenario.steps.filter((step) => step && step.slow));
  const parts = [];
  if (triage.decision === 'nothing-slow') {
    const slowest = slowestResponse(triage);
    parts.push(
      `Nothing in this flow is slow enough to notice: ${slowest ? `the slowest response is ${responseMs(slowest.value)} (${ratingLabel(slowest.rating)}) on ${slowest.profile}; ` : ''}no interaction takes more than ${SLOW_RESPONSE_MS} ms to respond, no frame more than ${SLOW_FRAME_MS} ms, and no page load blocks for more than ${SLOW_BLOCKING_MS} ms. Cutting re-renders here would not make it faster.`,
    );
  } else if (triage.decision === 'renders') {
    const bound = slow.filter((step) => step.renderBound);
    const which = bound.length < slow.length ? `${bound.length} of them` : slow.length === 1 ? 'it' : 'all of them';
    parts.push(`${slow.length} step${slow.length === 1 ? ' is' : 's are'} slow, and re-rendering is a big part of ${which}: ${stepList(bound)}. Next: measure renders and fix only what makes ${bound.length === 1 ? 'this step' : 'these steps'} slow.`);
    const other = slow.filter((step) => !step.renderBound);
    if (other.length) parts.push(`Re-render fixes won't help much with ${stepList(other, { withCause: true })}.`);
  } else if (triage.decision === 'unknown') {
    parts.push(`${slow.length} step${slow.length === 1 ? ' is' : 's are'} slow: ${stepList(slow, { timed: false })}. This build doesn't expose React's render time, so it can't show whether re-rendering is why; a triage of a development build can.`);
  } else {
    const causes = [...new Set(slow.map((step) => step.worst.split[0] && step.worst.split[0].label).filter((label) => HINT[label]))];
    parts.push(`${slow.length} step${slow.length === 1 ? ' is' : 's are'} slow, but re-rendering is a small part of ${slow.length === 1 ? 'it' : 'each'}: ${stepList(slow, { withCause: true })}. Re-render fixes won't make ${slow.length === 1 ? 'it' : 'them'} noticeably faster.${causes.length ? ` The time goes to ${causes.map((label) => HINT[label]).join('; and ')}.` : ''}`);
  }
  if (triage.build === 'development') parts.push('Measured on a development build, which runs slower than production: a step that is fast here is fast in production too, but a slow one may not be.');
  if (triage.build === 'production') parts.push('Measured on a production build.');
  return parts.join(' ');
}

/** Decides what's slow from a profile-mode benchmark result (bench with only --a). */
export function triageOf(result) {
  if (result.mode !== 'profile') throw new Error('Triage needs a profile run of the current code (one side only).');
  const profiles = result.results.map((item) => ({
    profile: item.profile,
    scenario: item.scenario,
    viewport: item.viewport,
    cpuRate: item.cpuRate,
    runs: item.pairs,
    react: item.react,
    // React's render time is only measurable in development builds.
    steps: item.analysis.steps.map((step) => classifyStep(step, item.runs.a, { timed: !!item.react && item.react.development !== false })),
  }));
  const scenarios = {};
  for (const profile of profiles) {
    const entry = scenarios[profile.scenario] || (scenarios[profile.scenario] = { steps: [] });
    for (const step of profile.steps) {
      const slot = entry.steps[step.index] || (entry.steps[step.index] = { index: step.index, name: step.name, slow: false, renderBound: false, profiles: [], worst: null });
      if (!step.slow) continue;
      slot.slow = true;
      slot.profiles.push(profile.profile);
      if (step.renderBound) slot.renderBound = true;
      else if (step.renderBound === null && !slot.renderBound) slot.renderBound = null;
      // Savings are estimated on the profile where React does the most work in this step.
      if (!slot.worst || step.react > slot.worst.reactMs) {
        slot.worst = { profile: profile.profile, reactMs: step.react, reactUpdates: step.reactUpdates, mainThread: step.mainThread, reasons: step.reasons, split: step.split };
      }
    }
  }
  const slow = Object.values(scenarios).flatMap((scenario) => scenario.steps.filter((step) => step && step.slow));
  const react = profiles.map((profile) => profile.react).find(Boolean);
  const triage = {
    version: 1,
    createdAt: new Date().toISOString(),
    bench: result.label,
    url: result.sides.a.url,
    sha: result.sides.a.sha || null,
    build: react ? (react.development ? 'development' : 'production') : null,
    environment: result.environment,
    calibration: result.calibration,
    profiles,
    scenarios,
    decision: !slow.length ? 'nothing-slow' : slow.some((step) => step.renderBound) ? 'renders' : slow.every((step) => step.renderBound === null) ? 'unknown' : 'not-renders',
  };
  triage.headline = headlineOf(triage);
  triage.summary = summaryOf(triage);
  return triage;
}

/**
 * The audit's triage. When its raw runs are still there, the verdicts are derived from them again,
 * as the benchmark's are, so the current rules apply to every report.
 */
export function readTriage(audit) {
  const saved = audit ? readJson(join(audit, 'triage.json'), null) : null;
  const file = saved && saved.bench ? join(audit, 'bench', saved.bench, 'bench.json') : null;
  if (!file || !existsSync(file)) return saved;
  try {
    return { ...triageOf(refreshAnalysis(readJson(file))), createdAt: saved.createdAt };
  } catch {
    return saved;
  }
}

/** The triage's steps for one scenario, by index, or null when the scenario wasn't triaged. */
export function triageSteps(triage, scenario) {
  const entry = triage && triage.scenarios && triage.scenarios[scenario];
  return entry ? entry.steps.filter(Boolean) : null;
}

const DECISION = {
  renders: 'FIX RENDERS: re-rendering makes a slow step slow.',
  'not-renders': 'NOT RE-RENDERS: steps are slow for other reasons.',
  unknown: "SLOW, CAUSE UNKNOWN: this build doesn't show React's render time.",
  'nothing-slow': 'NOTHING SLOW: no change needed for speed.',
};

/** Plain-text triage for the terminal. */
export function formatTriage(triage) {
  const lines = [`Triage: what is slow before anything changes (timing benchmark, no render tracker${triage.build ? `, React ${triage.build} build` : ''})`];
  if (triage.calibration) lines.push(`CPU calibration: ${triage.calibration.rate}× slowdown for mobile (BenchmarkIndex ${triage.calibration.hostIndex})`);
  for (const profile of triage.profiles) {
    const vp = profile.viewport;
    lines.push('', `${profile.scenario} — ${profile.profile} (${vp.width}×${vp.height}, CPU ${profile.cpuRate}×), ${profile.runs} runs, medians`);
    const rows = [['#', 'step', 'response', 'rating', 'blocking', 'longest frame', 're-render', 'first render', 'main thread', 'verdict']];
    for (const step of profile.steps) {
      rows.push([
        step.index,
        step.name,
        step.response ? responseMs(step.response.median) : '—',
        step.response ? ratingLabel(step.response.rating) : '',
        ms(step.blocking),
        step.longFrames ? ms(step.longestFrame) : '—',
        ms(step.reactUpdates),
        step.reactInitial ? ms(step.reactInitial) : '—',
        ms(step.mainThread),
        step.slow ? (step.renderBound ? 'SLOW, re-rendering' : step.renderBound === null ? 'SLOW' : 'SLOW, not re-rendering') : 'ok',
      ]);
    }
    lines.push(table(rows, { indent: '  ' }));
    for (const step of profile.steps.filter((item) => item.slow)) {
      lines.push(`  ${step.index}. ${step.name}: ${step.reasons.join(', ')}; time goes to ${step.split.map((part) => `${part.label} ${ms(part.ms)}`).join(', ') || 'nothing measured'}`);
      if (step.scripts.length) lines.push(`     long-frame scripts: ${step.scripts.map((script) => `${script.fn || '(anonymous)'}${script.file ? ` in ${script.file}` : ''}${script.invoker ? ` [${script.invoker}]` : ''} ${ms(script.ms)}`).join('; ')}`);
    }
  }
  lines.push('', `Decision: ${DECISION[triage.decision]}`, triage.summary);
  return lines.join('\n');
}

/** Markdown triage for report.md. */
export function triageMarkdown(triage) {
  const md = ['## Is anything slow?', '', triage.summary, ''];
  for (const profile of triage.profiles) {
    md.push(`**${profile.scenario} — ${profile.profile}** (CPU ${profile.cpuRate}×, ${profile.runs} runs)`, '');
    md.push('| # | Step | Response | Blocking | Re-render | Main thread | Verdict |', '|---:|---|---|---:|---:|---:|---|');
    for (const step of profile.steps) {
      md.push(`| ${step.index} | ${step.name.replace(/\|/g, '\\|')} | ${step.response ? `${responseMs(step.response.median)} (${ratingLabel(step.response.rating)})` : '—'} | ${ms(step.blocking)} | ${ms(step.reactUpdates)} | ${ms(step.mainThread)} | ${step.slow ? `**slow**: ${step.reasons.join(', ')}` : 'ok'} |`);
    }
    md.push('');
  }
  return md.join('\n');
}

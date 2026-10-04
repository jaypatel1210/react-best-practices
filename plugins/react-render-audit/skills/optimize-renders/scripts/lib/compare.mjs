// Compares a measurement with the baseline: did behavior stay the same at every step (visible
// text, accessibility tree, DOM, network requests, console errors), and did renders go down?
// Lines that already differ between baseline runs (clocks, random ids) are learned as noise and
// ignored, so only differences the change introduced are reported.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { aggregate, loadRuns, scenariosOf } from './analyze.mjs';
import { percentChange, round, table, writeJson } from './util.mjs';

const SNAPSHOT_CHANNELS = ['text', 'a11y', 'dom'];
const FAILING_CONSOLE = /^(error|exception|assert|warning|log-error):/;

function countLines(text) {
  const counts = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    counts.set(line, (counts.get(line) || 0) + 1);
  }
  return counts;
}

/** What the baseline runs agree on for one step and channel. */
export function noiseModel(baselineValues) {
  const maps = baselineValues.map(countLines);
  const all = new Set();
  for (const map of maps) for (const line of map.keys()) all.add(line);
  const stable = new Map();
  const noisy = new Set();
  for (const line of all) {
    const counts = maps.map((map) => map.get(line) || 0);
    if (counts.every((count) => count === counts[0])) stable.set(line, counts[0]);
    else noisy.add(line);
  }
  // A clock or a counter shows a new value in every run; remember the shape of noisy lines so
  // the next value ("12:05", "3 minutes ago") is recognized as the same noise.
  const noisyShapes = new Set([...noisy].map(shape));
  return { stable, noisy, noisyShapes, reference: baselineValues[0] || '' };
}

function shape(line) {
  return line.replace(/\d+/g, '#');
}

export function diffAgainst(model, value, { checkOrder = true } = {}) {
  const after = countLines(value);
  const removed = [];
  const added = [];
  for (const [line, count] of model.stable) {
    const got = after.get(line) || 0;
    for (let i = got; i < count; i++) removed.push(line);
    for (let i = count; i < got; i++) added.push(line);
  }
  for (const [line, count] of after) {
    if (model.stable.has(line) || model.noisy.has(line) || (model.noisyShapes && model.noisyShapes.has(shape(line)))) continue;
    for (let i = 0; i < count; i++) added.push(line);
  }
  let reordered = false;
  if (checkOrder && !removed.length && !added.length) {
    const keep = (text) => String(text || '').split('\n').filter((line) => line.trim() && model.stable.has(line));
    reordered = keep(model.reference).join('\n') !== keep(value).join('\n');
  }
  return {
    same: !removed.length && !added.length && !reordered,
    removed: removed.slice(0, 10),
    added: added.slice(0, 10),
    removedCount: removed.length,
    addedCount: added.length,
    reordered,
  };
}

function worst(results) {
  return results.find((result) => !result.same) || results[0] || { same: true, removed: [], added: [], removedCount: 0, addedCount: 0, reordered: false };
}

function compareStepBehavior(index, base, after) {
  const channels = {};
  for (const channel of SNAPSHOT_CHANNELS) {
    const model = noiseModel(base.snaps.map((snap) => (snap.steps[index] || {})[channel] || ''));
    channels[channel] = worst(after.snaps.map((snap) => diffAgainst(model, (snap.steps[index] || {})[channel] || '')));
  }
  const requests = (run) => ((run.steps[index] || {}).network || []).join('\n');
  const networkModel = noiseModel(base.runs.map(requests));
  channels.network = worst(after.runs.map((run) => diffAgainst(networkModel, requests(run), { checkOrder: false })));
  const before = new Set(base.runs.flatMap((run) => (run.steps[index] || {}).console || []));
  const introduced = [...new Set(after.runs.flatMap((run) => (run.steps[index] || {}).console || []))].filter((message) => !before.has(message) && FAILING_CONSOLE.test(message));
  channels.console = { same: introduced.length === 0, added: introduced.slice(0, 10), addedCount: introduced.length, removed: [], removedCount: 0, reordered: false };
  return channels;
}

function stepSum(steps, field) {
  return round(steps.reduce((sum, step) => sum + (step[field] || 0), 0), 1);
}

function componentTotals(aggregated) {
  const totals = new Map();
  for (const step of aggregated.steps) {
    for (const comp of step.components) {
      const entry = totals.get(comp.key) || { renders: 0, wasted: 0 };
      entry.renders += comp.renders;
      entry.wasted += comp.wasted;
      totals.set(comp.key, entry);
    }
  }
  return totals;
}

export function compareScenario(config, { base, after, prev, scenario, allowDom = false }) {
  const dir = (label) => join(config.audit, 'runs', label, scenario);
  const baseData = loadRuns(dir(base));
  const afterData = loadRuns(dir(after));
  const prevData = prev && prev !== base ? loadRuns(dir(prev)) : baseData;
  const options = { scope: config.scope || [], repoRoot: config.repoRoot };
  const baseAgg = aggregate(baseData, options);
  const afterAgg = aggregate(afterData, options);
  const prevAgg = prevData === baseData ? baseAgg : aggregate(prevData, options);

  const stepCount = baseAgg.steps.length;
  if (afterAgg.steps.length !== stepCount) {
    throw new Error(`Scenario "${scenario}" has ${stepCount} steps in ${base} but ${afterAgg.steps.length} in ${after}; measure both with the same scenario file.`);
  }

  const steps = baseAgg.steps.map((step, index) => {
    const behavior = compareStepBehavior(index, baseData, afterData);
    const domOnly = behavior.text.same && behavior.a11y.same && behavior.network.same && behavior.console.same && !behavior.dom.same;
    const equivalent = Object.values(behavior).every((channel) => channel.same) || (allowDom && domOnly);
    const pick = (agg) => {
      const s = agg.steps[index];
      return { renders: s.renders, scopeRenders: s.scopeRenders, scopeCaused: s.scopeCaused, wasted: s.wasted, remounts: s.remounts, cascades: s.cascades, commits: s.commits, longFrameMs: s.longFrameMs, interactionMs: s.interactionMs };
    };
    return { index, name: step.name, before: pick(prevAgg), after: pick(afterAgg), baseline: pick(baseAgg), behavior, equivalent, domOnly };
  });

  // Decisions use every component's renders across all steps: a fix in the scope usually saves
  // most of its renders in components that live elsewhere (design-system primitives, libraries).
  const metric = 'renders';
  const totals = {};
  for (const field of ['renders', 'wasted', 'scopeRenders', 'scopeCaused', 'remounts', 'cascades', 'commits']) {
    totals[field] = { baseline: stepSum(baseAgg.steps, field), before: stepSum(prevAgg.steps, field), after: stepSum(afterAgg.steps, field) };
  }
  totals.longFrameMs = {
    baseline: Math.max(0, ...baseAgg.steps.map((step) => step.longFrameMs)),
    before: Math.max(0, ...prevAgg.steps.map((step) => step.longFrameMs)),
    after: Math.max(0, ...afterAgg.steps.map((step) => step.longFrameMs)),
  };

  const beforeComponents = componentTotals(prevAgg);
  const afterComponents = componentTotals(afterAgg);
  const infoOf = (key) => afterAgg.components.get(key) || prevAgg.components.get(key) || { name: key, file: null };
  const deltas = [];
  for (const key of new Set([...beforeComponents.keys(), ...afterComponents.keys()])) {
    const b = beforeComponents.get(key) || { renders: 0, wasted: 0 };
    const a = afterComponents.get(key) || { renders: 0, wasted: 0 };
    if (b.renders === a.renders) continue;
    const info = infoOf(key);
    deltas.push({ key, name: info.name, file: info.file, category: info.category, before: round(b.renders, 1), after: round(a.renders, 1), isNew: !beforeComponents.has(key), gone: !afterComponents.has(key) });
  }
  // A component that moved to another file shows up as gone + new under the same name.
  for (const added of deltas.filter((delta) => delta.isNew)) {
    const gone = deltas.find((delta) => delta.gone && delta.name === added.name && !delta.paired);
    if (!gone) continue;
    gone.paired = true;
    added.isNew = false;
    added.movedFrom = gone.file;
    added.before = gone.before;
  }
  for (let i = deltas.length - 1; i >= 0; i--) {
    const delta = deltas[i];
    if (delta.paired || delta.before === delta.after) deltas.splice(i, 1);
  }
  deltas.sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before));

  const changedSteps = steps.filter((step) => !step.equivalent);
  const m = totals[metric];
  const regressed = m.after > m.before * 1.02 + 2 || totals.wasted.after > totals.wasted.before * 1.02 + 2;
  const improved =
    m.after < m.before || totals.wasted.after < totals.wasted.before || totals.remounts.after < totals.remounts.before || totals.cascades.after < totals.cascades.before || totals.commits.after < totals.commits.before;
  let verdict = 'PASS';
  let exitCode = 0;
  if (changedSteps.length) {
    verdict = 'BEHAVIOR CHANGED';
    exitCode = 3;
  } else if (regressed) {
    verdict = 'REGRESSED';
    exitCode = 4;
  } else if (!improved) {
    verdict = 'NO IMPROVEMENT';
    exitCode = 5;
  }
  return { scenario, base, after, prev: prev || base, metric, steps, totals, deltas, verdict, exitCode, allowDom };
}

export function compareLabels(config, { base = 'baseline', after, prev, allowDom = false }) {
  const shared = scenariosOf(config.audit, after).filter((name) => existsSync(join(config.audit, 'runs', base, name)));
  if (!shared.length) throw new Error(`No scenario was measured under both "${base}" and "${after}".`);
  const scenarios = shared.map((scenario) => compareScenario(config, { base, after, prev, scenario, allowDom }));
  const exitCode = scenarios.reduce((code, result) => (result.exitCode && (!code || result.exitCode === 3) ? result.exitCode : code), 0);
  const result = { base, after, prev: prev || base, comparedAt: new Date().toISOString(), scenarios, verdict: exitCode ? scenarios.find((s) => s.exitCode === exitCode).verdict : 'PASS', exitCode };
  writeJson(join(config.audit, 'compare', `${after}.json`), result);
  return result;
}

const arrow = (before, after, unit = '') => (before === after ? `${before}${unit}` : `${before}${unit} → ${after}${unit}`);

export function formatCompare(result) {
  const lines = [];
  lines.push(`Compare "${result.after}" with "${result.base}" (behavior)${result.prev !== result.base ? ` and "${result.prev}" (renders)` : ''}`);
  for (const scenario of result.scenarios) {
    lines.push('', `Scenario ${scenario.scenario}:`);
    const rows = [['#', 'step', 'renders', 'wasted', 'from scope', 'remounts', 'longest frame', 'behavior']];
    for (const step of scenario.steps) {
      const changed = Object.entries(step.behavior).filter(([, channel]) => !channel.same).map(([name]) => name);
      rows.push([
        step.index,
        step.name,
        `${arrow(step.before.renders, step.after.renders)}${step.before.renders !== step.after.renders ? ` ${percentChange(step.before.renders, step.after.renders)}` : ''}`,
        arrow(step.before.wasted, step.after.wasted),
        arrow(step.before.scopeCaused || 0, step.after.scopeCaused || 0),
        arrow(step.before.remounts || 0, step.after.remounts || 0),
        step.before.longFrameMs || step.after.longFrameMs ? arrow(step.before.longFrameMs, step.after.longFrameMs, ' ms') : '—',
        changed.length ? `CHANGED (${changed.join(', ')})${step.equivalent ? ' allowed' : ''}` : 'same',
      ]);
    }
    lines.push(table(rows, { indent: '  ' }));
    const t = scenario.totals;
    lines.push(
      `  Totals (all steps): renders ${arrow(t.renders.before, t.renders.after)} (${percentChange(t.renders.before, t.renders.after)}), wasted ${arrow(t.wasted.before, t.wasted.after)}, started from scope ${arrow(t.scopeCaused.before, t.scopeCaused.after)}, remounts ${arrow(t.remounts.before, t.remounts.after)}, effect cascades ${arrow(t.cascades.before, t.cascades.after)}, commits ${arrow(t.commits.before, t.commits.after)}`,
    );
    if (result.prev !== result.base) lines.push(`  Since baseline: renders ${arrow(t.renders.baseline, t.renders.after)} (${percentChange(t.renders.baseline, t.renders.after)})`);
    const drops = scenario.deltas.filter((delta) => delta.after < delta.before).slice(0, 6);
    const rises = scenario.deltas.filter((delta) => delta.after > delta.before).slice(0, 6);
    if (drops.length) lines.push(`  Fewer renders: ${drops.map((delta) => `${delta.name} ${delta.before} → ${delta.after}`).join(', ')}`);
    if (rises.length) lines.push(`  More renders:  ${rises.map((delta) => `${delta.name} ${delta.before} → ${delta.after}${delta.isNew ? ' (new component)' : ''}`).join(', ')}`);

    for (const step of scenario.steps.filter((s) => Object.values(s.behavior).some((channel) => !channel.same))) {
      lines.push(`  Step ${step.index} "${step.name}" differs from baseline:`);
      for (const [channel, diff] of Object.entries(step.behavior)) {
        if (diff.same) continue;
        if (diff.reordered) lines.push(`    ${channel}: same content, different order`);
        for (const line of diff.removed) lines.push(`    ${channel} − ${line.trim().slice(0, 140)}`);
        for (const line of diff.added) lines.push(`    ${channel} + ${line.trim().slice(0, 140)}`);
        const more = diff.removedCount + diff.addedCount - diff.removed.length - diff.added.length;
        if (more > 0) lines.push(`    ${channel}: … ${more} more line(s)`);
      }
    }
  }
  lines.push('');
  const explain = {
    PASS: 'behavior identical at every step and renders went down. Keep the change.',
    'BEHAVIOR CHANGED': 'the page behaves differently. Revert the change, or fix it and measure again. If the only difference is in the DOM and is intended (e.g. a hashed class name), re-run compare with --allow-dom and say why in the change log.',
    REGRESSED: 'behavior is the same but renders went up. Revert the change.',
    'NO IMPROVEMENT': 'behavior is the same but nothing measurable improved. Revert unless it is a prerequisite for the next fix.',
  };
  lines.push(`Verdict: ${result.verdict} — ${explain[result.verdict]}`);
  return lines.join('\n');
}

// Builds the before/after report (self-contained HTML plus Markdown) from an audit directory:
// the baseline, the final measurement, the change log and the comparisons.
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { analyzeScenario, scenariosOf } from './analyze.mjs';
import { readChanges } from './changes.mjs';
import { compareScenario } from './compare.mjs';
import { percentChange, readJson, round } from './util.mjs';

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function labelsOf(audit) {
  const dir = join(audit, 'runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, time: statSync(join(dir, entry.name)).mtimeMs }))
    .sort((a, b) => a.time - b.time)
    .map((entry) => entry.name);
}

function pickFinal(audit, changes, requested) {
  if (requested) return requested;
  const kept = changes.filter((change) => change.status === 'kept' && change.measure);
  if (kept.length) return kept[kept.length - 1].measure;
  return null;
}

function delta(before, after, { unit = '', lowerIsBetter = true } = {}) {
  if (before === after) return `<span class="same">${unit && !after ? '—' : `${esc(after)}${unit}`}</span>`;
  const better = lowerIsBetter ? after < before : after > before;
  return `<span class="was">${esc(before)}${unit}</span> → <strong>${esc(after)}${unit}</strong> <span class="${better ? 'good' : 'bad'}">${percentChange(before, after)}</span>`;
}

function tile(label, before, after, { unit = '', hasAfter }) {
  if (unit && !before && !after) return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">—</div><div class="tile-change">none over 50 ms</div></div>`;
  const value = hasAfter
    ? `<div class="tile-value">${esc(after)}${unit}</div><div class="tile-change">${before === after ? 'unchanged' : `${esc(before)}${unit} before · <span class="${after < before ? 'good' : 'bad'}">${percentChange(before, after)}</span>`}</div>`
    : `<div class="tile-value">${esc(before)}${unit}</div><div class="tile-change">baseline</div>`;
  return `<div class="tile"><div class="tile-label">${esc(label)}</div>${value}</div>`;
}

function bars(rows) {
  const max = Math.max(1, ...rows.flatMap((row) => [row.before, row.after ?? 0]));
  return rows
    .map((row) => {
      const before = (row.before / max) * 100;
      const after = row.after === undefined ? null : (row.after / max) * 100;
      return `<div class="bar-row"><div class="bar-name" title="${esc(row.where)}">${esc(row.name)}${row.note ? ` <span class="muted">${esc(row.note)}</span>` : ''}</div><div class="bar-track"><div class="bar before" style="width:${before.toFixed(1)}%"></div>${after === null ? '' : `<div class="bar after" style="width:${after.toFixed(1)}%"></div>`}</div><div class="bar-num">${after === null ? esc(row.before) : `${esc(row.before)} → ${esc(row.after)}`}</div></div>`;
    })
    .join('');
}

const CSS = `
:root{--bg:#fbfbfa;--panel:#fff;--text:#1d1d1f;--muted:#6b6b70;--line:#e6e4e0;--accent:#4f46e5;--accent-soft:#e0e7ff;--before:#c9c6bf;--good:#0f7b45;--bad:#b42318;--code:#f4f3f0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121214;--panel:#1b1b1f;--text:#ececef;--muted:#9a9aa3;--line:#2c2c33;--accent:#8b8cf8;--accent-soft:#2a2a52;--before:#4a4a52;--good:#4ade80;--bad:#f87171;--code:#232329}}
:root[data-theme="dark"]{--bg:#121214;--panel:#1b1b1f;--text:#ececef;--muted:#9a9aa3;--line:#2c2c33;--accent:#8b8cf8;--accent-soft:#2a2a52;--before:#4a4a52;--good:#4ade80;--bad:#f87171;--code:#232329}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;padding:40px 16px 64px}
.eyebrow{color:var(--accent);font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:12px;margin:0}
h1{font-size:30px;margin:4px 0 6px}h2{font-size:21px;margin:40px 0 8px}h3{font-size:16px;margin:0 0 6px}
.meta,.muted{color:var(--muted)}.meta{margin:0}
.verdict{margin:18px 0 0;padding:12px 14px;border-radius:10px;background:var(--accent-soft);border:1px solid var(--line)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:22px 0}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.tile-label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}.tile-value{font-size:26px;font-weight:650;margin-top:4px}.tile-change{font-size:13px;color:var(--muted)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
.good{color:var(--good);font-weight:600}.bad{color:var(--bad);font-weight:600}.was{color:var(--muted)}.same{color:var(--muted)}
.ok{color:var(--good)}.fail{color:var(--bad);font-weight:600}
.bar-row{display:grid;grid-template-columns:minmax(120px,220px) 1fr auto;gap:10px;align-items:center;margin:6px 0;font-size:13px}
.bar-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-track{position:relative;height:16px}
.bar{position:absolute;left:0;height:7px;border-radius:4px}.bar.before{top:0;background:var(--before)}.bar.after{top:9px;background:var(--accent)}
.bar-num{font-variant-numeric:tabular-nums;color:var(--muted);white-space:nowrap}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted)}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.change{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:10px 0}
.badge{display:inline-block;font-size:12px;font-weight:600;border-radius:999px;padding:1px 9px;margin-right:6px;border:1px solid var(--line)}
.badge.kept{color:var(--good)}.badge.reverted,.badge.skipped{color:var(--bad)}.badge.proposed{color:var(--accent)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}code{background:var(--code);padding:1px 5px;border-radius:5px}
pre{background:var(--code);padding:12px;border-radius:8px;overflow-x:auto;white-space:pre}
details summary{cursor:pointer;color:var(--accent);margin-top:6px}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}.shots figure{margin:0}.shots img{width:100%;border:1px solid var(--line);border-radius:8px}.shots figcaption{font-size:12px;color:var(--muted)}
ul.tight{margin:6px 0;padding-left:20px}
footer{margin-top:48px;color:var(--muted);font-size:13px}
@media (max-width:640px){h1{font-size:24px}.bar-row{grid-template-columns:110px 1fr}.bar-num{grid-column:2}}
`;

export function writeReport(config, { final: requested } = {}) {
  const audit = config.audit;
  const changes = readChanges(audit);
  const labels = labelsOf(audit);
  if (!labels.includes('baseline')) throw new Error(`No baseline in ${audit}/runs. Measure with --label baseline first.`);
  const final = pickFinal(audit, changes, requested);
  if (final && !labels.includes(final)) throw new Error(`--final ${final} was never measured (have: ${labels.join(', ')})`);
  const rel = (file) => (file ? relative(config.appRoot, file) || '.' : '');
  const project = (config.detected && config.detected.name) || basename(config.appRoot);

  const scenarios = scenariosOf(audit, 'baseline').map((scenario) => {
    const baseline = analyzeScenario(config, 'baseline', scenario);
    const hasFinal = final && existsSync(join(audit, 'runs', final, scenario));
    const after = hasFinal ? analyzeScenario(config, final, scenario) : null;
    const comparison = hasFinal ? compareScenario(config, { base: 'baseline', after: final, scenario }) : null;
    return { scenario, baseline, after, comparison };
  });

  const sum = (pick) => scenarios.reduce((total, item) => total + pick(item), 0);
  const scoped = (config.scope || []).length > 0;
  const metric = 'renders';
  const hasAfter = scenarios.some((item) => item.after);
  const B = (field) => round(sum((item) => item.baseline.totals[field]), 1);
  const A = (field) => round(sum((item) => (item.after || item.baseline).totals[field]), 1);
  const maxOf = (field, which) => Math.max(0, ...scenarios.map((item) => (which === 'after' ? item.after || item.baseline : item.baseline).totals[field]));
  const allSteps = scenarios.flatMap((item) => (item.comparison ? item.comparison.steps : []));
  const changedSteps = allSteps.filter((step) => !step.equivalent);
  const kept = changes.filter((change) => change.status === 'kept');
  const meta = scenarios[0] ? scenarios[0].baseline.meta : {};
  const react = scenarios[0] ? scenarios[0].baseline.react : null;
  const date = new Date().toISOString().slice(0, 10);

  let headline;
  const fromScope = scoped ? ` ${B('scopeCaused')} of them were started by state inside the scope.` : '';
  if (!hasAfter) headline = `Baseline only: ${B('renders')} component renders across the scenario steps, ${B('wasted')} of them wasted.${fromScope} No code was changed; the hotspots below are what to fix first.`;
  else {
    const before = B(metric);
    const after = A(metric);
    headline = `Component renders across the scenario steps went from ${before} to ${after} (${percentChange(before, after)}), wasted renders from ${B('wasted')} to ${A('wasted')}, with ${kept.length} kept change${kept.length === 1 ? '' : 's'}. ${changedSteps.length ? `${changedSteps.length} step(s) behaved differently; see below.` : `Behavior was identical at all ${allSteps.length} steps (text, accessibility tree, DOM, network, console).`}`;
  }

  const html = [];
  html.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Re-render audit</title><style>${CSS}</style></head><body><main>`);
  html.push(`<p class="eyebrow">React re-render audit</p><h1>${esc(project)}</h1>`);
  const appPath = relative(config.repoRoot || config.appRoot, config.appRoot) || basename(config.appRoot);
  html.push(`<p class="meta"><code>${esc(appPath)}</code> · ${date} · ${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'}${scoped ? ` · scope: ${config.scope.map((dir) => `<code>${esc(rel(dir))}</code>`).join(', ')}` : ''}</p>`);
  html.push(`<p class="verdict">${esc(headline)}</p>`);
  html.push('<section class="tiles">');
  html.push(tile('Component renders', B(metric), A(metric), { hasAfter }));
  html.push(tile('Wasted renders', B('wasted'), A('wasted'), { hasAfter }));
  if (scoped) html.push(tile('Started from scope', B('scopeCaused'), A('scopeCaused'), { hasAfter }));
  html.push(tile('Remounts', B('remounts'), A('remounts'), { hasAfter }));
  html.push(tile('Effect cascades', B('cascades'), A('cascades'), { hasAfter }));
  if (!scoped) html.push(tile('React commits', B('commits'), A('commits'), { hasAfter }));
  html.push(tile('Longest frame', maxOf('longFrameMs', 'before'), maxOf('longFrameMs', 'after'), { unit: ' ms', hasAfter }));
  html.push('</section>');

  for (const item of scenarios) {
    const description = item.baseline.meta.description;
    html.push(`<h2>Scenario: ${esc(item.scenario)}</h2>${description ? `<p class="muted">${esc(description)}</p>` : ''}`);
    html.push('<div class="panel"><table><thead><tr><th>#</th><th>Step</th><th>Renders</th><th>Wasted</th>' + (scoped ? '<th title="Renders started by state inside the scope">From scope</th>' : '') + '<th>Remounts</th><th>Longest frame</th>' + (item.comparison ? '<th>Behavior</th>' : '') + '</tr></thead><tbody>');
    item.baseline.steps.forEach((step, index) => {
      const a = item.after ? item.after.steps[index] : null;
      const cmp = item.comparison ? item.comparison.steps[index] : null;
      const changed = cmp ? Object.entries(cmp.behavior).filter(([, channel]) => !channel.same).map(([name]) => name) : [];
      html.push(
        `<tr><td>${step.index}</td><td>${esc(step.name)}</td><td>${a ? delta(step.renders, a.renders) : esc(step.renders)}</td><td>${a ? delta(step.wasted, a.wasted) : esc(step.wasted)}</td>${scoped ? `<td>${a ? delta(step.scopeCaused || 0, a.scopeCaused || 0) : esc(step.scopeCaused || 0)}</td>` : ''}<td>${a ? delta(step.remounts || 0, a.remounts || 0) : esc(step.remounts || 0)}</td><td>${a ? delta(step.longFrameMs, a.longFrameMs, { unit: ' ms' }) : step.longFrameMs ? `${esc(step.longFrameMs)} ms` : '—'}</td>${cmp ? `<td>${changed.length ? `<span class="fail">changed: ${esc(changed.join(', '))}</span>` : '<span class="ok">same</span>'}</td>` : ''}</tr>`,
      );
    });
    html.push('</tbody></table></div>');

    // Components ranked by baseline renders across all steps, wherever they live: a fix in the
    // scope often removes renders of shared components (design system, libraries).
    const info = new Map([...item.baseline.components, ...(item.after ? item.after.components : [])].map((component) => [component.key, component]));
    const afterTotals = new Map((item.after ? item.after.byComponent : []).map((entry) => [entry.key, entry.renders]));
    const rows = item.baseline.byComponent.slice(0, 12).map((entry) => {
      const component = info.get(entry.key) || { name: entry.key };
      const where = component.file ? `${rel(component.file)}:${component.line || ''}` : '';
      let note = '';
      if (component.category === 'scope') note = 'in scope';
      else if (component.category === 'external') note = 'library';
      else if (component.file) note = relative(config.repoRoot || config.appRoot, component.file).split(/[\\/]/).slice(0, 2).join('/');
      return { name: component.name, note, where, before: round(entry.renders, 1), after: item.after ? round(afterTotals.get(entry.key) || 0, 1) : undefined };
    });
    if (rows.length) {
      html.push('<div class="panel"><h3>Most rendered components</h3>');
      if (item.after) html.push('<div class="legend"><span><i style="background:var(--before)"></i>before</span><span><i style="background:var(--accent)"></i>after</span></div>');
      html.push(bars(rows));
      html.push('</div>');
    }

    const shots = item.baseline.steps.map((step) => {
      const file = (label) => join('runs', label, item.scenario, 'screens', 'run-1', `step-${String(step.index).padStart(2, '0')}.jpg`);
      const beforeShot = existsSync(join(audit, file('baseline'))) ? file('baseline') : null;
      const afterShot = final && existsSync(join(audit, file(final))) ? file(final) : null;
      return { step, beforeShot, afterShot };
    }).filter((shot) => shot.beforeShot);
    if (shots.length) {
      html.push('<details><summary>Screenshots at each step</summary>');
      for (const shot of shots) {
        html.push(`<h3 style="margin-top:14px">${esc(shot.step.index)}. ${esc(shot.step.name)}</h3><div class="shots"><figure><img loading="lazy" src="${esc(shot.beforeShot)}" alt="Before: ${esc(shot.step.name)}"><figcaption>baseline</figcaption></figure>${shot.afterShot ? `<figure><img loading="lazy" src="${esc(shot.afterShot)}" alt="After: ${esc(shot.step.name)}"><figcaption>${esc(final)}</figcaption></figure>` : ''}</div>`);
      }
      html.push('</details>');
    }

    if (item.comparison) {
      for (const step of item.comparison.steps.filter((s) => Object.values(s.behavior).some((channel) => !channel.same))) {
        html.push(`<div class="panel"><h3 class="fail">Step ${esc(step.index)} "${esc(step.name)}" differs from the baseline</h3><pre>`);
        for (const [channel, diff] of Object.entries(step.behavior)) {
          if (diff.same) continue;
          if (diff.reordered) html.push(esc(`${channel}: same content, different order\n`));
          for (const line of diff.removed) html.push(esc(`${channel} − ${line.trim()}\n`));
          for (const line of diff.added) html.push(esc(`${channel} + ${line.trim()}\n`));
        }
        html.push('</pre></div>');
      }
    }
  }

  html.push('<h2>Changes</h2>');
  if (!changes.length) html.push('<p class="muted">No changes were made in this audit.</p>');
  for (const change of changes) {
    const impact = change.measure && existsSync(join(audit, 'compare', `${change.measure}.json`)) ? readJson(join(audit, 'compare', `${change.measure}.json`)) : null;
    const impactText = impact
      ? impact.scenarios
          .map((scenario) => `${scenario.scenario}: renders ${scenario.totals.renders.before} → ${scenario.totals.renders.after} (${percentChange(scenario.totals.renders.before, scenario.totals.renders.after)}), behavior ${scenario.steps.every((step) => step.equivalent) ? 'identical' : 'changed'}`)
          .join('; ')
      : '';
    const gates = Object.entries(change.gates || {}).map(([name, result]) => `${name}: ${result}`).join(' · ');
    html.push(`<div class="change"><h3><span class="badge ${esc(change.status)}">${esc(change.status)}</span>${esc(change.title)}</h3>`);
    html.push('<ul class="tight">');
    if (change.component || change.file) html.push(`<li>${change.component ? `<code>${esc(change.component)}</code>` : ''}${change.file ? ` in <code>${esc(rel(change.file))}</code>` : ''}</li>`);
    if (change.skill || change.rule) html.push(`<li>${change.skill ? `<code>${esc(change.skill)}</code>` : ''}${change.rule ? `: ${esc(change.rule)}` : ''}${change.safety ? ` <span class="muted">(${esc(change.safety)})</span>` : ''}</li>`);
    if (impactText) html.push(`<li>${esc(impactText)}</li>`);
    if (gates) html.push(`<li>Checks: ${esc(gates)}</li>`);
    if (change.commit) html.push(`<li>Commit <code>${esc(change.commit.slice(0, 12))}</code></li>`);
    if (change.reason) html.push(`<li>${esc(change.reason)}</li>`);
    html.push('</ul>');
    if (change.diff) html.push(`<details><summary>Diff</summary><pre>${esc(change.diff)}</pre></details>`);
    html.push('</div>');
  }

  const remaining = scenarios.flatMap((item) => (item.after || item.baseline).hotspots.filter((hotspot) => hotspot.inScope).map((hotspot) => ({ ...hotspot, scenario: item.scenario })));
  html.push(`<h2>${hasAfter ? 'Remaining opportunities' : 'Hotspots found'}</h2>`);
  if (!remaining.length) html.push('<p class="muted">Nothing left above the thresholds inside the scope.</p>');
  else {
    html.push('<div class="panel"><table><thead><tr><th>Hotspot</th><th>Fix</th><th>Skill</th><th>Safety</th></tr></thead><tbody>');
    for (const hotspot of remaining.slice(0, 15)) {
      html.push(`<tr><td><strong>${esc(hotspot.title)}</strong><br><span class="muted">${esc(hotspot.fixIn || hotspot.component)}${hotspot.file ? ` · ${esc(rel(hotspot.file))}${hotspot.line ? `:${esc(hotspot.line)}` : ''}` : ''}</span><ul class="tight">${hotspot.evidence.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></td><td>${esc(hotspot.fix)}</td><td><code>${esc(hotspot.skill)}</code><br><span class="muted">${esc(hotspot.rule)}</span></td><td>${esc(hotspot.safety)}</td></tr>`);
    }
    html.push('</tbody></table></div>');
  }

  html.push('<h2>How this was measured</h2><div class="panel"><ul class="tight">');
  html.push(`<li>Each scenario was replayed ${esc(meta.runs || '?')} time(s) after ${esc(meta.warmup || 0)} warm-up run(s) in headless ${esc(meta.chrome || 'Chrome')}, each run in a fresh browser profile, with real (trusted) mouse and keyboard input. Numbers are medians.</li>`);
  html.push(`<li>React ${esc((react && react.version) || '?')} ${react && react.development ? 'development build' : ''}. A tracker installed before React loads counts one render per component per commit, so StrictMode double-rendering doesn't inflate counts. A render is <em>wasted</em> when the component's props were equal (or only new objects/functions with the same content) and its own state and context didn't change.</li>`);
  html.push(`<li>CPU slowed ${esc(meta.cpu || 1)}× during interactions. Timings come from a development build: compare them with each other, not with production.</li>`);
  html.push('<li>Behavior check: after every step, the visible text, accessibility tree, DOM (with generated ids and CSS-in-JS hashes normalized), data requests and console errors are compared with the baseline. Lines that already varied between baseline runs are ignored as noise. It proves equivalence only for the steps in the scenarios.</li>');
  html.push('</ul></div>');
  html.push(`<footer>Generated by react-render-audit from <code>${esc(audit)}</code>.</footer>`);
  html.push('<script>(function(){try{var t=localStorage.getItem("ra-theme");if(t)document.documentElement.dataset.theme=t;}catch(e){}})();</script>');
  html.push('</main></body></html>');

  const md = [];
  md.push(`# Re-render audit: ${project}`, '');
  md.push(`${date} · ${scenarios.length} scenario(s)${scoped ? ` · scope: ${config.scope.map((dir) => `\`${rel(dir)}\``).join(', ')}` : ''}`, '');
  md.push(headline, '');
  md.push('| Metric | Before | After | Change |', '|---|---:|---:|---:|');
  for (const [label, field] of [[scoped ? 'Renders in scope' : 'Component renders', metric], ['Wasted renders', 'wasted'], ['Remounts', 'remounts'], ['Effect cascades', 'cascades'], ['React commits', 'commits']]) {
    md.push(`| ${label} | ${B(field)} | ${hasAfter ? A(field) : '—'} | ${hasAfter ? percentChange(B(field), A(field)) : '—'} |`);
  }
  md.push('');
  for (const item of scenarios) {
    md.push(`## Scenario: ${item.scenario}`, '');
    md.push('| # | Step | Renders | Wasted | Behavior |', '|---:|---|---:|---:|---|');
    item.baseline.steps.forEach((step, index) => {
      const a = item.after ? item.after.steps[index] : null;
      const cmp = item.comparison ? item.comparison.steps[index] : null;
      md.push(`| ${step.index} | ${step.name.replace(/\|/g, '\\|')} | ${a ? `${step.renders} → ${a.renders}` : step.renders} | ${a ? `${step.wasted} → ${a.wasted}` : step.wasted} | ${cmp ? (cmp.equivalent ? 'same' : '**changed**') : '—'} |`);
    });
    md.push('');
  }
  if (changes.length) {
    md.push('## Changes', '');
    for (const change of changes) {
      md.push(`- **${change.status}**: ${change.title}${change.skill ? ` (\`${change.skill}\`${change.rule ? `: ${change.rule}` : ''})` : ''}${change.commit ? ` — ${change.commit.slice(0, 9)}` : ''}${change.reason ? `. ${change.reason}` : ''}`);
    }
    md.push('');
  }
  if (remaining.length) {
    md.push(hasAfter ? '## Remaining opportunities' : '## Hotspots found', '');
    for (const hotspot of remaining.slice(0, 10)) md.push(`- **${hotspot.title}** — ${hotspot.fixIn || hotspot.component}${hotspot.file ? ` (\`${rel(hotspot.file)}${hotspot.line ? `:${hotspot.line}` : ''}\`)` : ''}. ${hotspot.fix} _[${hotspot.skill}, ${hotspot.safety}]_`);
    md.push('');
  }
  md.push(`_Measured in ${meta.chrome || 'Chrome'} with React ${(react && react.version) || '?'}, ${meta.runs || '?'} runs per scenario (median), CPU ${meta.cpu || 1}× during interactions. Behavior compared at every step: text, accessibility tree, DOM, network, console._`);

  const htmlFile = join(audit, 'report.html');
  const mdFile = join(audit, 'report.md');
  writeFileSync(htmlFile, html.join('\n'));
  writeFileSync(mdFile, `${md.join('\n')}\n`);
  return { html: htmlFile, markdown: mdFile };
}

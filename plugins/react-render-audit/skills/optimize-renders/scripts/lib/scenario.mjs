import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describeTarget } from './page.mjs';

const ACTIONS = new Set(['goto', 'click', 'hover', 'type', 'press', 'fill', 'select', 'scroll', 'resize', 'wait', 'waitFor', 'eval']);
const NEEDS_TARGET = new Set(['click', 'hover', 'fill', 'select', 'waitFor']);

export function stepLabel(step, index) {
  if (step.name) return step.name;
  if (index === 0) return 'load';
  const target = step.target ? describeTarget(step.target) : '';
  switch (step.action) {
    case 'goto':
      return `open ${step.url}`;
    case 'type':
      return `type "${step.text}"${target ? ` into ${target}` : ''}`;
    case 'press':
      return `press ${step.key}`;
    case 'scroll':
      return `scroll ${step.deltaY ?? 600}px × ${step.times || 1}`;
    case 'resize':
      return `resize to ${step.width}×${step.height}`;
    case 'wait':
      return `wait ${step.ms ?? 500} ms`;
    case 'fill':
    case 'select':
      return `${step.action} ${target} = "${step.value ?? step.text}"`;
    case 'eval':
      return 'run script';
    default:
      return `${step.action} ${target}`.trim();
  }
}

/** Reads and checks a scenario file. Throws with every problem listed. */
export function loadScenario(file) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Can't read scenario ${file}: ${error.message}`);
  }
  const problems = [];
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  if (raw.steps !== undefined && !Array.isArray(raw.steps)) problems.push('"steps" must be an array');
  steps.forEach((step, i) => {
    const where = `step ${i + 1}`;
    if (!step || typeof step !== 'object') return problems.push(`${where} must be an object`);
    if (!ACTIONS.has(step.action)) return problems.push(`${where}: unknown action "${step.action}" (use one of ${[...ACTIONS].join(', ')})`);
    if (NEEDS_TARGET.has(step.action) && !step.target) problems.push(`${where} (${step.action}) needs a "target"`);
    if (step.action === 'type' && typeof step.text !== 'string') problems.push(`${where} (type) needs "text"`);
    if (step.action === 'press' && !step.key) problems.push(`${where} (press) needs "key"`);
    if (step.action === 'goto' && !step.url) problems.push(`${where} (goto) needs "url"`);
    if (step.action === 'eval' && !step.expression) problems.push(`${where} (eval) needs "expression"`);
  });
  const names = new Set();
  steps.forEach((step, i) => {
    const label = stepLabel(step, i + 1);
    if (names.has(label)) step.name = `${label} (${i + 1})`;
    names.add(step.name || label);
  });
  if (problems.length) throw new Error(`Scenario ${file} has problems:\n- ${problems.join('\n- ')}`);
  return {
    name: raw.name || basename(file).replace(/\.json$/, ''),
    description: raw.description || '',
    url: raw.url || '',
    viewport: raw.viewport,
    load: raw.load || {},
    steps,
    ignoreSelectors: raw.ignoreSelectors || [],
    ignoreRequests: raw.ignoreRequests || [],
    file,
  };
}

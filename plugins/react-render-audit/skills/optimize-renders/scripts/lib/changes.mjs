// The change log: every fix attempt, kept or reverted, with the skill rule behind it and the
// checks it passed. The report is built from it.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJson, table, writeJson } from './util.mjs';

const STATUSES = new Set(['kept', 'reverted', 'proposed', 'skipped']);
const SAFETY = new Set(['auto', 'ask', 'suggest']);

function parseGates(value) {
  if (!value || value === true) return {};
  const gates = {};
  for (const part of String(value).split(',')) {
    const [name, result] = part.split('=').map((item) => item.trim());
    if (name) gates[name] = result || 'pass';
  }
  return gates;
}

export function readChanges(audit) {
  return readJson(join(audit, 'changes.json'), []);
}

export function addChange(audit, flags) {
  const title = flags.title && flags.title !== true ? String(flags.title) : null;
  if (!title) throw new Error('changes add needs --title');
  const status = String(flags.status || 'proposed');
  if (!STATUSES.has(status)) throw new Error(`--status must be one of ${[...STATUSES].join(', ')}`);
  const safety = flags.safety ? String(flags.safety) : null;
  if (safety && !SAFETY.has(safety)) throw new Error(`--safety must be one of ${[...SAFETY].join(', ')}`);
  let diff;
  if (flags.diffFile && flags.diffFile !== true) {
    const file = resolve(String(flags.diffFile));
    if (!existsSync(file)) throw new Error(`--diff-file ${file} does not exist`);
    diff = readFileSync(file, 'utf8');
    if (diff.length > 40000) diff = `${diff.slice(0, 40000)}\n… (truncated)`;
  }
  const changes = readChanges(audit);
  const text = (key) => (flags[key] && flags[key] !== true ? String(flags[key]) : undefined);
  const entry = {
    id: changes.length + 1,
    at: new Date().toISOString(),
    title,
    status,
    hotspot: text('hotspot'),
    component: text('component'),
    file: text('file') ? resolve(String(flags.file)) : undefined,
    skill: text('skill'),
    rule: text('rule'),
    safety: safety || undefined,
    measure: text('measure'),
    commit: text('commit'),
    reason: text('reason'),
    gates: parseGates(flags.gates),
    diff,
  };
  changes.push(entry);
  writeJson(join(audit, 'changes.json'), changes);
  return entry;
}

export function formatChanges(audit) {
  const changes = readChanges(audit);
  if (!changes.length) return 'No changes recorded yet.';
  return table([
    ['#', 'status', 'title', 'skill', 'measure', 'commit'],
    ...changes.map((change) => [change.id, change.status, change.title, change.skill || '—', change.measure || '—', change.commit ? change.commit.slice(0, 9) : '—']),
  ]);
}

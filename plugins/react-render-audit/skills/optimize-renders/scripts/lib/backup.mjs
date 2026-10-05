// File backups for the fix loop. Before a fix touches files, they're copied into the audit
// directory; restoring puts the exact previous bytes back (and deletes files the fix created).
// This never touches git, so uncommitted work in the user's tree is safe.
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { readJson, writeJson } from './util.mjs';

function manifestPath(audit, label) {
  return join(audit, 'backups', label, 'manifest.json');
}

function storedPath(audit, label, root, file) {
  const rel = relative(root, file);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${file} is outside ${root}; only files inside the repository can be backed up`);
  return join(audit, 'backups', label, 'files', rel);
}

/** Saves the current state of `files` under `label`. Files already saved under it are kept as they were. */
export function backup(audit, label, root, files) {
  const manifest = readJson(manifestPath(audit, label), { label, root, files: [] });
  const known = new Set(manifest.files.map((entry) => entry.path));
  const added = [];
  for (const raw of files) {
    const file = resolve(raw);
    if (known.has(file)) continue;
    const existed = existsSync(file);
    if (existed) {
      const target = storedPath(audit, label, root, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file, target);
    }
    manifest.files.push({ path: file, existed });
    known.add(file);
    added.push({ path: file, existed });
  }
  writeJson(manifestPath(audit, label), manifest);
  return added;
}

/** The files saved under `label`: { path, existed, stored } (stored is the saved copy, or null). */
export function backedUp(audit, label) {
  const file = manifestPath(audit, label);
  if (!existsSync(file)) throw new Error(`No backup named "${label}" in ${audit}`);
  const manifest = readJson(file);
  return manifest.files.map((entry) => ({ ...entry, stored: entry.existed ? storedPath(audit, label, manifest.root, entry.path) : null }));
}

/** Puts every file saved under `label` back, and deletes the ones that didn't exist before. */
export function restore(audit, label) {
  const file = manifestPath(audit, label);
  if (!existsSync(file)) throw new Error(`No backup named "${label}" in ${audit}`);
  const manifest = readJson(file);
  const restored = [];
  for (const entry of manifest.files) {
    if (entry.existed) {
      copyFileSync(storedPath(audit, label, manifest.root, entry.path), entry.path);
      restored.push(`restored ${relative(manifest.root, entry.path)}`);
    } else if (existsSync(entry.path)) {
      rmSync(entry.path);
      restored.push(`removed ${relative(manifest.root, entry.path)} (created by the fix)`);
    }
  }
  return restored;
}

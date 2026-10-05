// The baseline side of a benchmark: a separate checkout of the baseline commit (a git worktree
// outside the repository, so the user's working tree, type checks, linters and test runners never
// see it), with its dependencies installed and the app's untracked .env files linked in. The env
// files are linked by name; their contents are never read.
//
// For the per-fix proof the copy is synced to the working tree minus one fix (the files that fix's
// backup saved), so "before this fix" and "after it" differ by exactly that fix. The copy is
// disposable: syncing and resetting overwrite it, and only ever delete files they put there.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { backedUp } from './backup.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** The install command for the lockfile in `dir`. */
export function installCommand(dir) {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm install --frozen-lockfile --prefer-offline';
  if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun install --frozen-lockfile';
  if (existsSync(join(dir, 'yarn.lock'))) return existsSync(join(dir, '.yarnrc.yml')) ? 'yarn install --immutable' : 'yarn install --frozen-lockfile --prefer-offline';
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm ci --prefer-offline --no-audit --no-fund';
  return 'npm install --no-audit --no-fund';
}

const ENV_FILE = /^\.env(\..+)?$/;
const ENV_TEMPLATE = /\.(example|sample|template|dist)$/;
const DEPENDENCY_FILES = new Set(['package.json', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'yarn.lock', 'package-lock.json']);

function gitList(cwd, args) {
  return execFileSync('git', [...args, '-z'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

function realDir(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Whether `dir` is a checkout (worktree) of the same repository as `top`. */
function sameRepository(dir, top) {
  try {
    const common = (cwd) => realDir(resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir'])));
    return common(dir) === common(top);
  } catch {
    return false;
  }
}

/**
 * Puts the copy back at `sha`: tracked files reset, and the files an earlier sync added (`synced`,
 * paths relative to the repository) removed unless the commit tracks them.
 */
function restoreCopy(dir, sha, synced = []) {
  git(dir, ['reset', '--hard', '--quiet', sha]);
  if (!synced.length) return;
  const tracked = new Set(gitList(dir, ['ls-files']));
  for (const path of synced) if (!tracked.has(path)) rmSync(join(dir, path), { force: true });
}

/**
 * Links untracked .env files from the repository root and the app folder into the same places in
 * the copy. Tracked ones are already there. Returns the linked paths, relative to the repository.
 */
export function linkEnvFiles({ top, appRoot, dir }) {
  const linked = [];
  for (const source of new Set([top, appRoot])) {
    let names = [];
    try {
      names = readdirSync(source).filter((name) => ENV_FILE.test(name) && !ENV_TEMPLATE.test(name));
    } catch {
      continue;
    }
    for (const name of names) {
      const from = join(source, name);
      const to = join(dir, relative(top, source), name);
      if (existsSync(to) || !lstatSync(from).isFile()) continue;
      mkdirSync(dirname(to), { recursive: true });
      symlinkSync(from, to);
      linked.push(relative(top, from));
    }
  }
  return linked;
}

function runLogged(command, cwd, logFile) {
  return new Promise((resolvePromise, reject) => {
    const fd = openSync(logFile, 'a');
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) return resolvePromise();
      let output = '';
      try {
        output = readFileSync(logFile, 'utf8').trimEnd().split('\n').slice(-25).join('\n');
      } catch {
        // no log
      }
      reject(new Error(`"${command}" failed in ${cwd} (exit ${code}). Last output:\n${output}`));
    });
  });
}

/**
 * Creates (or reuses) the checkout of `ref` and installs its dependencies. `install` overrides the
 * detected install command ('none' skips it); `setup` runs after it (code generation, say).
 */
export async function prepareBaseline({ repoRoot, appRoot, ref = 'HEAD', dir, install, setup, linkEnv = true, logFile, synced = [] }) {
  const top = git(repoRoot || appRoot, ['rev-parse', '--show-toplevel']);
  const sha = git(top, ['rev-parse', '--verify', `${ref}^{commit}`]);
  const target = resolve(dir || join(tmpdir(), `render-audit-baseline-${basename(top)}-${sha.slice(0, 10)}`));
  if (target === top || target.startsWith(top + sep)) {
    throw new Error(`Put the baseline copy outside the repository (${top}): type checks, linters and test runners there would pick it up.`);
  }
  let reused = false;
  let moved = null;
  if (existsSync(target)) {
    let head = null;
    try {
      head = git(target, ['rev-parse', 'HEAD']);
    } catch {
      head = null;
    }
    if (!head || !sameRepository(target, top)) throw new Error(`${target} exists but isn't a checkout of this repository. Remove it (baseline --remove --dir ${target}) or pass another --dir.`);
    // An existing copy is moved to the requested commit (undoing any sync), so its dependencies
    // can be kept.
    if (head !== sha || synced.length) {
      const changed = head === sha ? [] : git(top, ['diff', '--name-only', head, sha]).split('\n').filter(Boolean);
      restoreCopy(target, sha, synced);
      if (head !== sha) moved = { from: head, dependenciesChanged: changed.some((path) => DEPENDENCY_FILES.has(basename(path))) };
    }
    reused = true;
  } else {
    git(top, ['worktree', 'add', '--detach', target, sha]);
  }
  // git reports the repository's real path, so the app's path must be real too (a symlink in it,
  // like /tmp on macOS, would otherwise point outside the copy).
  const app = realDir(resolve(appRoot));
  const inside = relative(top, app);
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error(`${appRoot} isn't inside the repository ${top}`);
  const appDir = join(target, inside);
  const envLinks = linkEnv ? linkEnvFiles({ top, appRoot: app, dir: target }) : [];
  const log = logFile || join(tmpdir(), `render-audit-baseline-${sha.slice(0, 10)}.log`);
  const command = install === 'none' ? null : install || installCommand(target);
  let installed = false;
  if (command && (!reused || !existsSync(join(target, 'node_modules')) || (moved && moved.dependenciesChanged))) {
    await runLogged(command, target, log);
    installed = true;
  }
  if (setup) await runLogged(setup, target, log);
  return { ref, sha, dir: target, appDir, appRoot: app, repo: top, install: command, installed, envLinks, reused, moved: moved ? moved.from : null, synced: [], log, createdAt: new Date().toISOString() };
}

/** The path of `file` relative to the repository, or null when it's outside. */
function repoPath(top, file) {
  for (const [root, path] of [[top, resolve(file)], [realDir(top), join(realDir(dirname(file)), basename(file))]]) {
    const rel = relative(root, path);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  }
  return null;
}

function copyInto(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  rmSync(to, { force: true });
  if (lstatSync(from).isSymbolicLink()) symlinkSync(readlinkSync(from), to);
  else copyFileSync(from, to);
}

/**
 * Makes the copy (`saved`: the baseline.json record) match the user's working tree: every tracked
 * file that differs from the copy's commit (committed since, or not committed) and every untracked
 * file that isn't ignored. With `without` (a backup label), the files that fix's backup saved get
 * their content from before the fix, and the files it created are removed, so the copy is the app
 * without that fix. Env files are linked, never copied; the audit folder is skipped. Returns what
 * it did, with `synced` (every path it wrote) for the next sync or reset to undo.
 */
export function syncBaseline(saved, { audit, without } = {}) {
  const top = saved.repo;
  restoreCopy(saved.dir, saved.sha, saved.synced || []);
  const skip = (path) => ENV_FILE.test(basename(path)) || /(^|\/)(\.render-audit|node_modules)\//.test(path);
  const changed = gitList(top, ['diff', '--name-only', '--no-renames', saved.sha]).filter((path) => !skip(path));
  const untracked = gitList(top, ['ls-files', '--others', '--exclude-standard']).filter((path) => !skip(path));
  const synced = new Set();
  let copied = 0;
  let removed = 0;
  for (const path of [...changed, ...untracked]) {
    const from = join(top, path);
    const to = join(saved.dir, path);
    let exists = true;
    try {
      lstatSync(from);
    } catch {
      exists = false;
    }
    if (exists) {
      copyInto(from, to);
      synced.add(path);
      copied++;
    } else {
      rmSync(to, { force: true });
      removed++;
    }
  }
  const restored = [];
  if (without) {
    for (const entry of backedUp(audit, without)) {
      const path = repoPath(top, entry.path);
      if (!path) continue;
      const to = join(saved.dir, path);
      if (entry.existed) {
        copyInto(entry.stored, to);
        synced.add(path);
      } else rmSync(to, { force: true });
      restored.push(path);
    }
  }
  const envLinks = linkEnvFiles({ top, appRoot: realDir(saved.appRoot || top), dir: saved.dir });
  return {
    copied,
    removed,
    restored,
    envLinks,
    synced: [...synced].sort(),
    dependenciesChanged: changed.some((path) => DEPENDENCY_FILES.has(basename(path))),
  };
}

/** Puts the copy back at its commit (`saved`: the baseline.json record), undoing any sync. */
export function resetBaseline(saved) {
  restoreCopy(saved.dir, saved.sha, saved.synced || []);
  return { envLinks: linkEnvFiles({ top: saved.repo, appRoot: realDir(saved.appRoot || saved.repo), dir: saved.dir }) };
}

/** Removes the checkout and git's record of it. */
export function removeBaseline({ repoRoot, dir }) {
  const top = git(repoRoot, ['rev-parse', '--show-toplevel']);
  git(top, ['worktree', 'remove', '--force', resolve(dir)]);
  git(top, ['worktree', 'prune']);
}

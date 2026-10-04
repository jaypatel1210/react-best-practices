// The baseline side of a benchmark: a separate checkout of the baseline commit (a git worktree
// outside the repository, so the user's working tree, type checks, linters and test runners never
// see it), with its dependencies installed and the app's untracked .env files linked in. The env
// files are linked by name; their contents are never read.
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

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
export async function prepareBaseline({ repoRoot, appRoot, ref = 'HEAD', dir, install, setup, linkEnv = true, logFile }) {
  const top = git(repoRoot || appRoot, ['rev-parse', '--show-toplevel']);
  const sha = git(top, ['rev-parse', '--verify', `${ref}^{commit}`]);
  const target = resolve(dir || join(tmpdir(), `render-audit-baseline-${basename(top)}-${sha.slice(0, 10)}`));
  if (target === top || target.startsWith(top + sep)) {
    throw new Error(`Put the baseline copy outside the repository (${top}): type checks, linters and test runners there would pick it up.`);
  }
  let reused = false;
  if (existsSync(target)) {
    let head = null;
    try {
      head = git(target, ['rev-parse', 'HEAD']);
    } catch {
      head = null;
    }
    if (head !== sha) throw new Error(`${target} exists but isn't a checkout of ${sha.slice(0, 10)}. Remove it (baseline --remove --dir ${target}) or pass another --dir.`);
    reused = true;
  } else {
    git(top, ['worktree', 'add', '--detach', target, sha]);
  }
  const appDir = join(target, relative(top, resolve(appRoot)));
  const envLinks = linkEnv ? linkEnvFiles({ top, appRoot: resolve(appRoot), dir: target }) : [];
  const log = logFile || join(tmpdir(), `render-audit-baseline-${sha.slice(0, 10)}.log`);
  const command = install === 'none' ? null : install || installCommand(target);
  let installed = false;
  if (command && !(reused && existsSync(join(target, 'node_modules')))) {
    await runLogged(command, target, log);
    installed = true;
  }
  if (setup) await runLogged(setup, target, log);
  return { ref, sha, dir: target, appDir, repo: top, install: command, installed, envLinks, reused, log, createdAt: new Date().toISOString() };
}

/** Removes the checkout and git's record of it. */
export function removeBaseline({ repoRoot, dir }) {
  const top = git(repoRoot, ['rev-parse', '--show-toplevel']);
  git(top, ['worktree', 'remove', '--force', resolve(dir)]);
  git(top, ['worktree', 'prune']);
}

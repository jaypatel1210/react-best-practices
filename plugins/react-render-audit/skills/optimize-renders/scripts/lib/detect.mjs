// Reads a project's package.json and config files to describe how it runs: framework and router,
// React and Compiler, package manager and monorepo layout, scripts, dev command and port.
// It never reads .env files.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative } from 'node:path';

const LIBRARIES = [
  '@reduxjs/toolkit', 'redux', 'react-redux', 'zustand', 'jotai', 'recoil', 'mobx', 'mobx-react-lite', 'valtio', 'xstate',
  '@tanstack/react-query', 'swr', '@apollo/client', 'urql', 'react-relay', 'react-hook-form', 'formik', 'styled-components',
  '@emotion/react', 'tailwindcss', 'react-window', 'react-virtualized', '@tanstack/react-virtual', 'react-virtuoso',
  'framer-motion', 'motion', '@mui/material', '@chakra-ui/react', 'antd', '@radix-ui/react-dialog', 'react-aria',
];
const DEFAULT_PORTS = { next: 3000, vite: 5173, cra: 3000, remix: 5173, 'react-router': 5173, gatsby: 8000, rsbuild: 3000, parcel: 1234, astro: 4321 };

function readJsonSafe(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function firstExisting(dir, names) {
  for (const name of names) {
    const file = join(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

function installedVersion(appRoot, pkg) {
  try {
    const require = createRequire(join(appRoot, 'package.json'));
    return readJsonSafe(require.resolve(`${pkg}/package.json`))?.version || null;
  } catch {
    return null;
  }
}

function findRepoRoot(appRoot) {
  let dir = appRoot;
  let lastWithLock = null;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (firstExisting(dir, ['pnpm-workspace.yaml', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lock', 'bun.lockb', 'turbo.json', 'nx.json'])) lastWithLock = dir;
    const parent = dirname(dir);
    if (parent === dir) return lastWithLock || appRoot;
    dir = parent;
  }
}

function packageManagerOf(appRoot, repoRoot, pkg, rootPkg) {
  const declared = (pkg && pkg.packageManager) || (rootPkg && rootPkg.packageManager);
  if (declared) return declared.split('@')[0];
  let dir = appRoot;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
    if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun';
    if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
    if (dir === repoRoot || dirname(dir) === dir) return 'npm';
    dir = dirname(dir);
  }
}

function portFromScript(script) {
  if (!script) return null;
  const match = /(?:--port[= ]|-p[= ]?|PORT=)(\d{2,5})/.exec(script);
  return match ? Number(match[1]) : null;
}

function sourceDirs(appRoot) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(appRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  const skip = new Set(['node_modules', 'public', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || skip.has(entry.name)) continue;
    const dir = join(appRoot, entry.name);
    if (containsJsx(dir, 3)) out.push(entry.name);
  }
  return out;
}

function containsJsx(dir, depth) {
  if (depth < 0) return false;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && /\.(jsx|tsx)$/.test(entry.name)) return true;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.') && containsJsx(join(dir, entry.name), depth - 1)) return true;
  }
  return false;
}

export function detect(appRoot) {
  const pkgFile = join(appRoot, 'package.json');
  const pkg = readJsonSafe(pkgFile);
  if (!pkg) throw new Error(`No package.json in ${appRoot}. Point --root at the app (the folder whose package.json has react).`);
  const repoRoot = findRepoRoot(appRoot);
  const rootPkg = repoRoot !== appRoot ? readJsonSafe(join(repoRoot, 'package.json')) : null;
  const deps = { ...(pkg.peerDependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
  const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);
  const warnings = [];

  let framework = 'react';
  if (has('next')) framework = 'next';
  else if (has('@remix-run/react')) framework = 'remix';
  else if (has('@react-router/dev')) framework = 'react-router';
  else if (has('gatsby')) framework = 'gatsby';
  else if (has('react-scripts')) framework = 'cra';
  else if (has('astro')) framework = 'astro';
  else if (has('@rsbuild/core')) framework = 'rsbuild';
  else if (has('vite')) framework = 'vite';
  else if (has('parcel')) framework = 'parcel';
  if (has('react-native') || has('expo')) {
    warnings.push('React Native renders native views, not DOM; this tool measures React DOM apps only (React Native Web works).');
  }
  const frameworkPackage = { next: 'next', remix: '@remix-run/react', 'react-router': '@react-router/dev', gatsby: 'gatsby', cra: 'react-scripts', astro: 'astro', rsbuild: '@rsbuild/core', vite: 'vite', parcel: 'parcel' }[framework];

  let router = null;
  if (framework === 'next') {
    const app = ['app', 'src/app'].some((dir) => existsSync(join(appRoot, dir)));
    const pages = ['pages', 'src/pages'].some((dir) => existsSync(join(appRoot, dir)));
    router = app && pages ? 'app + pages' : app ? 'app' : pages ? 'pages' : null;
  }

  const reactVersion = installedVersion(appRoot, 'react') || deps.react || null;
  if (!reactVersion) warnings.push('react is not a dependency of this package; is --root the app folder?');
  else if (/^1[0-7]\./.test(reactVersion)) warnings.push(`React ${reactVersion}: the tracker targets React 18 and 19; older versions may report fewer reasons.`);

  const nextConfig = readText(firstExisting(appRoot, ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs']) || '');
  const viteConfig = readText(firstExisting(appRoot, ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts']) || '');
  const babelConfig = readText(firstExisting(appRoot, ['babel.config.js', '.babelrc', 'babel.config.json']) || '');
  const compiler = has('babel-plugin-react-compiler') || /reactCompiler\s*:\s*(true|\{)/.test(nextConfig) || /react-compiler/.test(viteConfig + babelConfig);

  let strictMode = null;
  if (framework === 'next') {
    const match = /reactStrictMode\s*:\s*(true|false)/.exec(nextConfig);
    strictMode = match ? match[1] === 'true' : router === 'app' ? true : null;
  } else {
    const entry = firstExisting(appRoot, ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx', 'src/main.js', 'src/index.js']);
    if (entry) strictMode = /StrictMode/.test(readText(entry));
  }

  const scripts = pkg.scripts || {};
  const packageManager = packageManagerOf(appRoot, repoRoot, pkg, rootPkg);
  const run = (script) => (packageManager === 'npm' || packageManager === 'bun' ? `${packageManager} run ${script}` : `${packageManager} ${script}`);

  // Monorepos often have a root script that starts one app with its workspace dependencies.
  let devCommand = null;
  let devCwd = appRoot;
  if (rootPkg && rootPkg.scripts) {
    const names = [basename(appRoot), (pkg.name || '').split('/').pop()].filter(Boolean);
    const rootScript = Object.keys(rootPkg.scripts).find((script) => names.some((name) => script === `dev:${name}`));
    if (rootScript) {
      devCommand = run(rootScript);
      devCwd = repoRoot;
    }
  }
  if (!devCommand) {
    const script = ['dev', 'start', 'serve'].find((name) => scripts[name]);
    if (script) devCommand = run(script);
  }
  const port = portFromScript(scripts.dev) || portFromScript(scripts.start) || DEFAULT_PORTS[framework] || 3000;

  const typecheck = ['typecheck', 'type-check', 'check:types', 'types', 'tsc'].find((name) => scripts[name]);
  const testRunner = has('vitest') ? 'vitest' : has('jest') ? 'jest' : null;
  const libraries = LIBRARIES.filter(has);

  return {
    appRoot,
    repoRoot,
    name: pkg.name || basename(appRoot),
    packageManager,
    monorepo: repoRoot !== appRoot && !!(rootPkg && (rootPkg.workspaces || existsSync(join(repoRoot, 'pnpm-workspace.yaml')) || existsSync(join(repoRoot, 'turbo.json')) || existsSync(join(repoRoot, 'nx.json')))),
    framework,
    frameworkVersion: frameworkPackage ? installedVersion(appRoot, frameworkPackage) || deps[frameworkPackage] || null : null,
    router,
    react: reactVersion,
    reactDom: installedVersion(appRoot, 'react-dom') || deps['react-dom'] || null,
    compiler,
    strictMode,
    typescript: existsSync(join(appRoot, 'tsconfig.json')),
    devCommand,
    devCwd,
    port,
    url: `http://localhost:${port}`,
    scripts: {
      dev: scripts.dev || null,
      build: scripts.build || null,
      test: scripts.test || null,
      lint: scripts.lint || null,
      typecheck: typecheck ? scripts[typecheck] : null,
    },
    gates: {
      typecheck: typecheck ? run(typecheck) : existsSync(join(appRoot, 'tsconfig.json')) ? 'npx tsc --noEmit' : null,
      lint: scripts.lint ? run('lint') : null,
      test: scripts.test ? run('test') : null,
    },
    testRunner,
    libraries,
    sourceDirs: sourceDirs(appRoot),
    warnings,
  };
}

export function formatDetect(result) {
  const rel = (path) => relative(process.cwd(), path) || '.';
  const lines = [];
  const fw = result.framework === 'next' ? `Next.js ${result.frameworkVersion || ''} (${result.router || 'router unknown'} router)` : `${result.framework}${result.frameworkVersion ? ` ${result.frameworkVersion}` : ''}`;
  lines.push(`App:        ${result.name} at ${rel(result.appRoot)}${result.monorepo ? ` (monorepo root ${rel(result.repoRoot)})` : ''}`);
  lines.push(`Framework:  ${fw}`);
  lines.push(`React:      ${result.react || '?'}${result.compiler ? ', React Compiler on' : ''}${result.strictMode === true ? ', StrictMode on' : result.strictMode === false ? ', StrictMode off' : ''}`);
  lines.push(`Packages:   ${result.packageManager}${result.typescript ? ', TypeScript' : ''}${result.testRunner ? `, ${result.testRunner}` : ''}`);
  lines.push(`Dev server: ${result.devCommand || '(no dev script found)'}${result.devCwd !== result.appRoot ? ` (run in ${rel(result.devCwd)})` : ''} → ${result.url}`);
  lines.push(`Gates:      typecheck: ${result.gates.typecheck || '—'} | lint: ${result.gates.lint || '—'} | test: ${result.gates.test || '—'}`);
  if (result.libraries.length) lines.push(`Libraries:  ${result.libraries.join(', ')}`);
  if (result.sourceDirs.length) lines.push(`Source:     ${result.sourceDirs.join(', ')}`);
  for (const warning of result.warnings) lines.push(`Warning:    ${warning}`);
  return lines.join('\n');
}

export function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

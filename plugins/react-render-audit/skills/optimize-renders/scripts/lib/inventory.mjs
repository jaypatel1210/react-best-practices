// A quick static pass over the source: how many components, hooks and contexts each directory
// holds, and how often it uses patterns that tend to cause re-renders. Regex-based on purpose:
// it ranks directories for the scope choice; the runtime measurement is what decides.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { table } from './util.mjs';

// Build output, generated code and test infrastructure: not app code users render.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.turbo', '.vercel', '.cache', 'dist', 'build', 'out', 'coverage', 'public',
  '__generated__', 'storybook-static', 'playwright-report', 'test-results', '.render-audit', '.svelte-kit',
  'test', 'tests', '__tests__', '__mocks__', 'e2e', 'stories', '.storybook',
]);
const SOURCE = /\.(jsx|tsx|js|ts|mjs)$/;
const NOT_SOURCE = /\.(test|spec|stories|story|d)\.[jt]sx?$|\.d\.ts$/;
const HAS_JSX = /<\/?[A-Za-z][\w.]*[\s/>]|React\.createElement|\bjsx\(/;

export const SIGNALS = {
  providerInlineValue: { re: /(?:\.Provider|Context)\s+value=\{\{/g, weight: 3, label: 'provider value={{…}}' },
  setStateInEffect: { re: /useEffect\(\s*\(\)\s*=>\s*\{?\s*set[A-Z]\w*\(/g, weight: 2, label: 'setState in effect' },
  nestedComponent: { re: /^[ \t]{2,}(?:const|function)\s+[A-Z]\w*\s*(?:=\s*(?:memo\(|forwardRef\()?\s*(?:\([^)]*\)|\w+)\s*=>|\()/gm, weight: 3, label: 'component defined inside a component' },
  highFrequencyListener: { re: /addEventListener\(\s*['"](?:scroll|resize|mousemove|pointermove|wheel|touchmove)['"]/g, weight: 2, label: 'scroll/resize/pointer listener' },
  indexKey: { re: /key=\{\s*(?:index|idx|i)\s*\}/g, weight: 1, label: 'key={index}' },
  inlineFunctionProp: { re: /\s(?:on[A-Z]\w*|render[A-Z]?\w*)=\{\s*(?:async\s*)?(?:\([^()]*\)|\w+)\s*=>/g, weight: 0.25, label: 'inline function prop' },
  inlineObjectProp: { re: /\s(?!style=)[a-zA-Z][\w-]*=\{\{/g, weight: 0.5, label: 'inline object prop' },
  inlineStyle: { re: /\sstyle=\{\{/g, weight: 0.1, label: 'inline style object' },
};
const COMPONENT_PATTERNS = [
  /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Z]\w*)\s*[(<]/gm,
  /^(?:export\s+)?const\s+([A-Z]\w*)\s*(?::[^=\n]+)?=\s*(?:React\.)?(?:memo|forwardRef)?\s*(?:<[^>]*>)?\s*\(?\s*(?:function\b|async\s|\([^)]*\)\s*(?::[^=]+)?=>|\w+\s*=>)/gm,
  /^(?:export\s+(?:default\s+)?)?class\s+([A-Z]\w*)\s+extends\s+(?:React\.)?(?:Pure)?Component\b/gm,
];
const HOOK_PATTERN = /^(?:export\s+)?(?:function\s+(use[A-Z]\w*)|const\s+(use[A-Z]\w*)\s*=)/gm;
const CONTEXT_PATTERN = /createContext\s*[<(]/g;

function walk(dir, files) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(join(dir, entry.name), files);
    } else if (entry.isFile() && SOURCE.test(entry.name) && !NOT_SOURCE.test(entry.name)) {
      files.push(join(dir, entry.name));
    }
  }
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function count(re, text) {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text)) n++;
  return n;
}

export function scanFile(file) {
  const text = readFileSync(file, 'utf8');
  const jsx = /\.(jsx|tsx)$/.test(file) || HAS_JSX.test(text);
  const components = [];
  if (jsx) {
    const seen = new Set();
    for (const pattern of COMPONENT_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text))) {
        if (seen.has(match[1])) continue;
        seen.add(match[1]);
        components.push({ name: match[1], line: lineOf(text, match.index) });
      }
    }
  }
  const hooks = [];
  HOOK_PATTERN.lastIndex = 0;
  let match;
  while ((match = HOOK_PATTERN.exec(text))) hooks.push(match[1] || match[2]);
  const signals = {};
  if (jsx) for (const [key, signal] of Object.entries(SIGNALS)) signals[key] = count(signal.re, text);
  return {
    file,
    jsx,
    loc: text.split('\n').length,
    components,
    hooks,
    contexts: count(CONTEXT_PATTERN, text),
    signals,
  };
}

function riskOf(signals) {
  let risk = 0;
  for (const [key, signal] of Object.entries(SIGNALS)) risk += (signals[key] || 0) * signal.weight;
  return Math.round(risk * 10) / 10;
}

function groupKey(root, file, depth) {
  const parts = relative(root, file).split(sep);
  parts.pop();
  const levels = depth ?? (parts[0] === 'src' ? 3 : 2);
  return parts.slice(0, levels).join('/') || '.';
}

/** Scans `root` (or only `dirs`) and groups the results by directory. */
export function inventory(root, { dirs = [], depth } = {}) {
  const files = [];
  if (dirs.length) for (const dir of dirs) walk(dir, files);
  else walk(root, files);
  const scans = files.map(scanFile).filter((scan) => scan.jsx || scan.hooks.length || scan.contexts);
  const groups = new Map();
  for (const scan of scans) {
    let key;
    if (dirs.length) {
      const dir = dirs.find((candidate) => scan.file.startsWith(candidate));
      key = relative(root, dir) || '.';
    } else {
      key = groupKey(root, scan.file, depth);
    }
    let group = groups.get(key);
    if (!group) {
      group = { dir: key, files: 0, loc: 0, components: 0, hooks: 0, contexts: 0, signals: {}, risk: 0, score: 0 };
      groups.set(key, group);
    }
    group.files++;
    group.loc += scan.loc;
    group.components += scan.components.length;
    group.hooks += scan.hooks.length;
    group.contexts += scan.contexts;
    for (const [signal, n] of Object.entries(scan.signals)) group.signals[signal] = (group.signals[signal] || 0) + n;
  }
  for (const group of groups.values()) {
    group.risk = riskOf(group.signals);
    group.score = Math.round((group.components + group.hooks * 0.5 + group.contexts * 2 + group.risk) * 10) / 10;
  }
  const ranked = [...groups.values()].sort((a, b) => b.score - a.score);
  const componentIndex = [];
  for (const scan of scans) for (const component of scan.components) componentIndex.push({ name: component.name, file: scan.file, line: component.line });
  const totals = ranked.reduce(
    (sum, group) => ({ files: sum.files + group.files, components: sum.components + group.components, hooks: sum.hooks + group.hooks, contexts: sum.contexts + group.contexts }),
    { files: 0, components: 0, hooks: 0, contexts: 0 },
  );
  return { root, totals, groups: ranked, componentIndex };
}

export function formatInventory(result, { top = 12 } = {}) {
  const lines = [];
  lines.push(`Scanned ${result.totals.files} source files: ${result.totals.components} components, ${result.totals.hooks} hooks, ${result.totals.contexts} contexts`);
  lines.push('');
  const rows = [['directory', 'files', 'comps', 'hooks', 'ctx', 'risk', 'most common risk signals']];
  for (const group of result.groups.slice(0, top)) {
    const signals = Object.entries(group.signals)
      .filter(([, n]) => n > 0)
      .sort(([a, x], [b, y]) => y * SIGNALS[b].weight - x * SIGNALS[a].weight)
      .slice(0, 3)
      .map(([key, n]) => `${SIGNALS[key].label} ×${n}`)
      .join(', ');
    rows.push([group.dir, group.files, group.components, group.hooks, group.contexts, group.risk, signals || '—']);
  }
  lines.push(table(rows));
  if (result.groups.length > top) lines.push(`… and ${result.groups.length - top} more directories (use --top or --json)`);
  lines.push('');
  lines.push('risk weighs signals that often cause wasted renders; the runtime measurement decides what is real.');
  return lines.join('\n');
}

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { aggregate, hotspots } from '../skills/optimize-renders/scripts/lib/analyze.mjs';
import { backup, restore } from '../skills/optimize-renders/scripts/lib/backup.mjs';
import { diffAgainst, noiseModel } from '../skills/optimize-renders/scripts/lib/compare.mjs';
import { detect } from '../skills/optimize-renders/scripts/lib/detect.mjs';
import { inventory } from '../skills/optimize-renders/scripts/lib/inventory.mjs';
import { axToText } from '../skills/optimize-renders/scripts/lib/page.mjs';
import { loadScenario } from '../skills/optimize-renders/scripts/lib/scenario.mjs';
import { classifyFile, decodeMappings, originalPosition, toFilePath } from '../skills/optimize-renders/scripts/lib/sourcemap.mjs';

const lab = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'lab');
const temp = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'render-audit-test-'));
  temp.push(dir);
  return dir;
}

describe('source maps', () => {
  // line 0: [0→0:0] [9→0:9]   line 1: [0→1:9]   line 2: [0→3:7] [16→3:7]
  const map = { version: 3, sources: ['src/App.tsx'], mappings: 'AAAA,SAAS;AACA;AAEF,gBAAA' };

  it('decodes VLQ segments, including negative and multi-digit values', () => {
    expect(decodeMappings(map.mappings)).toEqual([
      [[0, 0, 0, 0], [9, 0, 0, 9]],
      [[0, 0, 1, 9]],
      [[0, 0, 3, 7], [16, 0, 3, 7]],
    ]);
  });

  it('finds the original position of a generated column', () => {
    expect(originalPosition({ ...map }, 0, 12)).toEqual({ source: 'src/App.tsx', line: 0, column: 9 });
    expect(originalPosition({ ...map }, 1, 3)).toEqual({ source: 'src/App.tsx', line: 1, column: 9 });
    expect(originalPosition({ ...map }, 7, 0)).toBeNull();
  });

  it('handles sectioned (index) maps', () => {
    const indexed = { version: 3, sections: [{ offset: { line: 0, column: 0 }, map: { ...map } }, { offset: { line: 10, column: 0 }, map: { version: 3, sources: ['src/Other.tsx'], mappings: 'AAAA' } }] };
    expect(originalPosition(indexed, 11, 0)).toBeNull();
    expect(originalPosition(indexed, 10, 4)).toEqual({ source: 'src/Other.tsx', line: 0, column: 0 });
    expect(originalPosition(indexed, 0, 10).source).toBe('src/App.tsx');
  });

  it('turns dev-server URLs into file paths', () => {
    const roots = { appRoot: '/repo/apps/web', repoRoot: '/repo' };
    expect(toFilePath('webpack-internal:///(pages-dir-browser)/./src/components/Card.tsx', roots)).toBe('/repo/apps/web/src/components/Card.tsx');
    expect(toFilePath('webpack-internal:///(pages-dir-browser)/../../packages/ui/src/Button.tsx', roots)).toBe('/repo/packages/ui/src/Button.tsx');
    expect(toFilePath('webpack://_N_E/./src/x.tsx?abc1', roots)).toBe('/repo/apps/web/src/x.tsx');
    expect(toFilePath('webpack:///./src/x.tsx', roots)).toBe('/repo/apps/web/src/x.tsx');
    expect(toFilePath('webpack://_N_E/./node_modules/next/dist/loader.js!./src/y.tsx', roots)).toBe('/repo/apps/web/src/y.tsx');
    expect(toFilePath('turbopack:///[project]/apps/web/src/x.tsx', roots)).toBe('/repo/apps/web/src/x.tsx');
    expect(toFilePath('http://localhost:5173/src/App.tsx?t=123', roots)).toBe('/repo/apps/web/src/App.tsx');
    expect(toFilePath('http://localhost:5173/@fs/Users/me/lib/x.tsx', roots)).toBe('/Users/me/lib/x.tsx');
    expect(toFilePath('http://localhost:3000/_next/static/chunks/main.js', roots)).toBeNull();
  });

  it('classifies files as scope, project or external', () => {
    const options = { scope: ['/repo/apps/web/src/components'], repoRoot: '/repo' };
    expect(classifyFile('/repo/apps/web/src/components/Card.tsx', options)).toBe('scope');
    expect(classifyFile('/repo/apps/web/src/pages/index.tsx', options)).toBe('project');
    expect(classifyFile('/repo/node_modules/react/index.js', options)).toBe('external');
    expect(classifyFile('/elsewhere/x.js', options)).toBe('external');
    expect(classifyFile(null, options)).toBe('unknown');
  });
});

describe('behavior comparison', () => {
  it('ignores lines that already varied between baseline runs, including new values of the same shape', () => {
    const model = noiseModel(['heading "Cart"\nclock 10:01\nbutton "Pay"', 'heading "Cart"\nclock 10:02\nbutton "Pay"']);
    expect(diffAgainst(model, 'heading "Cart"\nclock 10:07\nbutton "Pay"').same).toBe(true);
    const missing = diffAgainst(model, 'heading "Cart"\nclock 10:07');
    expect(missing.same).toBe(false);
    expect(missing.removed).toEqual(['button "Pay"']);
  });

  it('counts duplicates and notices reordering', () => {
    const model = noiseModel(['li "A"\nli "B"\nli "B"', 'li "A"\nli "B"\nli "B"']);
    expect(diffAgainst(model, 'li "A"\nli "B"').removed).toEqual(['li "B"']);
    expect(diffAgainst(model, 'li "B"\nli "A"\nli "B"').reordered).toBe(true);
    expect(diffAgainst(model, 'li "B"\nli "A"\nli "B"', { checkOrder: false }).same).toBe(true);
  });

  it('writes the accessibility tree as indented lines without generic wrappers', () => {
    const nodes = [
      { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Shop' }, childIds: ['2'] },
      { nodeId: '2', parentId: '1', role: { value: 'generic' }, name: { value: '' }, childIds: ['3'] },
      { nodeId: '3', parentId: '2', role: { value: 'button' }, name: { value: 'Add' }, properties: [{ name: 'focused', value: { value: true } }, { name: 'disabled', value: { value: false } }], childIds: ['4'] },
      { nodeId: '4', parentId: '3', role: { value: 'StaticText' }, name: { value: 'Add' }, childIds: [] },
    ];
    expect(axToText(nodes)).toBe('RootWebArea "Shop"\n  button "Add" [focused]');
  });
});

describe('scenarios', () => {
  it('reports every problem in a scenario file at once', () => {
    const dir = tempDir();
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({ steps: [{ action: 'click' }, { action: 'type', target: { label: 'Search' } }, { action: 'jump' }] }));
    expect(() => loadScenario(file)).toThrow(/step 1 \(click\) needs a "target"[\s\S]*step 2 \(type\) needs "text"[\s\S]*unknown action "jump"/);
  });

  it('names steps and keeps names unique', () => {
    const dir = tempDir();
    const file = join(dir, 'flow.json');
    writeFileSync(file, JSON.stringify({ steps: [{ action: 'click', target: { role: 'button', name: 'Next' } }, { action: 'click', target: { role: 'button', name: 'Next' } }] }));
    const scenario = loadScenario(file);
    expect(scenario.name).toBe('flow');
    expect(scenario.steps.map((step) => step.name)).toEqual([undefined, 'click button "Next" (2)']);
  });
});

describe('project detection and inventory', () => {
  it('detects the lab as a Vite app on React 19', () => {
    const result = detect(lab);
    expect(result.framework).toBe('vite');
    expect(result.react).toMatch(/^19\./);
    expect(result.port).toBe(5199);
    expect(result.devCommand).toMatch(/run dev$/);
  });

  it('finds components and re-render risk signals', () => {
    const result = inventory(lab);
    const names = result.componentIndex.map((component) => component.name);
    expect(names).toEqual(expect.arrayContaining(['Store', 'ProductCard', 'ProductGrid', 'FilterChips', 'CartTicker', 'CartBadge']));
    const group = result.groups.find((entry) => entry.dir === 'src');
    expect(group.signals.providerInlineValue).toBe(1);
    expect(group.signals.setStateInEffect).toBe(1);
    expect(group.signals.nestedComponent).toBe(1);
    expect(group.signals.highFrequencyListener).toBeGreaterThanOrEqual(1);
  });
});

describe('analysis', () => {
  const types = [
    { id: 0, name: 'Page', file: '/app/src/Page.tsx', line: 3, memo: false },
    { id: 1, name: 'Row', file: '/app/src/Row.tsx', line: 1, memo: true },
    { id: 2, name: 'Header', file: '/app/src/Header.tsx', line: 1, memo: false },
  ];
  const stats = (extra) => ({ commits: 1, renders: 0, wasted: 0, mounts: 0, cascadeCommits: 0, renderMs: 0, longFrames: {}, interactions: {}, sources: [], ...extra });
  const run = {
    documents: [{ types }],
    steps: [
      { index: 0, name: 'load', action: 'goto', doc: 0, settled: true, network: [], console: [], stats: stats({ renders: 12, mounts: 12, components: [{ id: 0, renders: 1, mounts: 1 }, { id: 1, renders: 10, mounts: 10, instances: 10 }, { id: 2, renders: 1, mounts: 1 }] }) },
      {
        index: 1,
        name: 'type in search',
        action: 'type',
        doc: 0,
        settled: true,
        network: [],
        console: [],
        stats: stats({
          commits: 2,
          renders: 24,
          wasted: 22,
          components: [
            { id: 0, renders: 2, reasons: { state: 2 }, hooks: { 'useState #1': { count: 2, sample: '"" → "a"' } } },
            { id: 1, renders: 20, wasted: 20, instances: 10, reasons: { propsUnstable: 20 }, props: { onSelect: { changed: 0, fn: 20, sameContent: 0, element: 0 } }, owners: { 0: 20 }, causedBy: { 0: 20 } },
            { id: 2, renders: 2, wasted: 2, reasons: { parent: 2 }, owners: { 0: 2 }, causedBy: { 0: 2 } },
          ],
          sources: [{ id: 0, triggers: 2, renders: 24, wasted: 22, mounts: 0 }],
        }),
      },
    ],
  };

  it('ranks a state cascade and a broken memo, pointing each at the file to change', () => {
    const aggregated = aggregate({ runs: [run, run, run] }, { scope: ['/app/src'], repoRoot: '/app' });
    expect(aggregated.steps[1]).toMatchObject({ renders: 24, wasted: 22, scopeRenders: 24 });
    const found = hotspots(aggregated, { scopeConfigured: true });
    const cascade = found.find((hotspot) => hotspot.kind === 'cascade');
    expect(cascade).toMatchObject({ component: 'Page', file: '/app/src/Page.tsx', skill: 'react-rerenders', safety: 'auto', inScope: true });
    expect(cascade.evidence.join(' ')).toContain('useState #1');
    const memo = found.find((hotspot) => hotspot.kind === 'memo-broken');
    expect(memo).toMatchObject({ component: 'Row', fixIn: 'Page', skill: 'react-memoization' });
    expect(memo.evidence[0]).toContain('onSelect (new function ×20)');
    // Without render timing (a production build) nothing is judged.
    expect(found.every((hotspot) => hotspot.worth === null)).toBe(true);
  });

  // The same flow with render times: the cascade wastes 40 ms in step 1, and a ticker that copies
  // a prop into state in an effect costs a fraction of a millisecond.
  const timedRun = {
    documents: [{ types: [...types, { id: 3, name: 'Ticker', file: '/app/src/Ticker.tsx', line: 1, memo: false }] }],
    steps: [
      { ...run.steps[0], stats: stats({ renders: 12, mounts: 12, renderMs: 30, mountMs: 25, components: [{ id: 0, renders: 1, mounts: 1, selfMs: 5, mountMs: 5 }, { id: 1, renders: 10, mounts: 10, instances: 10, selfMs: 20, mountMs: 20 }] }) },
      {
        ...run.steps[1],
        stats: stats({
          commits: 3,
          renders: 26,
          wasted: 22,
          renderMs: 60,
          wastedMs: 40,
          components: [
            { id: 0, renders: 2, reasons: { state: 2 }, hooks: { 'useState #1': { count: 2, sample: '"" → "a"' } }, selfMs: 4, updateMs: 4, updateTreeMs: 60 },
            { id: 1, renders: 20, wasted: 20, instances: 10, reasons: { propsUnstable: 20 }, props: { onSelect: { changed: 0, fn: 20, sameContent: 0, element: 0 } }, owners: { 0: 20 }, causedBy: { 0: 20 }, selfMs: 38, updateMs: 38, updateTreeMs: 38, wastedMs: 38, wastedTreeMs: 38 },
            { id: 2, renders: 2, wasted: 2, reasons: { parent: 2 }, owners: { 0: 2 }, causedBy: { 0: 2 }, selfMs: 2, updateMs: 2, updateTreeMs: 2, wastedMs: 2, wastedTreeMs: 2 },
            { id: 3, renders: 2, reasons: { props: 1, state: 1 }, hooks: { 'useState #1': { count: 1, sample: '"0 items" → "1 items"' } }, cascades: 1, selfMs: 0.4, updateMs: 0.4, updateTreeMs: 0.4 },
          ],
          sources: [{ id: 0, triggers: 2, renders: 24, wasted: 22, mounts: 0, ms: 44, wastedMs: 40 }],
        }),
      },
    ],
  };
  const slowTyping = [
    { index: 0, name: 'load', slow: false },
    { index: 1, name: 'type in search', slow: true, renderBound: true, worst: { profile: 'mobile', reactMs: 120 } },
  ];

  it('ranks hotspots by the render time they would save in the slow steps', () => {
    const aggregated = aggregate({ runs: [timedRun, timedRun, timedRun] }, { scope: ['/app/src'], repoRoot: '/app' });
    expect(aggregated.steps[1]).toMatchObject({ renderMs: 60, wastedMs: 40 });
    // The triage measured 120 ms of React time in this step on mobile, twice what the tracker run saw.
    const found = hotspots(aggregated, { scopeConfigured: true, triage: slowTyping });
    const [first, second] = found;
    expect(first).toMatchObject({ kind: 'cascade', worth: true, saves: { step: 1, name: 'type in search', profile: 'mobile', ms: 80, measuredMs: 40 } });
    expect(first.evidence[0]).toBe('costs about 80 ms of render work in “type in search” on mobile (scaled from the 40 ms measured with the tracker)');
    expect(second).toMatchObject({ kind: 'memo-broken', worth: true, saves: { ms: 76 } });
    const ticker = found.find((hotspot) => hotspot.kind === 'effect-cascade');
    expect(ticker).toMatchObject({ component: 'Ticker', worth: false, saves: { ms: 0.4 } });
    expect(ticker.whyNot).toBe('it would save at most 0.4 ms of render work in “type in search” on mobile, less than a frame');
    expect(found.indexOf(ticker)).toBeGreaterThan(found.indexOf(second));

    // Without a triage every step counts, at the measured time.
    const untriaged = hotspots(aggregated, { scopeConfigured: true });
    expect(untriaged[0]).toMatchObject({ kind: 'cascade', worth: true, saves: { ms: 40, profile: null } });
    // When the triage found nothing slow, nothing is worth fixing.
    const calm = hotspots(aggregated, { scopeConfigured: true, triage: slowTyping.map((step) => ({ ...step, slow: false })) });
    expect(calm.every((hotspot) => hotspot.worth === false && hotspot.whyNot === 'no step is slow')).toBe(true);
  });
});

describe('backups', () => {
  it('restores edited files and removes files the fix created', () => {
    const repo = tempDir();
    const audit = join(repo, '.render-audit', 'audits', 'a1');
    const edited = join(repo, 'src', 'Page.tsx');
    const created = join(repo, 'src', 'SearchArea.tsx');
    mkdirSync(dirname(edited), { recursive: true });
    writeFileSync(edited, 'before');
    backup(audit, 'fix-1', repo, [edited, created]);
    writeFileSync(edited, 'after');
    writeFileSync(created, 'new component');
    const log = restore(audit, 'fix-1');
    expect(readFileSync(edited, 'utf8')).toBe('before');
    expect(existsSync(created)).toBe(false);
    expect(log).toEqual(['restored src/Page.tsx', 'removed src/SearchArea.tsx (created by the fix)']);
  });

  it('refuses files outside the repository', () => {
    const repo = tempDir();
    expect(() => backup(join(repo, 'audit'), 'fix-1', repo, ['/etc/hosts'])).toThrow(/outside/);
  });
});

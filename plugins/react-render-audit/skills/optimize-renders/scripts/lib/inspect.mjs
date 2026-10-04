// One page load with the tracker: is React there, what renders on load, and which elements a
// scenario can target.
import { relative } from 'node:path';
import { launchChrome } from './chrome.mjs';
import { inPageSource } from './inpage.mjs';
import { NetworkLog, evaluate, interactiveElements, navigate, openPage, resolveTypes, settle } from './page.mjs';
import { chromeMajor, profile as profileOf } from './profiles.mjs';
import { table } from './util.mjs';

/** `profile` ('mobile' or 'desktop') emulates the benchmark's device, to check targets exist there too. */
export async function inspect({ url, width = 1280, height = 800, profile, headless = true, appRoot, repoRoot, cookies, headers }) {
  const browser = await launchChrome({ headless, width, height });
  try {
    const screen = profile ? profileOf(profile, { chromeMajor: chromeMajor(browser.version.product) || '140' }) : { width, height };
    const { page, close } = await openPage(browser, { source: inPageSource('tracker'), ...screen, cookies, headers });
    try {
      const network = new NetworkLog(page);
      const started = Date.now();
      await navigate(page, url);
      const settled = await settle(page, network, { quietMs: 600, maxMs: 30000 });
      const stats = await evaluate(page, '__RENDER_AUDIT__.endStep()');
      const status = await evaluate(page, '__RENDER_AUDIT__.status()');
      const types = await resolveTypes(page, { appRoot, repoRoot, mapCache: new Map() });
      const elements = await interactiveElements(page);
      const title = await evaluate(page, 'document.title');
      return { url, title, profile: profile || null, loadMs: Date.now() - started, settled, stats, status, types, elements, chrome: browser.version.product };
    } finally {
      await close();
    }
  } finally {
    await browser.close();
  }
}

export function formatInspect(result, { appRoot } = {}) {
  const lines = [];
  const renderer = result.status.renderers[0];
  lines.push(`Page: ${result.title || '(no title)'} — ${result.url}${result.profile ? ` (${result.profile} profile)` : ''}`);
  if (renderer) {
    const build = renderer.bundleType === 1 ? 'development build' : 'production build (component names may be minified)';
    lines.push(`React ${renderer.version || '?'} (${build}), ${result.status.renderers.length} renderer(s), tracker ${result.status.hook}`);
  } else {
    lines.push('React: not detected. No renderer registered with the DevTools hook; is this page rendered by React?');
  }
  lines.push(`Load: ${result.settled.settled ? `settled after ${(result.loadMs / 1000).toFixed(1)} s` : 'did not settle within 30 s (continuous renders or open requests)'}; ${result.stats.commits} commits, ${result.stats.renders} component renders, ${result.stats.wasted} wasted`);
  if (result.status.errors.length) lines.push(`Tracker errors: ${result.status.errors.join(' | ')}`);

  const typeById = new Map(result.types.map((type) => [type.id, type]));
  const top = [...result.stats.components].sort((a, b) => b.renders - a.renders).slice(0, 15);
  if (top.length) {
    lines.push('', 'Most rendered on load:');
    lines.push(
      table(
        top.map((row) => {
          const type = typeById.get(row.id) || {};
          const where = type.file ? (appRoot ? relative(appRoot, type.file) : type.file) + (type.line ? `:${type.line}` : '') : '(unknown file)';
          return [type.name || '?', row.renders, `${row.instances} inst`, where];
        }),
        { indent: '  ' },
      ),
    );
  }
  const headings = result.elements.filter((element) => element.role === 'heading').slice(0, 12);
  if (headings.length) lines.push('', `Headings: ${headings.map((heading) => `"${heading.name}"`).join(', ')}`);
  const interactive = result.elements.filter((element) => element.role !== 'heading');
  if (interactive.length) {
    lines.push('', 'Interactive elements (scenario targets):');
    lines.push(
      table(
        interactive.map((element) => {
          const target = { role: element.role, name: element.name || undefined, nth: element.nth || undefined };
          return [`${element.role} "${element.name}"`, JSON.stringify(target)];
        }),
        { indent: '  ' },
      ),
    );
  }
  return lines.join('\n');
}

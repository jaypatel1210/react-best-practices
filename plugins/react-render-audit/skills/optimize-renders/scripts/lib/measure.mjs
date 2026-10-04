// Replays a scenario in headless Chrome with the render tracker installed, several times, and
// writes one JSON file per run (render data per step) plus one snapshot file per run (text, DOM
// and accessibility tree per step, used for the equivalence check).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from './chrome.mjs';
import { inPageSource } from './inpage.mjs';
import { ConsoleLog, NetworkLog, axSnapshot, evaluate, navigate, openPage, performAction, resolveTypes, settle } from './page.mjs';
import { stepLabel } from './scenario.mjs';
import { writeJson } from './util.mjs';

export { TRACKER_PATH } from './inpage.mjs';

export function absoluteUrl(url, base) {
  try {
    return new URL(url || '', base || undefined).href;
  } catch {
    throw new Error(`"${url}" isn't a valid URL${base ? ` relative to ${base}` : ''}. Pass --url with the app's address.`);
  }
}

async function runScenario(browser, scenario, options, screenshotDir) {
  const { width, height, appRoot, repoRoot, mapCache, cpu, quietMs, maxSettleMs, baseUrl } = options;
  const ignoreSelectors = [...(options.ignoreSelectors || []), ...scenario.ignoreSelectors];
  const { page, close } = await openPage(browser, {
    source: options.trackerSource,
    width,
    height,
    cookies: options.cookies,
    headers: options.headers,
  });
  const network = new NetworkLog(page, [...(options.ignoreRequests || []), ...scenario.ignoreRequests]);
  const consoleLog = new ConsoleLog(page);
  const steps = [{ ...scenario.load, action: 'goto', url: scenario.url, name: scenario.load.name || 'load' }, ...scenario.steps];
  const records = [];
  const snaps = [];
  const documents = [];
  const locate = () => resolveTypes(page, { appRoot, repoRoot, mapCache });

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const name = stepLabel(step, i);
      const isNavigation = step.action === 'goto';
      if (i > 0) {
        if (isNavigation) {
          records[i - 1].stats = await evaluate(page, '__RENDER_AUDIT__.endStep()');
          documents.push({ types: await locate() });
        } else {
          records[i - 1].stats = await evaluate(page, `__RENDER_AUDIT__.endStep(${JSON.stringify(name)})`);
        }
      }
      network.begin(i);
      consoleLog.begin(i);
      const started = Date.now();
      try {
        if (isNavigation) {
          network.skipNextDocument();
          await navigate(page, absoluteUrl(step.url, baseUrl));
        }
        else await performAction(page, step, { width, height });
      } catch (error) {
        throw new Error(`Step ${i} "${name}" failed: ${error.message}`);
      }
      const settled = await settle(page, network, {
        quietMs: step.quietMs ?? quietMs,
        maxMs: step.maxSettleMs ?? (isNavigation ? maxSettleMs * 3 : maxSettleMs),
      });
      if (i === 0 && cpu > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: cpu });

      const snap = (await evaluate(page, `__RENDER_AUDIT__.snapshot(${JSON.stringify(ignoreSelectors)})`).catch(() => null)) || {};
      snaps.push({ index: i, name, text: snap.text || '', dom: snap.dom || '', a11y: await axSnapshot(page) });
      let screenshot = null;
      if (screenshotDir) {
        try {
          const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
          mkdirSync(screenshotDir, { recursive: true });
          screenshot = join(screenshotDir, `step-${String(i).padStart(2, '0')}.jpg`);
          writeFileSync(screenshot, Buffer.from(data, 'base64'));
        } catch {
          screenshot = null;
        }
      }
      records.push({
        index: i,
        name,
        action: step.action || 'goto',
        doc: documents.length,
        settled: settled.settled,
        settleMs: settled.ms,
        elapsedMs: Date.now() - started,
        network: network.list(i),
        console: consoleLog.list(i),
        screenshot,
        stats: null,
      });
    }
    records[records.length - 1].stats = await evaluate(page, '__RENDER_AUDIT__.endStep()');
    const status = await evaluate(page, '__RENDER_AUDIT__.status()');
    documents.push({ types: await locate() });
    return { records, snaps, documents, status };
  } finally {
    await close();
  }
}

function summarize(result) {
  let commits = 0;
  let renders = 0;
  let wasted = 0;
  for (const record of result.records) {
    if (!record.stats) continue;
    commits += record.stats.commits;
    renders += record.stats.renders;
    wasted += record.stats.wasted;
  }
  const unsettled = result.records.filter((record) => !record.settled).length;
  return `${result.records.length} steps, ${commits} commits, ${renders} renders (${wasted} wasted)${unsettled ? `, ${unsettled} step(s) never settled` : ''}`;
}

/**
 * Measures a scenario. Options: scenario (from loadScenario), outDir, baseUrl, runs, warmup, cpu,
 * headless, width, height, appRoot, repoRoot, screenshots ('first' | 'all' | 'none'),
 * ignoreSelectors, ignoreRequests, cookies, headers, quietMs, maxSettleMs, log.
 */
export async function measure(options) {
  const {
    scenario,
    outDir,
    runs = 3,
    warmup = 1,
    headless = true,
    width = 1280,
    height = 800,
    screenshots = 'first',
    log = (line) => process.stderr.write(`${line}\n`),
  } = options;
  mkdirSync(outDir, { recursive: true });
  const trackerSource = inPageSource('tracker');
  const startedAt = new Date().toISOString();
  const browser = await launchChrome({ headless, width, height });
  const shared = {
    quietMs: 500,
    maxSettleMs: 10000,
    cpu: 1,
    ...options,
    width,
    height,
    trackerSource,
    mapCache: new Map(),
  };
  let react = null;
  try {
    for (let run = 1 - warmup; run <= runs; run++) {
      const measured = run >= 1;
      const label = measured ? `run ${run}/${runs}` : 'warm-up';
      const wantScreens = measured && (screenshots === 'all' || (screenshots === 'first' && run === 1));
      const t0 = Date.now();
      const result = await runScenario(browser, scenario, shared, wantScreens ? join(outDir, 'screens', `run-${run}`) : null);
      const renderer = result.status && result.status.renderers && result.status.renderers[0];
      if (!renderer) log(`warning: no React renderer registered on ${scenario.url || shared.baseUrl}; is this a React page?`);
      else react = { version: renderer.version, development: renderer.bundleType === 1 };
      if (result.status && result.status.errors && result.status.errors.length) log(`tracker errors: ${result.status.errors.join(' | ')}`);
      log(`${label}: ${summarize(result)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      if (!measured) continue;
      writeJson(join(outDir, `run-${run}.json`), {
        scenario: scenario.name,
        run,
        url: absoluteUrl(scenario.url, shared.baseUrl),
        react,
        steps: result.records,
        documents: result.documents,
        trackerErrors: (result.status && result.status.errors) || [],
      });
      writeJson(join(outDir, `run-${run}.snap.json`), { steps: result.snaps });
    }
  } finally {
    await browser.close();
  }
  const meta = {
    scenario: scenario.name,
    scenarioFile: scenario.file,
    description: scenario.description,
    url: absoluteUrl(scenario.url, shared.baseUrl),
    runs,
    warmup,
    cpu: shared.cpu,
    viewport: { width, height },
    chrome: browser.version.product,
    react,
    appRoot: shared.appRoot,
    repoRoot: shared.repoRoot,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeJson(join(outDir, 'meta.json'), meta);
  return meta;
}

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLSThresholds, FCPThresholds, INPThresholds, LCPThresholds, TTFBThresholds } from 'web-vitals';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareBaseline, removeBaseline } from '../skills/optimize-renders/scripts/lib/baseline.mjs';
import { aaSummary, analyzePairs, benchExitCode, benchMarkdown, comparisonRows, flowOf, formatBench, responseMs, responseTime } from '../skills/optimize-renders/scripts/lib/bench.mjs';
import { ciWorkflow } from '../skills/optimize-renders/scripts/lib/ci.mjs';
import { aroundDeploy, compareRecords, cruxRequest, parseCruxHistory, parseCruxRecord, parseRecords, splitRecords } from '../skills/optimize-renders/scripts/lib/field.mjs';
import { MOBILE_TARGET_INDEX, chromeMajor, profile, rateFor } from '../skills/optimize-renders/scripts/lib/profiles.mjs';
import { NetworkReplay, replayHeaders, requestKey } from '../skills/optimize-renders/scripts/lib/replay.mjs';
import { writeReport } from '../skills/optimize-renders/scripts/lib/report.mjs';
import { THRESHOLDS, cautious, impactOf, pairedDiff, plannedPairs, quantile, quantileCI, quantileDiff, rating, verdict } from '../skills/optimize-renders/scripts/lib/stats.mjs';

const temp = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'render-audit-bench-')));
  temp.push(dir);
  return dir;
}

// A run as runOnce records it, with only the fields the analysis reads.
function run(steps) {
  return {
    steps: steps.map((step, index) => ({
      index,
      name: step.name || `step ${index}`,
      action: step.action || (index === 0 ? 'goto' : 'click'),
      interactive: step.interactive ?? index > 0,
      settled: true,
      inp: step.inp ?? null,
      interaction: step.inp ? { inputDelay: 1, processing: step.inp - 3, presentation: 2, target: 'button[Add]' } : null,
      tbt: step.tbt ?? 0,
      longFrames: step.longFrames ?? 0,
      dropped: step.dropped ?? 0,
      smoothness: 100,
      reactMs: step.reactMs ?? 0,
      commits: 1,
      mainThread: step.mainThread ?? 10,
      script: 0,
      layout: 0,
      style: 0,
    })),
  };
}

describe('statistics', () => {
  it('uses the same Core Web Vitals thresholds as web-vitals', () => {
    expect(THRESHOLDS.INP).toEqual(INPThresholds);
    expect(THRESHOLDS.LCP).toEqual(LCPThresholds);
    expect(THRESHOLDS.CLS).toEqual(CLSThresholds);
    expect(THRESHOLDS.FCP).toEqual(FCPThresholds);
    expect(THRESHOLDS.TTFB).toEqual(TTFBThresholds);
    expect([rating('INP', 200), rating('INP', 201), rating('INP', 501), rating('CLS', 0.1)]).toEqual(['good', 'needs-improvement', 'poor', 'good']);
  });

  it('gives the sign-test interval for a median (ranks 6 and 15 of 20)', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    const ci = quantileCI(values, 0.5);
    expect(ci).toMatchObject({ n: 20, estimate: 10.5, low: 6, high: 15, exact: true });
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
  });

  it('flags samples too small for 95% and falls back to the full range', () => {
    const ci = quantileCI([3, 1, 2, 5, 4], 0.5);
    expect(ci).toMatchObject({ low: 1, high: 5, exact: false });
    expect(quantileCI([1, 2, 3, 4, 5, 6], 0.5).exact).toBe(true);
  });

  it('compares paired runs and judges only when the interval excludes zero', () => {
    const a = [100, 104, 98, 101, 103, 99, 102, 100, 97, 105];
    const faster = pairedDiff(a, a.map((value, i) => value - 40 + (i % 3)));
    expect(faster.diff).toBeLessThan(-37);
    expect(verdict(faster)).toBe('better');
    expect(cautious(faster)).toBeGreaterThanOrEqual(38);
    expect(faster.relative).toBeCloseTo(-0.39, 1);
    const same = pairedDiff(a, a.map((value, i) => value + (i % 2 ? 2 : -2)));
    expect(verdict(same)).toBe('same');
    expect(cautious(same)).toBe(0);
    expect(verdict(pairedDiff(a, a.map((value) => value + 30)))).toBe('worse');
  });

  it('claims nothing when there are too few pairs for a 95% interval', () => {
    const two = pairedDiff([100, 104], [160, 170]);
    expect(two.exact).toBe(false);
    expect(verdict(two)).toBe('same');
    expect(impactOf({ mainThread: two })).toEqual({ level: 'none', direction: 'same', reasons: [], judged: false });
  });

  it('plans more pairs for noisier machines, within limits', () => {
    expect(plannedPairs([0, 0, 0, 0], 16)).toBe(8);
    expect(plannedPairs([-30, 25, -20, 35, -28, 22], 16, { max: 20 })).toBe(20);
    expect(plannedPairs([-2, 1, -1, 2, 0, 1], 16)).toBe(8);
  });

  it('compares quantiles of two independent samples conservatively', () => {
    const before = Array.from({ length: 1000 }, (_, i) => 100 + (i % 200));
    const after = before.map((value) => value - 50);
    const result = quantileDiff(before, after, 0.75);
    expect(result.diff).toBeCloseTo(-50, 0);
    expect(result.low).toBeLessThanOrEqual(-50);
    expect(result.high).toBeGreaterThanOrEqual(-50);
    expect(verdict(result)).toBe('better');
    expect(verdict(quantileDiff(before, before.slice().reverse(), 0.75))).toBe('same');
  });

  it('grades impact on the cautious end of each interval', () => {
    const shift = (from, by, n = 10) => pairedDiff(Array(n).fill(from).map((v, i) => v + i), Array(n).fill(from + by).map((v, i) => v + i));
    expect(impactOf({ inp: shift(240, -100) }).level).toBe('high'); // needs improvement -> good
    expect(impactOf({ inp: shift(140, -30) })).toMatchObject({ level: 'medium', direction: 'better' });
    expect(impactOf({ inp: shift(40, -8), mainThread: shift(200, -5) }).level).toBe('low');
    expect(impactOf({ inp: shift(40, 0), mainThread: shift(100, 0) }).level).toBe('none');
    expect(impactOf({ mainThread: shift(100, 40) })).toMatchObject({ level: 'medium', direction: 'worse' });
    expect(impactOf({ mainThread: shift(300, -10), tbt: shift(400, -150) }).level).toBe('high');
  });
});

describe('benchmark analysis', () => {
  it('uses Event Timing\'s floor for interactions it did not report', () => {
    expect(responseTime({ interactive: true, inp: null })).toBe(16);
    expect(responseTime({ interactive: false, inp: null })).toBeNull();
    expect(responseMs(16)).toBe('≤16 ms');
    expect(responseMs(48)).toBe('48 ms');
    expect(flowOf(run([{ mainThread: 50 }, { inp: 40, mainThread: 20 }, { inp: null, mainThread: 5 }]))).toMatchObject({ inp: 40, mainThread: 75 });
  });

  it('finds the faster side step by step and for the whole flow', () => {
    const runsA = [];
    const runsB = [];
    for (let i = 0; i < 10; i++) {
      runsA.push(run([{ mainThread: 70 + (i % 3) }, { inp: 240 + 8 * (i % 2), mainThread: 200 + i }, { inp: 40, mainThread: 30 }]));
      runsB.push(run([{ mainThread: 71 - (i % 3) }, { inp: 120 + 8 * (i % 2), mainThread: 90 + i }, { inp: 40, mainThread: 30 }]));
    }
    const { steps, flow } = analyzePairs(runsA, runsB);
    expect(steps[0].impact.level).toBe('none');
    expect(steps[1].impact).toMatchObject({ level: 'high', direction: 'better' });
    expect(steps[1].rating).toEqual({ a: 'needs-improvement', b: 'good' });
    expect(steps[1].breakdown.a.target).toBe('button[Add]');
    expect(steps[2].impact.level).toBe('none');
    expect(flow.impact.direction).toBe('better');
    const result = { mode: 'compare', protocol: 1, sides: { a: { label: 'before', url: 'http://a' }, b: { label: 'after', url: 'http://b' } }, results: [{ profile: 'mobile', scenario: 'store', viewport: { width: 412, height: 823, deviceScaleFactor: 1.75 }, cpuRate: 4, pairs: 10, aa: null, analysis: { steps, flow }, traces: {} }] };
    const rows = comparisonRows(result.results[0]);
    expect(rows[1]).toMatchObject({ metric: 'response time', rating: 'needs improvement → good', verdict: 'better' });
    expect(rows[1].change).toMatch(/^−12\d ms \(−/);
    expect(formatBench(result)).toContain('needs improvement → good');
    expect(benchMarkdown(result)).toContain('| 1 | step 1 | response time | 244 ms → 124 ms |');
    expect(benchExitCode(result, 'slower')).toBe(0);
    expect(benchExitCode(result, 'no-gain')).toBe(0);
    const reversed = { ...result, results: [{ ...result.results[0], analysis: analyzePairs(runsB, runsA) }] };
    expect(benchExitCode(reversed, 'slower')).toBe(4);
    expect(benchExitCode(reversed, 'no-gain')).toBe(5);
  });

  it('cancels an order effect in the A/A check by alternating labels', () => {
    // The second of two identical runs is always 10 ms faster (warm caches).
    const pairs = Array.from({ length: 8 }, (_, i) => [run([{ mainThread: 100 + i }]), run([{ mainThread: 90 + i }])]);
    const aa = aaSummary(pairs);
    expect(aa.judged).toBe(true);
    expect(aa.mainThread.verdict).toBe('same');
    expect(aa.ok).toBe(true);
    expect(aaSummary(pairs.slice(0, 3))).toMatchObject({ judged: false, ok: true });
  });

  it('fails the A/A check only on a difference big enough to matter', () => {
    // A small but systematic blocking-time difference (1-37 ms on ~700 ms) is harmless...
    const small = Array.from({ length: 6 }, (_, i) => {
      const extra = [1, 18, 37, 8, 10, 2][i];
      const x = run([{ mainThread: 1800 + i, tbt: 690 }]);
      const y = run([{ mainThread: 1800 + i, tbt: 690 + extra }]);
      return i % 2 === 0 ? [x, y] : [y, x];
    });
    expect(aaSummary(small)).toMatchObject({ judged: true, ok: true, material: [] });
    // ...while identical runs differing by 60 ms or more of main-thread time are not.
    const large = Array.from({ length: 6 }, (_, i) => {
      const x = run([{ mainThread: 1800 + i }]);
      const y = run([{ mainThread: 1860 + i * 5 }]);
      return i % 2 === 0 ? [x, y] : [y, x];
    });
    expect(aaSummary(large)).toMatchObject({ judged: true, ok: false, material: ['mainThread'] });
  });
});

describe('device profiles', () => {
  it('matches Lighthouse\'s screens and calibrates the mobile CPU', () => {
    expect(profile('mobile', { chromeMajor: '141' })).toMatchObject({ width: 412, height: 823, deviceScaleFactor: 1.75, mobile: true });
    expect(profile('mobile', { chromeMajor: '141' }).userAgent).toContain('Chrome/141.0.0.0 Mobile');
    expect(profile('desktop')).toMatchObject({ width: 1350, height: 940, deviceScaleFactor: 1, mobile: false });
    expect(() => profile('tablet')).toThrow(/Unknown profile/);
    expect(chromeMajor('HeadlessChrome/141.0.7390.54')).toBe('141');
    expect(rateFor(1750)).toBe(4);
    expect(rateFor(3500)).toBe(8);
    expect(rateFor(MOBILE_TARGET_INDEX / 2)).toBe(1);
    expect(rateFor(1e6)).toBe(20);
  });
});

describe('network replay', () => {
  it('identifies requests without cache busters and regardless of JSON key order', () => {
    const a = requestKey({ method: 'POST', url: 'https://api.test/graphql?b=2&a=1&_=123', postData: '{"query":"q","variables":{"x":1,"y":2}}' });
    const b = requestKey({ method: 'POST', url: 'https://api.test/graphql?a=1&b=2', postData: '{"variables":{"y":2,"x":1},"query":"q"}' });
    expect(a).toBe(b);
    expect(requestKey({ method: 'POST', url: 'https://api.test/graphql', postData: '{"variables":{"x":2}}' })).not.toBe(requestKey({ method: 'POST', url: 'https://api.test/graphql', postData: '{"variables":{"x":1}}' }));
  });

  it('serves bodies decoded and re-points a specific CORS origin at the replaying page', () => {
    const headers = [
      { name: 'Content-Encoding', value: 'gzip' },
      { name: 'Content-Length', value: '120' },
      { name: 'Access-Control-Allow-Origin', value: 'http://localhost:3101' },
      { name: 'Content-Type', value: 'application/json' },
    ];
    expect(replayHeaders(headers, { recordedOrigin: 'http://localhost:3101', pageOrigin: 'http://localhost:3000' })).toEqual([
      { name: 'Access-Control-Allow-Origin', value: 'http://localhost:3000' },
      { name: 'Content-Type', value: 'application/json' },
    ]);
  });

  it('records cross-origin responses once, then replays them in order', async () => {
    const page = () => {
      const handlers = {};
      const sent = [];
      return {
        sent,
        on: (method, handler) => {
          handlers[method] = handler;
          return () => {};
        },
        send: async (method, params) => {
          sent.push([method, params]);
          if (method === 'Fetch.getResponseBody') return { body: `{"n":${sent.filter(([m]) => m === 'Fetch.getResponseBody').length}}`, base64Encoded: false };
          return {};
        },
        fire: (event) => handlers['Fetch.requestPaused'](event),
      };
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const replay = new NetworkReplay();
    const recorder = page();
    const recording = await replay.attach(recorder, { appOrigin: 'http://localhost:3101' });
    expect(recorder.sent[0]).toEqual(['Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'XHR', requestStage: 'Response' }, { urlPattern: '*', resourceType: 'Fetch', requestStage: 'Response' }] }]);
    const api = { method: 'GET', url: 'https://api.test/items?page=1', headers: {} };
    recorder.fire({ requestId: '1', request: api, responseStatusCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }] });
    recorder.fire({ requestId: '2', request: api, responseStatusCode: 200, responseHeaders: [] });
    recorder.fire({ requestId: '3', request: { method: 'GET', url: 'http://localhost:3101/api/me', headers: {} }, responseStatusCode: 200, responseHeaders: [] });
    await settle();
    expect(recording.recorded).toBe(2);
    expect(replay.summary()).toEqual({ requests: 2, distinct: 1, byOrigin: { 'https://api.test': 2 } });
    replay.freeze();

    const player = page();
    const counters = await replay.attach(player, { appOrigin: 'http://localhost:3000', appOrigins: ['http://localhost:3101', 'http://localhost:3000'] });
    expect(player.sent[0][1].patterns.map((pattern) => pattern.urlPattern)).toEqual(['https://api.test/*', 'https://api.test/*']);
    player.fire({ requestId: 'a', request: { ...api, url: 'https://api.test/items?page=1&_=999' } });
    player.fire({ requestId: 'b', request: api });
    player.fire({ requestId: 'c', request: api });
    player.fire({ requestId: 'd', request: { method: 'GET', url: 'https://api.test/other', headers: {} } });
    await settle();
    const fulfilled = player.sent.filter(([method]) => method === 'Fetch.fulfillRequest').map(([, params]) => Buffer.from(params.body, 'base64').toString());
    expect(fulfilled).toEqual(['{"n":1}', '{"n":2}', '{"n":2}']);
    expect(counters).toMatchObject({ mode: 'replay', served: 3, passed: 1, misses: ['GET https://api.test/other'] });
  });

  it('lets analytics beacons through without recording them', async () => {
    const sent = [];
    let handler;
    const page = {
      on: (method, fn) => ((handler = fn), () => {}),
      send: async (method, params) => (sent.push([method, params]), {}),
    };
    const replay = new NetworkReplay();
    const counters = await replay.attach(page, { appOrigin: 'http://localhost:4000' });
    handler({ requestId: 'g', request: { method: 'POST', url: 'https://www.google-analytics.com/g/collect?cid=1&_p=2', headers: {} }, responseStatusCode: 204, responseHeaders: [] });
    handler({ requestId: 'c', request: { method: 'POST', url: 'https://b.clarity.ms/collect', headers: {} }, responseStatusCode: 204, responseHeaders: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(counters.recorded).toBe(0);
    expect(replay.summary().requests).toBe(0);
    expect(sent.filter(([method]) => method === 'Fetch.continueRequest')).toHaveLength(2);
  });

  it('never records requests to either side\'s own server', async () => {
    const sent = [];
    let handler;
    const recorder = {
      on: (method, fn) => ((handler = fn), () => {}),
      send: async (method, params) => {
        sent.push([method, params]);
        return method === 'Fetch.getResponseBody' ? { body: '{}', base64Encoded: false } : {};
      },
    };
    const replay = new NetworkReplay();
    // The baseline (port 4100) calls the candidate's server (port 4000) because of a shared env file.
    const counters = await replay.attach(recorder, { appOrigin: 'http://localhost:4100', appOrigins: ['http://localhost:4100', 'http://localhost:4000'] });
    handler({ requestId: '1', request: { method: 'GET', url: 'http://localhost:4000/api/session', headers: {} }, responseStatusCode: 200, responseHeaders: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(counters.recorded).toBe(0);
    expect(sent.filter(([method]) => method === 'Fetch.getResponseBody')).toHaveLength(0);
    expect(sent.at(-1)).toEqual(['Fetch.continueRequest', { requestId: '1' }]);
  });
});

describe('field data', () => {
  const record = {
    record: {
      key: { origin: 'https://example.com', formFactor: 'PHONE' },
      metrics: {
        interaction_to_next_paint: { histogram: [{ start: 0, end: 200, density: 0.71 }, { start: 200, end: 500, density: 0.21 }, { start: 500, density: 0.08 }], percentiles: { p75: 236 } },
        cumulative_layout_shift: { histogram: [{ start: '0.00', end: '0.10', density: 0.9 }, { start: '0.10', end: '0.25', density: 0.06 }, { start: '0.25', density: 0.04 }], percentiles: { p75: '0.05' } },
      },
      collectionPeriod: { firstDate: { year: 2026, month: 9, day: 6 }, lastDate: { year: 2026, month: 10, day: 3 } },
    },
  };

  it('reads a CrUX record', () => {
    const parsed = parseCruxRecord(record);
    expect(parsed.period).toEqual({ first: '2026-09-06', last: '2026-10-03' });
    expect(parsed.metrics.INP).toEqual({ p75: 236, rating: 'needs-improvement', good: 0.71, needsImprovement: 0.21, poor: 0.08 });
    expect(parsed.metrics.CLS.p75).toBe(0.05);
    expect(cruxRequest({ origin: 'https://example.com', formFactor: 'mobile', history: true, weeks: 99 })).toEqual({
      endpoint: 'https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord',
      body: { metrics: ['interaction_to_next_paint', 'largest_contentful_paint', 'cumulative_layout_shift'], origin: 'https://example.com', formFactor: 'PHONE', collectionPeriodCount: 40 },
    });
    expect(() => cruxRequest({})).toThrow(/exactly one/);
  });

  it('splits CrUX history around a deploy into clean before and after windows', () => {
    const periods = [
      ['2026-08-09', '2026-09-05'],
      ['2026-08-16', '2026-09-12'],
      ['2026-08-23', '2026-09-19'],
      ['2026-10-04', '2026-10-31'],
      ['2026-10-11', '2026-11-07'],
    ].map(([first, last]) => ({ firstDate: { year: +first.slice(0, 4), month: +first.slice(5, 7), day: +first.slice(8) }, lastDate: { year: +last.slice(0, 4), month: +last.slice(5, 7), day: +last.slice(8) } }));
    const history = parseCruxHistory({ record: { key: { origin: 'https://example.com' }, collectionPeriods: periods, metrics: { interaction_to_next_paint: { percentilesTimeseries: { p75s: [310, 305, null, 190, 185] }, histogramTimeseries: [{ start: 0, end: 200, densities: [0.6, 0.61, 'NaN', 0.8, 0.82] }] } } } });
    expect(history.series.INP[2]).toMatchObject({ p75: null, good: null });
    const split = aroundDeploy(history, '2026-10-04');
    expect(split.metrics.INP).toMatchObject({ before: { last: '2026-09-12', p75: 305 }, after: { first: '2026-10-04', p75: 190 }, change: -115, ratingBefore: 'needs-improvement', ratingAfter: 'good' });
    expect(split.firstCleanWindowEnds).toBe('2026-10-31');
    expect(split.expectedBy).toBe('2026-11-02');
  });

  it('reads real-user records as JSON lines, batches, arrays or CSV', () => {
    expect(parseRecords('{"name":"INP","value":120}\n[{"name":"INP","value":80},{"name":"LCP","value":2100}]\n')).toHaveLength(3);
    expect(parseRecords('[{"name":"INP","value":"64"}]')[0].value).toBe(64);
    const csv = parseRecords('name,value,page,time\nINP,180,"/a, b",2026-10-01T10:00:00Z\nINP,x,/a,\n');
    expect(csv).toEqual([{ name: 'INP', value: 180, page: '/a, b', time: Date.parse('2026-10-01T10:00:00Z') }]);
  });

  it('compares p75 before and after a deploy, overall and per page', () => {
    const records = [];
    for (let i = 0; i < 400; i++) {
      const day = i % 2 ? '2026-09-28' : '2026-10-06';
      const after = day > '2026-10-04';
      records.push({ name: 'INP', value: (after ? 120 : 260) + (i % 50), page: i % 4 ? '/home' : '/rare', time: Date.parse(`${day}T12:00:00Z`) });
    }
    const { before, after } = splitRecords(records, { at: '2026-10-04' });
    expect([before.length, after.length]).toEqual([200, 200]);
    const result = compareRecords(before, after, { metric: 'INP', by: 'page', minSamples: 60 });
    expect(result.overall).toMatchObject({ verdict: 'better', ratingBefore: 'needs-improvement', ratingAfter: 'good' });
    expect(result.groups.find((group) => group.key === '/home').verdict).toBe('better');
    expect(result.groups.find((group) => group.key === '/rare').verdict).toBe('too few samples');
  });
});

describe('CI workflow', () => {
  it('benchmarks the base commit against the pull request on fresh dev servers', () => {
    const yaml = ciWorkflow({ app: 'apps/booking', scenarios: ['apps/booking/.render-audit/scenarios/company.json'], dev: 'pnpm dev:booking -- --port {port}', devCwd: '.', packageManager: 'pnpm', pnpmVersion: '10', paths: ['apps/booking/**'] });
    expect(yaml).toContain("      - 'apps/booking/**'");
    expect(yaml).toContain('      - uses: pnpm/action-setup@v6');
    expect(yaml).toContain("          version: '10'");
    expect(yaml).toContain('          cache: pnpm');
    expect(yaml).toContain('        run: pnpm install --frozen-lockfile');
    expect(yaml).toContain('baseline --root "apps/booking" --ref "${{ github.event.pull_request.base.sha }}" --dir "$RUNNER_TEMP/baseline"');
    expect(yaml).toContain('--a http://localhost:4100 --a-label base --a-cmd "pnpm dev:booking -- --port {port}" --a-cwd "$RUNNER_TEMP/baseline"');
    expect(yaml).toContain('--b-cwd "$GITHUB_WORKSPACE"');
    expect(yaml).toContain('--profiles mobile,desktop --markdown "$GITHUB_STEP_SUMMARY" --fail-on slower');
    expect(yaml).not.toMatch(/\t/);
    for (const line of yaml.split('\n')) expect(line.length - line.trimStart().length).toSatisfy((indent) => indent % 2 === 0);
  });

  it('sets up other package managers and checks its inputs', () => {
    const npm = ciWorkflow({ scenarios: ['s.json'], dev: 'npm run dev -- --port {port}', packageManager: 'npm', failOn: 'none' });
    expect(npm).toContain('          cache: npm');
    expect(npm).toContain('        run: npm ci');
    expect(npm).not.toContain('--fail-on');
    expect(npm).toContain('--a-cwd "$RUNNER_TEMP/baseline"');
    expect(ciWorkflow({ scenarios: ['s.json'], dev: 'yarn dev --port {port}', packageManager: 'yarn-berry' })).toContain('run: corepack enable');
    expect(ciWorkflow({ scenarios: ['s.json'], dev: 'bun dev --port {port}', packageManager: 'bun' })).toContain('uses: oven-sh/setup-bun@v2');
    expect(() => ciWorkflow({ scenarios: ['s.json'], dev: 'npm run dev' })).toThrow(/\{port\}/);
    expect(() => ciWorkflow({ scenarios: [], dev: 'x {port}' })).toThrow(/scenario/);
    expect(() => ciWorkflow({ app: '../outside', scenarios: ['s.json'], dev: 'x {port}' })).toThrow(/relative/);
  });
});

describe('baseline checkout', () => {
  function repo() {
    const dir = tempDir();
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(join(dir, 'app'));
    writeFileSync(join(dir, 'app', 'package.json'), '{"name":"app"}');
    writeFileSync(join(dir, 'app', '.env.example'), 'TRACKED=1');
    writeFileSync(join(dir, '.gitignore'), '.env.local\n');
    git('add', '.');
    git('commit', '-qm', 'first');
    writeFileSync(join(dir, 'app', 'version.txt'), 'second');
    git('add', '.');
    git('commit', '-qm', 'second');
    writeFileSync(join(dir, 'app', '.env.local'), 'SECRET=value');
    return dir;
  }

  it('checks out a commit outside the repository and links untracked env files by name', async () => {
    const dir = repo();
    const target = join(tempDir(), 'baseline');
    const info = await prepareBaseline({ repoRoot: join(dir, 'app'), appRoot: join(dir, 'app'), ref: 'HEAD~1', dir: target, install: 'none' });
    expect(info).toMatchObject({ dir: target, appDir: join(target, 'app'), installed: false, reused: false, envLinks: ['app/.env.local'] });
    expect(existsSync(join(target, 'app', 'version.txt'))).toBe(false);
    expect(lstatSync(join(target, 'app', '.env.local')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(target, 'app', '.env.example')).isSymbolicLink()).toBe(false);
    const again = await prepareBaseline({ repoRoot: dir, appRoot: join(dir, 'app'), ref: 'HEAD~1', dir: target, install: 'none' });
    expect(again.reused).toBe(true);
    await expect(prepareBaseline({ repoRoot: dir, appRoot: join(dir, 'app'), ref: 'HEAD', dir: target, install: 'none' })).rejects.toThrow(/isn't a checkout/);
    await expect(prepareBaseline({ repoRoot: dir, appRoot: join(dir, 'app'), dir: join(dir, 'inside'), install: 'none' })).rejects.toThrow(/outside the repository/);
    removeBaseline({ repoRoot: dir, dir: target });
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(join(dir, 'app', '.env.local'), 'utf8')).toBe('SECRET=value');
  });
});

describe('report', () => {
  it('writes a speed report from a benchmark alone', () => {
    const audit = tempDir();
    const runsA = [];
    const runsB = [];
    for (let i = 0; i < 8; i++) {
      runsA.push(run([{ mainThread: 300 + i }, { inp: 176 + i, mainThread: 120 }]));
      runsB.push(run([{ mainThread: 300 - i }, { inp: 32 + i, mainThread: 40 }]));
    }
    const result = {
      protocol: 1,
      mode: 'compare',
      sides: { a: { label: 'baseline HEAD~3', url: 'http://localhost:4100', sha: 'a'.repeat(40) }, b: { label: 'working tree', url: 'http://localhost:4200', sha: 'b'.repeat(40) } },
      settings: { replay: true },
      environment: { chrome: 'HeadlessChrome/141', cpu: 'Test CPU', cores: 8, os: 'Test OS', power: 'AC power' },
      calibration: { hostIndex: 1750, rate: 4, throttledIndex: 440, target: 438 },
      results: [{ profile: 'mobile', scenario: 'store', viewport: { width: 412, height: 823, deviceScaleFactor: 1.75 }, cpuRate: 4, pairs: 8, aa: { pairs: 6, judged: true, ok: true }, replay: { requests: 3, distinct: 2 }, traces: { a: 'traces/mobile-store-a.json', b: 'traces/mobile-store-b.json' }, analysis: analyzePairs(runsA, runsB) }],
    };
    mkdirSync(join(audit, 'bench', 'final'), { recursive: true });
    writeFileSync(join(audit, 'bench', 'final', 'bench.json'), JSON.stringify(result));
    const { html, markdown } = writeReport({ audit, appRoot: audit });
    const page = readFileSync(html, 'utf8');
    expect(page).toContain('Measured speed-up');
    expect(page).toContain('the slowest response went from 180 ms to 36 ms');
    expect(page).toContain('href="bench/final/traces/mobile-store-b.json"');
    expect(page).toContain('BenchmarkIndex 1750');
    expect(readFileSync(markdown, 'utf8')).toContain('| 1 | step 1 | response time | 180 ms → 36 ms |');
  });
});

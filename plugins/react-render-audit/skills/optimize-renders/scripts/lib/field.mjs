// Field data: how real users experience the app, before and after a change ships.
//
//   CrUX     Google's Chrome UX Report (public sites with enough traffic): the 75th percentile of
//            INP, LCP and CLS over a rolling 28-day window, now or week by week.
//   own RUM  records sent by assets/web-vitals-reporter.js (or anything in the same shape),
//            compared before and after a deploy with the same statistics as the benchmark.
import { existsSync, readFileSync } from 'node:fs';
import { THRESHOLDS, quantileDiff, rating, ratingLabel, verdict } from './stats.mjs';
import { round, table } from './util.mjs';

const CRUX_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records';
export const CRUX_METRICS = {
  interaction_to_next_paint: 'INP',
  largest_contentful_paint: 'LCP',
  cumulative_layout_shift: 'CLS',
};
const FORM_FACTORS = { phone: 'PHONE', mobile: 'PHONE', desktop: 'DESKTOP', tablet: 'TABLET' };

// ---------------------------------------------------------------------------------------------
// CrUX

function dateOf(value) {
  return value ? `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}` : null;
}

function numberOf(value) {
  if (value === null || value === undefined || value === 'NaN') return null;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

export function cruxRequest({ origin, url, formFactor, history = false, weeks = 25 }) {
  if (!origin === !url) throw new Error('Pass exactly one of --origin or --url');
  const body = { metrics: Object.keys(CRUX_METRICS) };
  if (origin) body.origin = origin;
  else body.url = url;
  if (formFactor && formFactor !== 'all') {
    const value = FORM_FACTORS[String(formFactor).toLowerCase()];
    if (!value) throw new Error(`Unknown --form-factor "${formFactor}" (phone, desktop, tablet or all)`);
    body.formFactor = value;
  }
  if (history) body.collectionPeriodCount = Math.min(40, Math.max(1, Number(weeks) || 25));
  return { endpoint: `${CRUX_ENDPOINT}:${history ? 'queryHistoryRecord' : 'queryRecord'}`, body };
}

/** The current 28-day record: per metric, p75 with its rating and the good / needs improvement / poor shares. */
export function parseCruxRecord(json) {
  const record = json.record || {};
  const metrics = {};
  for (const [key, name] of Object.entries(CRUX_METRICS)) {
    const metric = record.metrics && record.metrics[key];
    if (!metric) continue;
    const p75 = numberOf(metric.percentiles && metric.percentiles.p75);
    const densities = (metric.histogram || []).map((bin) => numberOf(bin.density) ?? 0);
    metrics[name] = { p75, rating: rating(name, p75), good: densities[0] ?? null, needsImprovement: densities[1] ?? null, poor: densities[2] ?? null };
  }
  return {
    key: record.key || {},
    period: record.collectionPeriod ? { first: dateOf(record.collectionPeriod.firstDate), last: dateOf(record.collectionPeriod.lastDate) } : null,
    normalizedUrl: json.urlNormalizationDetails ? json.urlNormalizationDetails.normalizedUrl : null,
    metrics,
  };
}

/** Week-by-week p75s. Each period is a 28-day window; consecutive ones overlap by three weeks. */
export function parseCruxHistory(json) {
  const record = json.record || {};
  const periods = (record.collectionPeriods || []).map((period) => ({ first: dateOf(period.firstDate), last: dateOf(period.lastDate) }));
  const series = {};
  for (const [key, name] of Object.entries(CRUX_METRICS)) {
    const metric = record.metrics && record.metrics[key];
    if (!metric || !metric.percentilesTimeseries) continue;
    const p75s = (metric.percentilesTimeseries.p75s || []).map(numberOf);
    const good = metric.histogramTimeseries && metric.histogramTimeseries[0] ? metric.histogramTimeseries[0].densities.map(numberOf) : [];
    series[name] = periods.map((period, i) => ({ ...period, p75: p75s[i] ?? null, good: good[i] ?? null }));
  }
  return { key: record.key || {}, periods, series };
}

const DAY = 24 * 3600 * 1000;

/**
 * Splits CrUX history around a deploy date: the last window that ended before the deploy, and the
 * first window that started on or after it (the earliest one made only of post-deploy visits).
 */
export function aroundDeploy(history, deployDate) {
  const deploy = Date.parse(`${deployDate}T00:00:00Z`);
  if (Number.isNaN(deploy)) throw new Error(`--deploy must be a date like 2026-10-04 (got "${deployDate}")`);
  const out = {};
  for (const [name, points] of Object.entries(history.series)) {
    const valid = points.filter((point) => point.p75 !== null);
    const before = valid.filter((point) => Date.parse(`${point.last}T00:00:00Z`) < deploy).pop() || null;
    const after = valid.find((point) => Date.parse(`${point.first}T00:00:00Z`) >= deploy) || null;
    out[name] = {
      before,
      after,
      change: before && after ? round(after.p75 - before.p75, name === 'CLS' ? 3 : 0) : null,
      ratingBefore: before ? rating(name, before.p75) : null,
      ratingAfter: after ? rating(name, after.p75) : null,
    };
  }
  // A window covers 28 days ending on a Saturday, so the first clean one ends 27 days after the
  // deploy at the earliest, then on the next Saturday; CrUX publishes it the following Monday.
  const firstEnd = new Date(deploy + 27 * DAY);
  while (firstEnd.getUTCDay() !== 6) firstEnd.setTime(firstEnd.getTime() + DAY);
  const published = new Date(firstEnd.getTime() + 2 * DAY);
  return { deploy: deployDate, metrics: out, firstCleanWindowEnds: firstEnd.toISOString().slice(0, 10), expectedBy: published.toISOString().slice(0, 10) };
}

export async function queryCrux({ origin, url, formFactor, history, weeks, key }) {
  if (!key) throw new Error('No CrUX API key. Create one in Google Cloud (Chrome UX Report API) and export it, e.g. CRUX_API_KEY=...');
  const { endpoint, body } = cruxRequest({ origin, url, formFactor, history, weeks });
  const response = await fetch(`${endpoint}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (json.error && json.error.message) || `HTTP ${response.status}`;
    if (response.status === 404) throw new Error(`CrUX has no data for ${origin || url}${body.formFactor ? ` (${body.formFactor})` : ''}: ${message}. It covers public pages with enough Chrome traffic; try the origin instead of a URL, or another form factor.`);
    throw new Error(`CrUX API: ${message}`);
  }
  return history ? parseCruxHistory(json) : parseCruxRecord(json);
}

function value(name, number) {
  if (number === null || number === undefined) return '—';
  return name === 'CLS' ? String(round(number, 2)) : `${Math.round(number)} ms`;
}

function share(number) {
  return number === null || number === undefined ? '—' : `${Math.round(number * 100)}%`;
}

export function formatCrux(result, { history = false, deploy } = {}) {
  const lines = [];
  const what = result.key.origin || result.key.url || '';
  lines.push(`Chrome UX Report for ${what}${result.key.formFactor ? ` (${result.key.formFactor.toLowerCase()})` : ' (all devices)'}`);
  if (!history) {
    if (result.period) lines.push(`28 days: ${result.period.first} to ${result.period.last}`);
    const rows = [['metric', 'p75', 'rating', 'good', 'needs improvement', 'poor']];
    for (const [name, metric] of Object.entries(result.metrics)) rows.push([name, value(name, metric.p75), ratingLabel(metric.rating), share(metric.good), share(metric.needsImprovement), share(metric.poor)]);
    lines.push(table(rows, { indent: '  ' }));
    return lines.join('\n');
  }
  const names = Object.keys(result.series);
  const rows = [['28 days ending', ...names.map((name) => `${name} p75`)]];
  result.periods.forEach((period, i) => rows.push([period.last, ...names.map((name) => value(name, result.series[name][i].p75))]));
  lines.push(table(rows, { indent: '  ' }));
  if (deploy) {
    const split = aroundDeploy(result, deploy);
    lines.push('', `Around the deploy on ${deploy}:`);
    for (const [name, item] of Object.entries(split.metrics)) {
      if (!item.before) lines.push(`  ${name}: no window ending before the deploy`);
      else if (!item.after) lines.push(`  ${name}: ${value(name, item.before.p75)} before (window ending ${item.before.last}); no window made only of post-deploy visits yet`);
      else lines.push(`  ${name}: ${value(name, item.before.p75)} → ${value(name, item.after.p75)} (${ratingLabel(item.ratingBefore)} → ${ratingLabel(item.ratingAfter)}), windows ending ${item.before.last} and ${item.after.last}`);
    }
    if (Object.values(split.metrics).some((item) => !item.after)) lines.push(`  The first window with only post-deploy visits ends ${split.firstCleanWindowEnds}; expect it around ${split.expectedBy}.`);
    lines.push('  CrUX is a 28-day rolling window across all your Chrome users, so other changes in that time count too.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Your own real-user data

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((cells) => Object.fromEntries(header.map((name, i) => [name.trim(), cells[i]])));
}

/** Records from JSON lines (each line a record or an array of records), a JSON array, or CSV with a header row. */
export function parseRecords(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  let records = null;
  if (trimmed.startsWith('[')) {
    try {
      records = JSON.parse(trimmed).flat();
    } catch {
      records = null; // several lines of arrays: JSON lines
    }
  }
  if (!records && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    records = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed)) records.push(...parsed);
      else records.push(parsed);
    }
  }
  if (!records) records = parseCsv(trimmed);
  return records
    .map((record) => ({ ...record, value: Number(record.value), time: record.time !== undefined && record.time !== '' ? Number(record.time) || Date.parse(record.time) : null }))
    .filter((record) => record.name && Number.isFinite(record.value));
}

export function readRecords(file) {
  if (!existsSync(file)) throw new Error(`Not found: ${file}`);
  return parseRecords(readFileSync(file, 'utf8'));
}

/**
 * Compares the p75 of `metric` before and after, overall and per value of `by` (page, target,
 * deviceType, ...). Groups with fewer than `minSamples` on either side are reported but not judged.
 */
export function compareRecords(before, after, { metric = 'INP', by = null, minSamples = 50, top = 10 } = {}) {
  const name = metric.toUpperCase();
  const pick = (records) => records.filter((record) => String(record.name).toUpperCase() === name);
  const b = pick(before);
  const a = pick(after);
  const judge = (left, right) => {
    const diff = quantileDiff(left.map((record) => record.value), right.map((record) => record.value), 0.75);
    const enough = diff.n[0] >= minSamples && diff.n[1] >= minSamples;
    return { ...diff, enough, verdict: enough ? verdict(diff) : 'too few samples', ratingBefore: rating(name, diff.a), ratingAfter: rating(name, diff.b) };
  };
  const overall = judge(b, a);
  const groups = [];
  if (by) {
    const keys = new Map();
    for (const record of [...b, ...a]) {
      const key = record[by] ?? '(none)';
      keys.set(key, (keys.get(key) || 0) + 1);
    }
    const ranked = [...keys.entries()].sort((x, y) => y[1] - x[1]).slice(0, top).map(([key]) => key);
    for (const key of ranked) {
      groups.push({ key, ...judge(b.filter((record) => (record[by] ?? '(none)') === key), a.filter((record) => (record[by] ?? '(none)') === key)) });
    }
  }
  return { metric: name, thresholds: THRESHOLDS[name] || null, by, overall, groups };
}

/** Splits records at a date (ISO) by their `time`, or by `release` ids. */
export function splitRecords(records, { at, beforeRelease, afterRelease }) {
  if (at) {
    const cut = Date.parse(at);
    if (Number.isNaN(cut)) throw new Error(`--split-at must be a date or time (got "${at}")`);
    const timed = records.filter((record) => Number.isFinite(record.time));
    return { before: timed.filter((record) => record.time < cut), after: timed.filter((record) => record.time >= cut) };
  }
  if (beforeRelease || afterRelease) {
    return {
      before: records.filter((record) => String(record.release) === String(beforeRelease)),
      after: records.filter((record) => String(record.release) === String(afterRelease)),
    };
  }
  throw new Error('Split the data with --split-at <date> or --before-release/--after-release, or pass --before and --after files');
}

export function formatFieldCompare(result) {
  const name = result.metric;
  const line = (label, item) => {
    const change = item.diff === null ? '—' : `${item.diff > 0 ? '+' : ''}${value(name, item.diff)} (${value(name, item.low)} to ${value(name, item.high)})`;
    return [label, `${item.n[0]} / ${item.n[1]}`, `${value(name, item.a)} → ${value(name, item.b)}`, change, `${ratingLabel(item.ratingBefore)} → ${ratingLabel(item.ratingAfter)}`, item.verdict === 'better' ? 'faster' : item.verdict === 'worse' ? 'SLOWER' : item.verdict === 'same' ? 'no measurable change' : item.verdict];
  };
  const rows = [[result.by || '', 'samples before / after', `${name} p75`, 'change (95% CI)', 'rating', 'verdict'], line('all', result.overall)];
  for (const group of result.groups) rows.push(line(String(group.key).slice(0, 60), group));
  return [`Real users: ${name} at the 75th percentile, before → after`, table(rows, { indent: '  ' })].join('\n');
}

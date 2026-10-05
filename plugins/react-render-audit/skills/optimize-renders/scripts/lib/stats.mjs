// Statistics for the timing benchmark and for field data: quantiles with distribution-free
// confidence intervals, paired before/after comparisons, verdicts, Core Web Vitals ratings and
// impact levels. Nothing here is random: the same numbers in always give the same intervals out,
// so anyone can recompute a report from its raw data.

/** Core Web Vitals thresholds (good up to the first value, poor above the second), plus TBT as Lighthouse scores it on mobile. */
export const THRESHOLDS = {
  INP: [200, 500],
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  TBT: [200, 600],
};
/** One frame at 60 Hz: a saving smaller than this is invisible to users. */
export const FRAME_MS = 1000 / 60;
/** The long-standing limit for a response to feel instant. */
export const INSTANT_MS = 100;

const RATING_ORDER = { good: 0, 'needs-improvement': 1, poor: 2 };

export function rating(metric, value) {
  const bounds = THRESHOLDS[metric];
  if (!bounds || typeof value !== 'number' || Number.isNaN(value)) return null;
  return value <= bounds[0] ? 'good' : value <= bounds[1] ? 'needs-improvement' : 'poor';
}

export function ratingLabel(value) {
  return value === 'needs-improvement' ? 'needs improvement' : value || '—';
}

/** Finite numbers only, sorted ascending. */
export function sortNumbers(values) {
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
}

/** The q-quantile of sorted values, interpolating between the closest ranks. */
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function median(values) {
  return quantile(sortNumbers(values), 0.5);
}

/** P(X <= k) for k = 0..n with X ~ Binomial(n, p), computed in log space so large n can't underflow. */
function binomialCdf(n, p) {
  const cdf = new Float64Array(n + 1);
  const logRatio = Math.log(p) - Math.log(1 - p);
  let logPmf = n * Math.log(1 - p);
  let total = 0;
  for (let k = 0; k <= n; k++) {
    total += Math.exp(logPmf);
    cdf[k] = Math.min(1, total);
    logPmf += Math.log((n - k) / (k + 1)) + logRatio;
  }
  return cdf;
}

/**
 * A distribution-free confidence interval for the q-quantile of a sample, from its order
 * statistics: the number of values below the true quantile is Binomial(n, q), so the interval
 * between the right two ranks covers it with at least the requested confidence. For q = 0.5 this
 * is the classic sign-test interval for a median. `exact` is false when the sample is too small
 * to reach the confidence (the interval is then the full range).
 */
export function quantileCI(values, q = 0.5, confidence = 0.95) {
  const sorted = sortNumbers(values);
  const n = sorted.length;
  if (!n) return { n: 0, estimate: null, low: null, high: null, exact: false };
  const tail = (1 - confidence) / 2;
  const cdf = binomialCdf(n, q);
  // lower rank l (1-based): the largest with P(X <= l - 1) <= tail
  let l = 0;
  while (l < n && cdf[l] <= tail) l++;
  // upper rank h (1-based): the smallest with P(X >= h) = 1 - P(X <= h - 1) <= tail
  let h = n + 1;
  for (let rank = 1; rank <= n; rank++) {
    if (1 - cdf[rank - 1] <= tail) {
      h = rank;
      break;
    }
  }
  const exact = l >= 1 && h <= n;
  return {
    n,
    estimate: quantile(sorted, q),
    low: sorted[Math.max(1, l) - 1],
    high: sorted[Math.min(n, h) - 1],
    exact,
  };
}

/**
 * Paired comparison of baseline runs `a` and candidate runs `b` (a[i] and b[i] ran back to
 * back): the median of the differences b - a with its sign-test confidence interval, and the same
 * relative to the baseline median. Pairs where either value is missing are skipped.
 */
export function pairedDiff(a, b, { confidence = 0.95 } = {}) {
  const diffs = [];
  const as = [];
  const bs = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (typeof a[i] !== 'number' || typeof b[i] !== 'number' || !Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    diffs.push(b[i] - a[i]);
    as.push(a[i]);
    bs.push(b[i]);
  }
  const ci = quantileCI(diffs, 0.5, confidence);
  const base = median(as);
  const relative = (value) => (base ? value / base : null);
  return {
    n: ci.n,
    a: base,
    b: median(bs),
    diff: ci.estimate,
    low: ci.low,
    high: ci.high,
    relative: ci.estimate === null ? null : relative(ci.estimate),
    relativeLow: ci.low === null ? null : relative(ci.low),
    relativeHigh: ci.high === null ? null : relative(ci.high),
    exact: ci.exact,
  };
}

/**
 * 'better', 'worse' or 'same' for a lower-is-better metric (pass lowerIsBetter: false for the
 * opposite): a difference counts only when the whole confidence interval is on one side of zero.
 */
export function verdict(ci, { lowerIsBetter = true } = {}) {
  // Too few samples for the requested confidence: nothing can be claimed either way.
  if (!ci || !ci.n || ci.low === null || ci.exact === false) return 'same';
  if (ci.high < 0) return lowerIsBetter ? 'better' : 'worse';
  if (ci.low > 0) return lowerIsBetter ? 'worse' : 'better';
  return 'same';
}

/** The change we're at least 95% sure of, in the verdict's direction (0 when there's none). */
export function cautious(ci) {
  if (!ci || ci.low === null) return 0;
  if (ci.high < 0) return -ci.high;
  if (ci.low > 0) return ci.low;
  return 0;
}

function sampleSd(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

/**
 * How many pairs it takes to detect a change of `minEffect` with 80% power at 95% confidence,
 * given the spread of differences seen in a same-vs-same (A/A) run. The usual normal-theory
 * formula, inflated by 1/0.637 because a sign test on medians needs more samples than a t test on
 * means.
 */
export function plannedPairs(aaDiffs, minEffect, { min = 8, max = 30 } = {}) {
  const sd = sampleSd(sortNumbers(aaDiffs));
  if (!sd || !minEffect) return min;
  const n = Math.ceil(((2.8 * sd) / minEffect) ** 2 / 0.637);
  return Math.min(max, Math.max(min, n));
}

/**
 * Confidence interval for the difference between the q-quantiles of two independent samples
 * (field data: before and after a deploy). Each sample gets a sqrt(confidence) interval and the
 * difference interval spans their extremes, so it covers the true difference with at least the
 * requested confidence. Conservative, deterministic and fast for any sample size.
 */
export function quantileDiff(before, after, q = 0.75, { confidence = 0.95 } = {}) {
  const each = Math.sqrt(confidence);
  const a = quantileCI(before, q, each);
  const b = quantileCI(after, q, each);
  if (!a.n || !b.n) return { n: [a.n, b.n], a: a.estimate, b: b.estimate, diff: null, low: null, high: null, exact: false };
  const diff = b.estimate - a.estimate;
  return {
    n: [a.n, b.n],
    a: a.estimate,
    b: b.estimate,
    aRange: [a.low, a.high],
    bRange: [b.low, b.high],
    diff,
    low: b.low - a.high,
    high: b.high - a.low,
    relative: a.estimate ? diff / a.estimate : null,
    exact: a.exact && b.exact,
  };
}

/**
 * Impact level of a step's change, judged on the cautious end of each confidence interval:
 *
 *   high    moves an interaction into a better (or worse) Core Web Vitals band, or changes its
 *           response time or the step's blocking time by at least 100 ms
 *   medium  at least one frame (16.7 ms) of response or main-thread time, 20% of main-thread
 *           time, all long frames removed (or new ones), or two dropped frames
 *   low     a real change smaller than that: users won't notice it
 *   none    within the noise
 *
 * `step` holds pairedDiff results: inp (interaction steps only), mainThread, tbt, longFrames,
 * dropped.
 */
export function impactOf(step) {
  const { inp, mainThread, tbt, longFrames, dropped } = step;
  const all = [inp, mainThread, tbt, longFrames, dropped].filter(Boolean);
  if (all.some((ci) => ci.exact === false)) return { level: 'none', direction: 'same', reasons: [], judged: false };
  const verdicts = all.map((ci) => verdict(ci));
  const direction = (inp && verdict(inp) !== 'same' && verdict(inp)) || verdicts.find((value) => value !== 'same') || 'same';
  if (direction === 'same') return { level: 'none', direction, reasons: [] };
  const agrees = (ci) => ci && verdict(ci) === direction;
  const reasons = [];
  let level = 'low';
  const raise = (to, reason) => {
    const order = { low: 0, medium: 1, high: 2 };
    if (order[to] > order[level]) level = to;
    reasons.push(reason);
  };
  const faster = direction === 'better';

  if (agrees(inp)) {
    const before = rating('INP', inp.a);
    const after = rating('INP', inp.b);
    if (before && after && before !== after && (RATING_ORDER[after] < RATING_ORDER[before]) === faster) {
      raise('high', `${faster ? 'moved' : 'fell'} from ${ratingLabel(before)} to ${ratingLabel(after)}`);
    }
    const change = cautious(inp);
    if (change >= INSTANT_MS) raise('high', `responds at least ${Math.round(change)} ms ${faster ? 'faster' : 'slower'}`);
    else if (change >= FRAME_MS) raise('medium', `responds at least ${Math.round(change)} ms ${faster ? 'faster' : 'slower'}`);
  }
  if (agrees(tbt) && cautious(tbt) >= INSTANT_MS) raise('high', `blocking time ${faster ? 'down' : 'up'} by at least ${Math.round(cautious(tbt))} ms`);
  if (agrees(mainThread)) {
    const change = cautious(mainThread);
    const relative = mainThread.a ? change / mainThread.a : 0;
    if (change >= FRAME_MS) raise('medium', `at least ${Math.round(change)} ms ${faster ? 'less' : 'more'} main-thread work`);
    else if (relative >= 0.2) raise('medium', `at least ${Math.round(relative * 100)}% ${faster ? 'less' : 'more'} main-thread work`);
  }
  if (agrees(longFrames)) {
    const gone = faster ? longFrames.a >= 1 && longFrames.b === 0 : longFrames.a === 0 && longFrames.b >= 1;
    if (gone) raise('medium', faster ? 'no long frames left' : 'long frames appeared');
  }
  if (agrees(dropped) && cautious(dropped) >= 2) raise('medium', `at least ${Math.round(cautious(dropped))} ${faster ? 'fewer' : 'more'} dropped frames`);
  if (!reasons.length) reasons.push(faster ? 'measurably faster, by less than a frame' : 'measurably slower, by less than a frame');
  return { level, direction, reasons };
}

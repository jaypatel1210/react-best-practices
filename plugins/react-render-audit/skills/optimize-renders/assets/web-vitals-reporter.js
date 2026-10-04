// Real-user Core Web Vitals for react-render-audit's `field compare`.
//
// Copy this file into the app, add the web-vitals package (npm install web-vitals), and call
// reportWebVitals() once on the client, as early as possible: in Next.js, from a client component
// in the root layout or from pages/_app; elsewhere, next to createRoot. It sends INP, LCP and CLS
// with their attribution to `endpoint` as a JSON array when the page is hidden or unloaded, the
// moments browsers still deliver a beacon.
//
// Each record: { name, value, rating, id, page, deviceType, release, time, navigationType,
// target, interactionType, inputDelay, processing, presentation, loadState }.
// Store them as JSON lines (or anything you can export to JSON or CSV) and compare two periods:
//   render-audit field compare --data vitals.jsonl --split-at 2026-10-04 --metric INP --by page
import { onCLS, onINP, onLCP } from 'web-vitals/attribution';

const round = (value) => (typeof value === 'number' ? Math.round(value * 10) / 10 : undefined);

// The route, not the URL, so /product/1 and /product/2 group together. Next.js pages router
// exposes it; otherwise numeric and id-like path segments are replaced.
function defaultPage() {
  const nextPage = typeof window !== 'undefined' && window.__NEXT_DATA__ && window.__NEXT_DATA__.page;
  if (nextPage) return nextPage;
  return location.pathname
    .split('/')
    .map((part) => (/^\d+$/.test(part) || /^[0-9a-f-]{16,}$/i.test(part) ? ':id' : part))
    .join('/');
}

function defaultDeviceType() {
  const hints = navigator.userAgentData;
  if (hints && typeof hints.mobile === 'boolean') return hints.mobile ? 'mobile' : 'desktop';
  return matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
}

/**
 * options:
 *   endpoint     where to POST the records (default '/api/vitals'); it receives a JSON array
 *   release      the deployed version (a commit SHA or build id), to compare releases
 *   sampleRate   share of page views to report, 0..1 (default 1)
 *   page         () => string, the route to group by (default: see defaultPage)
 *   extra        (metric) => object, more fields to send with each record
 */
export function reportWebVitals({ endpoint = '/api/vitals', release, sampleRate = 1, page = defaultPage, extra } = {}) {
  if (typeof window === 'undefined' || Math.random() >= sampleRate) return;
  const queue = [];
  const deviceType = defaultDeviceType();

  function add(metric) {
    const attribution = metric.attribution || {};
    const record = {
      name: metric.name,
      value: metric.name === 'CLS' ? Math.round(metric.value * 1000) / 1000 : Math.round(metric.value),
      rating: metric.rating,
      id: metric.id,
      page: page(),
      deviceType,
      release,
      time: Date.now(),
      navigationType: metric.navigationType,
    };
    if (metric.name === 'INP') {
      Object.assign(record, {
        target: attribution.interactionTarget,
        interactionType: attribution.interactionType,
        inputDelay: round(attribution.inputDelay),
        processing: round(attribution.processingDuration),
        presentation: round(attribution.presentationDelay),
        loadState: attribution.loadState,
      });
    } else if (metric.name === 'LCP') {
      record.target = attribution.target;
    } else if (metric.name === 'CLS') {
      record.target = attribution.largestShiftTarget;
      record.loadState = attribution.loadState;
    }
    if (extra) Object.assign(record, extra(metric));
    queue.push(record);
  }

  function flush() {
    if (!queue.length) return;
    const body = JSON.stringify(queue.splice(0));
    const sent = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(endpoint, body);
    if (!sent) {
      fetch(endpoint, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
    }
  }

  onINP(add);
  onLCP(add);
  onCLS(add);
  // Registered after web-vitals' own listeners, which report the final values when the page is
  // hidden, so this sends them in the same beacon.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  addEventListener('pagehide', flush);
}

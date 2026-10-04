// Frozen network for the timing benchmark. The first run records the responses of the app's
// cross-origin data requests (fetch and XHR to its APIs); every later run, of either build, is
// served those responses instantly. Backend latency and changing data stop adding noise, and both
// builds render the same data. Requests to the app's own dev server always go through, because
// they are part of the code being compared. Nothing recorded is written to disk.

const RESOURCE_TYPES = ['XHR', 'Fetch'];
const VOLATILE_PARAMS = new Set(['_', 't', 'ts', 'timestamp', 'cb', 'cachebust', 'cacheBust', 'nocache']);
const DROP_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The identity of a request: method, URL without cache-busting parameters, and its body. */
export function requestKey(request) {
  let url = request.url;
  try {
    const parsed = new URL(request.url);
    const params = [...parsed.searchParams.entries()].filter(([key]) => !VOLATILE_PARAMS.has(key)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    url = `${parsed.origin}${parsed.pathname}${params.length ? `?${params.map(([key, value]) => `${key}=${value}`).join('&')}` : ''}`;
  } catch {
    // keep the raw URL
  }
  let body = '';
  if (request.postData) {
    try {
      body = ` #${hash(stable(JSON.parse(request.postData)))}`;
    } catch {
      body = ` #${hash(request.postData)}`;
    }
  }
  return `${request.method || 'GET'} ${url}${body}`;
}

/**
 * Headers for a replayed response: the body is served decoded, so encoding and length headers
 * go, and a CORS allow-origin that named the recording run's origin now names this page's.
 */
export function replayHeaders(headers, { recordedOrigin, pageOrigin }) {
  const out = [];
  for (const header of headers || []) {
    const name = header.name.toLowerCase();
    if (DROP_HEADERS.has(name)) continue;
    if (name === 'access-control-allow-origin' && header.value !== '*' && pageOrigin && (!recordedOrigin || header.value === recordedOrigin)) {
      out.push({ name: header.name, value: pageOrigin });
      continue;
    }
    out.push({ name: header.name, value: header.value });
  }
  return out;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise.finally(() => clearTimeout(timer)), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), ms)))]);
}

export class NetworkReplay {
  constructor() {
    this.recordings = new Map(); // key -> [{ status, headers, body (base64) }]
    this.recordedOrigin = null;
    this.recorded = 0;
    this.frozen = false;
  }

  get size() {
    return this.recordings.size;
  }

  /** Ends recording: every later run replays (an empty recording intercepts nothing). */
  freeze() {
    this.frozen = true;
  }

  /** Recorded requests by origin, without bodies (for the report). */
  summary() {
    const byOrigin = {};
    for (const [key, list] of this.recordings) {
      const origin = originOf(key.split(' ')[1]) || '?';
      byOrigin[origin] = (byOrigin[origin] || 0) + list.length;
    }
    return { requests: this.recorded, distinct: this.recordings.size, byOrigin };
  }

  /**
   * Records (until freeze()) or replays in `page`, a page whose app is served from `appOrigin`.
   * Call before navigating. Returns live counters for the run.
   */
  async attach(page, { appOrigin }) {
    const mode = this.frozen ? 'replay' : 'record';
    const counters = { mode, recorded: 0, served: 0, passed: 0, misses: [] };
    const cursors = new Map();
    if (mode === 'record') this.recordedOrigin = appOrigin;
    page.on('Fetch.requestPaused', (event) => {
      this.#handle(page, event, { mode, appOrigin, counters, cursors }).catch(() => {
        page.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {});
      });
    });
    // Recording looks at every data request; replaying intercepts only the recorded API origins,
    // so requests to the app's own server never wait on interception.
    const urlPatterns = mode === 'record' ? ['*'] : [...new Set([...this.recordings.keys()].map((key) => originOf(key.split(' ')[1])).filter(Boolean))].map((origin) => `${origin}/*`);
    const patterns = [];
    for (const urlPattern of urlPatterns) {
      for (const resourceType of RESOURCE_TYPES) patterns.push({ urlPattern, resourceType, requestStage: mode === 'record' ? 'Response' : 'Request' });
    }
    if (patterns.length) await page.send('Fetch.enable', { patterns });
    return counters;
  }

  async #handle(page, event, { mode, appOrigin, counters, cursors }) {
    const { requestId, request } = event;
    const origin = originOf(request.url);
    const passThrough = !origin || origin === appOrigin || !/^https?:/.test(request.url);
    if (passThrough) {
      await page.send('Fetch.continueRequest', { requestId });
      return;
    }
    const key = requestKey(request);
    if (mode === 'record') {
      const status = event.responseStatusCode;
      const headers = event.responseHeaders || [];
      const type = (headers.find((header) => header.name.toLowerCase() === 'content-type') || {}).value || '';
      // Redirects, failures and streams aren't recorded; they keep going to the network.
      if (!status || (status >= 300 && status < 400) || event.responseErrorReason || /event-stream|ndjson/i.test(type)) {
        await page.send('Fetch.continueRequest', { requestId });
        return;
      }
      let body = null;
      try {
        const response = await withTimeout(page.send('Fetch.getResponseBody', { requestId }), 10000);
        body = response.base64Encoded ? response.body : Buffer.from(response.body || '', 'utf8').toString('base64');
      } catch {
        body = null;
      }
      if (body !== null) {
        const list = this.recordings.get(key) || [];
        list.push({ status, headers, body });
        this.recordings.set(key, list);
        this.recorded++;
        counters.recorded++;
      }
      await page.send('Fetch.continueRequest', { requestId });
      return;
    }
    const list = this.recordings.get(key);
    if (!list) {
      counters.passed++;
      if (counters.misses.length < 20) counters.misses.push(key);
      await page.send('Fetch.continueRequest', { requestId });
      return;
    }
    // The same request made several times gets the recorded responses in order; the last repeats.
    const index = cursors.get(key) || 0;
    cursors.set(key, index + 1);
    const recorded = list[Math.min(index, list.length - 1)];
    const pageOrigin = originOf(request.headers && (request.headers.Origin || request.headers.origin)) || appOrigin;
    await page.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: recorded.status,
      responseHeaders: replayHeaders(recorded.headers, { recordedOrigin: this.recordedOrigin, pageOrigin }),
      body: recorded.body,
    });
    counters.served++;
  }
}

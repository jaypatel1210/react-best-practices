// Page-level helpers shared by `measure` and `inspect`: opening an isolated tab with the tracker,
// waiting for the page to settle, driving input through CDP, capturing network, console and
// accessibility state, and resolving component source locations.
import { loadSourceMap, originalPosition, toFilePath } from './sourcemap.mjs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Dev-server plumbing and telemetry: never part of the app's behavior.
export const DEFAULT_IGNORED_REQUESTS = [
  '/_next/webpack-hmr',
  '/_next/static/webpack/',
  '.hot-update.',
  '/__nextjs',
  '/_next/static/development/',
  '/__turbopack',
  'on-demand-entries',
  '/@vite/',
  '/@react-refresh',
  '/__vite_ping',
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'sentry.io',
  'ingest.sentry',
  'grafana.net',
  'faro',
  'segment.io',
  'segment.com',
  'hotjar',
  'clarity.ms',
  'facebook.com/tr',
  'mixpanel',
  'amplitude.com',
  'datadoghq',
  'newrelic',
  'nr-data.net',
  'fullstory',
  'logrocket',
  'intercom',
  'growthbook',
];
const DATA_TYPES = new Set(['Fetch', 'XHR', 'Document', 'EventSource', 'WebSocket']);
const VOLATILE_PARAMS = new Set(['_rsc', '_', 't', 'ts', 'timestamp', 'cb', 'cachebust', 'cacheBust', 'nocache']);
// A request still open after this long is a stream or long poll; it must not block settling.
const LONG_LIVED_MS = 5000;

function matcher(patterns) {
  const compiled = patterns.map((pattern) => {
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0 && pattern.length > 2 && /\/[a-z]*$/.test(pattern)) {
      const last = pattern.lastIndexOf('/');
      try {
        const re = new RegExp(pattern.slice(1, last), pattern.slice(last + 1));
        return (url) => re.test(url);
      } catch {
        // not a regex after all; fall through to substring
      }
    }
    return (url) => url.includes(pattern);
  });
  return (url) => compiled.some((test) => test(url));
}

export async function evaluate(page, expression, { awaitPromise = false } = {}) {
  const response = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (response.exceptionDetails) {
    const details = response.exceptionDetails;
    throw new Error((details.exception && details.exception.description) || details.text || 'evaluation failed');
  }
  return response.result ? response.result.value : undefined;
}

// ---------------------------------------------------------------------------------------------
// Network and console

function normalizeUrl(raw, origin) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const params = [...url.searchParams.entries()].filter(([key]) => !VOLATILE_PARAMS.has(key)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length ? `?${params.map(([key, value]) => `${key}=${value}`).join('&')}` : '';
  const prefix = url.origin === origin ? '' : url.origin;
  return `${prefix}${url.pathname}${query}`;
}

function describeBody(postData) {
  if (!postData) return '';
  try {
    const body = JSON.parse(postData);
    const operations = (Array.isArray(body) ? body : [body]).map((item) => item && item.operationName).filter(Boolean);
    if (operations.length) return ` {${operations.join(',')}}`;
  } catch {
    // not JSON
  }
  let h = 0;
  for (let i = 0; i < postData.length; i++) h = (Math.imul(h, 31) + postData.charCodeAt(i)) | 0;
  return ` body#${(h >>> 0).toString(36)}`;
}

export class NetworkLog {
  constructor(page, ignorePatterns = []) {
    this.step = 0;
    this.byStep = new Map();
    this.open = new Map();
    this.lastActivity = Date.now();
    this.origin = null;
    this.skipDocument = false;
    const ignored = matcher([...DEFAULT_IGNORED_REQUESTS, ...ignorePatterns]);
    page.on('Network.requestWillBeSent', (event) => {
      const url = event.request.url;
      if (url.startsWith('data:') || url.startsWith('blob:') || ignored(url)) return;
      if (event.type === 'Document' && !this.origin) {
        try {
          this.origin = new URL(url).origin;
        } catch {
          // ignore
        }
      }
      const longLived = event.type === 'WebSocket' || event.type === 'EventSource';
      if (!longLived) this.open.set(event.requestId, Date.now());
      this.lastActivity = Date.now();
      // The URL a navigation step opens comes from the scenario, not from the app; redirects
      // after it (same request id, later events) are still recorded.
      if (event.type === 'Document' && this.skipDocument && !event.redirectResponse) {
        this.skipDocument = false;
        return;
      }
      if (DATA_TYPES.has(event.type)) {
        const list = this.byStep.get(this.step) || [];
        list.push(`${event.request.method} ${normalizeUrl(url, this.origin)}${describeBody(event.request.postData)}`);
        this.byStep.set(this.step, list);
      }
    });
    const done = (event) => {
      if (this.open.delete(event.requestId)) this.lastActivity = Date.now();
    };
    page.on('Network.loadingFinished', done);
    page.on('Network.loadingFailed', done);
  }

  begin(step) {
    this.step = step;
  }

  skipNextDocument() {
    this.skipDocument = true;
  }

  inflight() {
    const now = Date.now();
    let count = 0;
    for (const started of this.open.values()) if (now - started < LONG_LIVED_MS) count++;
    return count;
  }

  quietFor() {
    return this.inflight() ? 0 : Date.now() - this.lastActivity;
  }

  list(step) {
    return (this.byStep.get(step) || []).slice().sort();
  }
}

function formatConsole(args) {
  const values = args.map((arg) => {
    if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
    return arg.unserializableValue || arg.description || arg.type;
  });
  if (!values.length) return '';
  let first = String(values[0]);
  let index = 1;
  first = first.replace(/%[sdifoOc]/g, (token) => (token === '%c' ? (index++, '') : index < values.length ? String(values[index++]) : token));
  return [first, ...values.slice(index)].join(' ');
}

export function normalizeMessage(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g, '')
    .replace(/\d{4,}/g, '#')
    .slice(0, 300)
    .trim();
}

export class ConsoleLog {
  constructor(page) {
    this.step = 0;
    this.byStep = new Map();
    const add = (type, text) => {
      const list = this.byStep.get(this.step) || [];
      list.push(`${type}: ${normalizeMessage(text)}`);
      this.byStep.set(this.step, list);
    };
    page.on('Runtime.consoleAPICalled', (event) => {
      if (event.type === 'error' || event.type === 'warning' || event.type === 'assert') add(event.type, formatConsole(event.args || []));
    });
    page.on('Runtime.exceptionThrown', (event) => {
      const details = event.exceptionDetails || {};
      add('exception', (details.exception && details.exception.description ? details.exception.description.split('\n')[0] : details.text) || 'exception');
    });
    page.on('Log.entryAdded', (event) => {
      const entry = event.entry || {};
      if (entry.level === 'error' || entry.level === 'warning') add(`log-${entry.level}`, entry.text || '');
    });
  }

  begin(step) {
    this.step = step;
  }

  list(step) {
    return (this.byStep.get(step) || []).slice();
  }
}

// ---------------------------------------------------------------------------------------------
// Opening a page

/** Opens a tab in a fresh browser context (own cookies, storage and cache) with the tracker. */
export async function openPage(browser, { tracker, width = 1280, height = 800, cookies, headers } = {}) {
  const { conn } = browser;
  const { browserContextId } = await conn.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  const page = conn.session(sessionId);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Log.enable');
  await page.send('DOM.enable');
  await page.send('Accessibility.enable');
  if (tracker) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: tracker });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (cookies && cookies.length) await page.send('Network.setCookies', { cookies });
  if (headers && Object.keys(headers).length) await page.send('Network.setExtraHTTPHeaders', { headers });
  const close = async () => {
    await conn.send('Target.closeTarget', { targetId }).catch(() => {});
    await conn.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  };
  return { page, close };
}

export async function navigate(page, url, timeoutMs = 90000) {
  let resolveLoad;
  const loaded = new Promise((resolve) => {
    resolveLoad = resolve;
  });
  const off = page.on('Page.loadEventFired', () => resolveLoad('loaded'));
  let timer;
  try {
    const result = await page.send('Page.navigate', { url });
    if (result.errorText) {
      throw new Error(`Could not open ${url} (${result.errorText}). Is the dev server running and the URL right?`);
    }
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const outcome = await Promise.race([loaded, timeout]);
    if (outcome === 'timeout') throw new Error(`${url} did not finish loading within ${Math.round(timeoutMs / 1000)} s`);
  } finally {
    clearTimeout(timer);
    off();
  }
}

/**
 * Waits until React has been idle (no commit) and the network quiet for `quietMs`, or `maxMs`
 * passes. Returns { settled, ms }.
 */
export async function settle(page, network, { quietMs = 500, maxMs = 10000 } = {}) {
  const started = Date.now();
  for (;;) {
    let idle;
    try {
      idle = await evaluate(page, 'typeof __RENDER_AUDIT__ === "object" ? __RENDER_AUDIT__.idleMs() : Infinity');
    } catch {
      idle = 0; // the page is between documents
    }
    if (idle === null || idle === undefined) idle = Infinity;
    const networkQuiet = network ? network.quietFor() : Infinity;
    const elapsed = Date.now() - started;
    if (idle >= quietMs && networkQuiet >= quietMs) return { settled: true, ms: elapsed };
    if (elapsed >= maxMs) return { settled: false, ms: elapsed, inflight: network ? network.inflight() : 0 };
    await sleep(100);
  }
}

// ---------------------------------------------------------------------------------------------
// Finding elements

export function describeTarget(target) {
  if (!target) return 'nothing';
  if (target.role) return `${target.role}${target.name ? ` "${target.name}"` : ''}`;
  for (const key of ['selector', 'testId', 'label', 'placeholder', 'text']) {
    if (target[key]) return `${key} "${target[key]}"`;
  }
  return JSON.stringify(target);
}

async function findByRole(page, target) {
  const doc = await page.send('Runtime.evaluate', { expression: 'document', objectGroup: 'ra-find' });
  const objectId = doc.result.objectId;
  const query = { objectId, role: target.role };
  if (target.name) query.accessibleName = target.name;
  let { nodes } = await page.send('Accessibility.queryAXTree', query);
  nodes = nodes.filter((node) => !node.ignored && node.backendDOMNodeId);
  if (!nodes.length && target.name && !target.exact) {
    const all = await page.send('Accessibility.queryAXTree', { objectId, role: target.role });
    const wanted = target.name.toLowerCase();
    nodes = all.nodes.filter(
      (node) => !node.ignored && node.backendDOMNodeId && node.name && String(node.name.value).toLowerCase().includes(wanted),
    );
  }
  const node = nodes[target.nth || 0];
  if (!node) return null;
  const { object } = await page.send('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId, objectGroup: 'ra-find' });
  return object ? object.objectId : null;
}

async function findInPage(page, target) {
  const response = await page.send('Runtime.evaluate', {
    expression: `__RENDER_AUDIT__.find(${JSON.stringify(target)})`,
    objectGroup: 'ra-find',
  });
  const result = response.result;
  return result && result.subtype === 'node' ? result.objectId : null;
}

async function centerOf(page, objectId) {
  await page.send('DOM.scrollIntoViewIfNeeded', { objectId }).catch(() => {});
  let quads = [];
  try {
    ({ quads } = await page.send('DOM.getContentQuads', { objectId }));
  } catch {
    return null;
  }
  for (const quad of quads) {
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    if (width >= 1 && height >= 1) return { x: xs.reduce((a, b) => a + b) / 4, y: ys.reduce((a, b) => a + b) / 4 };
  }
  return null;
}

/** Polls until the target exists and is visible. Returns { objectId, point }. */
export async function resolveTarget(page, target, timeoutMs = 10000) {
  if (!target || typeof target !== 'object') throw new Error('This step needs a "target"');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let objectId = null;
    try {
      objectId = target.role ? await findByRole(page, target) : await findInPage(page, target);
    } catch {
      objectId = null;
    }
    if (objectId) {
      const point = await centerOf(page, objectId);
      if (point) return { objectId, point };
    }
    if (Date.now() > deadline) throw new Error(`Couldn't find a visible ${describeTarget(target)} within ${Math.round(timeoutMs / 1000)} s`);
    await sleep(150);
  }
}

// ---------------------------------------------------------------------------------------------
// Input through CDP: real, trusted events, the same path a user's input takes.

const SPECIAL_KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
};
const MODIFIERS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Command: 4, Shift: 8 };

function charKey(char) {
  if (char === ' ') return SPECIAL_KEYS.Space;
  if (char === '\n') return SPECIAL_KEYS.Enter;
  const upper = char.toUpperCase();
  if (/[a-z]/i.test(char)) return { key: char, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: char };
  if (/[0-9]/.test(char)) return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0), text: char };
  return { key: char, code: '', keyCode: 0, text: char };
}

async function dispatchKey(page, def, modifiers = 0) {
  const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode, modifiers };
  if (def.text && !modifiers) await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: def.text, unmodifiedText: def.text });
  else await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

export async function pressKey(page, combo) {
  const parts = String(combo).split('+');
  const name = parts.pop();
  const modifiers = parts.reduce((mask, part) => mask | (MODIFIERS[part] || 0), 0);
  const def = SPECIAL_KEYS[name] || charKey(name);
  await dispatchKey(page, def, modifiers);
}

export async function typeText(page, text, delayMs = 60) {
  for (const char of String(text)) {
    await dispatchKey(page, charKey(char));
    if (delayMs > 0) await sleep(delayMs);
  }
}

async function mouse(page, type, point, extra = {}) {
  await page.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, ...extra });
}

export async function click(page, point, { clickCount = 1 } = {}) {
  await mouse(page, 'mouseMoved', point);
  await mouse(page, 'mousePressed', point, { button: 'left', buttons: 1, clickCount });
  await mouse(page, 'mouseReleased', point, { button: 'left', buttons: 0, clickCount });
}

const SET_VALUE = `function (value) {
  const proto = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : this instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  this.focus();
  descriptor.set.call(this, value);
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
}`;

const SELECT_CONTENTS = `(() => {
  const el = document.activeElement;
  if (el && typeof el.select === 'function') el.select();
  else if (el && el.isContentEditable) document.execCommand('selectAll');
})()`;

// "${NAME}" in typed or filled text reads the environment variable NAME, so credentials never
// have to be written into a scenario file.
export function expandEnv(text) {
  return String(text ?? '').replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => {
    if (process.env[name] === undefined) throw new Error(`The scenario uses \${${name}} but the environment variable ${name} isn't set`);
    return process.env[name];
  });
}

/** Performs one scenario step. Navigation steps are handled by the runner. */
export async function performAction(page, step, { width = 1280, height = 800 } = {}) {
  const timeout = step.timeoutMs || 10000;
  switch (step.action) {
    case 'click': {
      const { point } = await resolveTarget(page, step.target, timeout);
      await click(page, point, { clickCount: step.clickCount || 1 });
      return;
    }
    case 'hover': {
      const { point } = await resolveTarget(page, step.target, timeout);
      await mouse(page, 'mouseMoved', point);
      return;
    }
    case 'type': {
      if (step.target) {
        const { point } = await resolveTarget(page, step.target, timeout);
        await click(page, point);
      }
      if (step.clear) {
        await evaluate(page, SELECT_CONTENTS);
        await pressKey(page, 'Backspace');
      }
      await typeText(page, expandEnv(step.text), step.delayMs ?? 60);
      if (step.submit) await pressKey(page, step.submit === true ? 'Enter' : step.submit);
      return;
    }
    case 'press':
      await pressKey(page, step.key);
      return;
    case 'fill':
    case 'select': {
      const { objectId } = await resolveTarget(page, step.target, timeout);
      await page.send('Runtime.callFunctionOn', { objectId, functionDeclaration: SET_VALUE, arguments: [{ value: expandEnv(step.value ?? step.text) }] });
      return;
    }
    case 'scroll': {
      let point = { x: Math.round(width / 2), y: Math.round(height / 2) };
      if (step.target) point = (await resolveTarget(page, step.target, timeout)).point;
      const times = step.times || 1;
      for (let i = 0; i < times; i++) {
        await mouse(page, 'mouseWheel', point, { deltaX: step.deltaX || 0, deltaY: step.deltaY ?? 600 });
        await sleep(step.delayMs ?? 100);
      }
      return;
    }
    case 'resize':
      await page.send('Emulation.setDeviceMetricsOverride', { width: step.width || width, height: step.height || height, deviceScaleFactor: 1, mobile: false });
      return;
    case 'wait':
      await sleep(step.ms ?? 500);
      return;
    case 'waitFor':
      await resolveTarget(page, step.target, step.timeoutMs || 15000);
      return;
    case 'eval':
      await evaluate(page, step.expression, { awaitPromise: true });
      return;
    default:
      throw new Error(`Unknown action "${step.action}"`);
  }
}

// ---------------------------------------------------------------------------------------------
// Accessibility tree

const AX_STATES = new Set(['checked', 'expanded', 'selected', 'pressed', 'disabled', 'focused', 'required', 'invalid', 'level', 'modal']);
const TRANSPARENT_ROLES = new Set(['generic', 'none', 'presentation', 'LineBreak', 'InlineTextBox']);

function axValue(field) {
  return field && field.value !== undefined ? field.value : undefined;
}

export function axToText(nodes) {
  if (!nodes || !nodes.length) return '';
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const root = nodes.find((node) => !node.parentId) || nodes[0];
  const lines = [];
  const visit = (node, depth, parentName, guard) => {
    if (guard > 400) return;
    const role = axValue(node.role) || '';
    const name = String(axValue(node.name) ?? '').replace(/\s+/g, ' ').trim();
    const skip =
      node.ignored ||
      role === 'InlineTextBox' ||
      (TRANSPARENT_ROLES.has(role) && !name) ||
      (role === 'StaticText' && name === parentName);
    let childDepth = depth;
    let nextParentName = parentName;
    if (!skip) {
      const states = [];
      for (const property of node.properties || []) {
        if (!AX_STATES.has(property.name)) continue;
        const value = axValue(property.value);
        if (value === false || value === 'false' || value === undefined) continue;
        states.push(value === true || value === 'true' ? property.name : `${property.name}=${value}`);
      }
      const value = axValue(node.value);
      const shownValue = value !== undefined && value !== '' ? ` =${JSON.stringify(String(value).slice(0, 80))}` : '';
      lines.push(`${'  '.repeat(Math.min(depth, 40))}${role}${name ? ` "${name.slice(0, 120)}"` : ''}${shownValue}${states.length ? ` [${states.join(', ')}]` : ''}`);
      childDepth = depth + 1;
      nextParentName = name;
    }
    for (const id of node.childIds || []) {
      const child = byId.get(id);
      if (child) visit(child, childDepth, nextParentName, guard + 1);
    }
  };
  visit(root, 0, '', 0);
  return lines.join('\n');
}

export async function axSnapshot(page) {
  try {
    const { nodes } = await page.send('Accessibility.getFullAXTree', {});
    return axToText(nodes);
  } catch {
    return '';
  }
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton', 'listbox', 'treeitem',
]);

/** Interactive elements and headings, for writing scenario steps. */
export async function interactiveElements(page, limit = 120) {
  const { nodes } = await page.send('Accessibility.getFullAXTree', {});
  const out = [];
  const seen = new Map();
  for (const node of nodes) {
    if (node.ignored) continue;
    const role = axValue(node.role);
    const name = String(axValue(node.name) ?? '').replace(/\s+/g, ' ').trim();
    if (!INTERACTIVE_ROLES.has(role) && role !== 'heading') continue;
    const key = `${role}|${name}`;
    const nth = seen.get(key) || 0;
    seen.set(key, nth + 1);
    out.push({ role, name, nth });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Component source locations

/**
 * Adds file/line to every component type the tracker saw in the current document, using each
 * component function's [[FunctionLocation]] and the served scripts' URLs and source maps.
 */
export async function resolveTypes(page, { appRoot, repoRoot, mapCache }) {
  const types = (await evaluate(page, 'typeof __RENDER_AUDIT__ === "object" ? __RENDER_AUDIT__.types() : []')) || [];
  if (!types.length) return types;
  const scripts = new Map();
  const off = page.on('Debugger.scriptParsed', (event) => {
    scripts.set(event.scriptId, { url: event.url, sourceMapURL: event.sourceMapURL });
  });
  try {
    await page.send('Debugger.enable', {});
    await page.send('Debugger.setSkipAllPauses', { skip: true }).catch(() => {});
    await sleep(50);
  } catch {
    off();
    return types;
  }
  off();

  const firstByName = new Map();
  const countByName = new Map();
  for (const type of types) countByName.set(type.name, (countByName.get(type.name) || 0) + 1);

  for (const type of types) {
    // Components re-created on every render share one location; look it up once.
    if (countByName.get(type.name) > 3 && firstByName.has(type.name)) {
      Object.assign(type, firstByName.get(type.name));
      continue;
    }
    try {
      const { result } = await page.send('Runtime.evaluate', { expression: `__RENDER_AUDIT__.typeRef(${type.id})`, objectGroup: 'ra-types' });
      if (!result || result.type !== 'function') continue;
      const { internalProperties = [] } = await page.send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
      const entry = internalProperties.find((property) => property.name === '[[FunctionLocation]]');
      const location = entry && entry.value && entry.value.value;
      if (!location) continue;
      const script = scripts.get(location.scriptId);
      if (!script) continue;
      let file = toFilePath(script.url, { appRoot, repoRoot });
      let line = location.lineNumber + 1;
      // A library's own source maps point at its original sources ("../../src/client/link.tsx"),
      // which would resolve into the project. Code served from node_modules stays external.
      const fromLibrary = !!file && file.split(/[\\/]/).includes('node_modules');
      const map = fromLibrary ? null : await loadSourceMap(script, mapCache);
      if (map) {
        const position = originalPosition(map, location.lineNumber, location.columnNumber);
        if (position) {
          line = position.line + 1;
          if (position.source) {
            let source = position.source;
            if (!/^[a-z-]+:/i.test(source) && !source.startsWith('/') && /^https?:/.test(script.url)) {
              source = new URL(source, script.url).href;
            }
            file = toFilePath(source, { appRoot, repoRoot }) || file;
          }
        }
      }
      if (file) {
        const resolved = { file, line };
        Object.assign(type, resolved);
        if (!firstByName.has(type.name)) firstByName.set(type.name, resolved);
      }
    } catch {
      // a component we can't locate stays without a file
    }
  }
  await page.send('Runtime.releaseObjectGroup', { objectGroup: 'ra-types' }).catch(() => {});
  await page.send('Debugger.disable').catch(() => {});
  return types;
}

// Finds a local Chrome, starts it with --remote-debugging-pipe, and speaks the Chrome DevTools
// Protocol over that pipe. No dependencies and no debugging port to bind.
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const MAC_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const UNIX_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function onPath(name) {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    const candidate = join(dir, name);
    if (dir && isExecutable(candidate)) return candidate;
  }
  return null;
}

// Chromium builds downloaded by Playwright, used when no browser is installed system-wide.
function playwrightChromium() {
  const roots = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')];
  const inner = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux64/chrome',
    'chrome-linux/chrome',
  ];
  for (const root of roots) {
    let dirs = [];
    try {
      dirs = readdirSync(root).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse();
    } catch {
      continue;
    }
    for (const dir of dirs) {
      for (const rest of inner) {
        const candidate = join(root, dir, rest);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

export function findChrome() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (process.platform === 'darwin') {
    const app = MAC_APPS.find((path) => existsSync(path));
    if (app) return app;
  } else if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      for (const rest of ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe']) {
        const candidate = join(root, rest);
        if (existsSync(candidate)) return candidate;
      }
    }
  } else {
    for (const name of UNIX_NAMES) {
      const found = onPath(name);
      if (found) return found;
    }
  }
  return playwrightChromium();
}

/** A CDP connection over Chrome's debugging pipe (messages are JSON terminated by a NUL byte). */
export class Connection {
  #nextId = 0;
  #pending = new Map();
  #handlers = new Map();
  #chunks = [];
  #closed = null;

  constructor(writable, readable) {
    this.writable = writable;
    readable.on('data', (chunk) => this.#onData(chunk));
    readable.on('close', () => this.#fail(new Error('Chrome closed the DevTools connection')));
    writable.on('error', (error) => this.#fail(error));
  }

  send(method, params = {}, sessionId) {
    if (this.#closed) return Promise.reject(this.#closed);
    const id = ++this.#nextId;
    const message = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      this.writable.write(`${JSON.stringify(message)}\0`);
    });
  }

  /** Subscribes to a CDP event; returns an unsubscribe function. */
  on(method, handler) {
    let set = this.#handlers.get(method);
    if (!set) {
      set = new Set();
      this.#handlers.set(method, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  /** A view of the connection bound to one attached target. */
  session(sessionId) {
    return {
      id: sessionId,
      send: (method, params) => this.send(method, params, sessionId),
      on: (method, handler) =>
        this.on(method, (params, from) => {
          if (from === sessionId) handler(params);
        }),
    };
  }

  #onData(chunk) {
    this.#chunks.push(chunk);
    if (!chunk.includes(0)) return;
    let buffer = Buffer.concat(this.#chunks);
    this.#chunks = [];
    let end = buffer.indexOf(0);
    while (end !== -1) {
      const raw = buffer.subarray(0, end).toString('utf8');
      buffer = buffer.subarray(end + 1);
      if (raw) this.#dispatch(JSON.parse(raw));
      end = buffer.indexOf(0);
    }
    if (buffer.length) this.#chunks.push(buffer);
  }

  #dispatch(message) {
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) {
        const detail = message.error.data ? ` (${message.error.data})` : '';
        pending.reject(new Error(`${pending.method}: ${message.error.message}${detail}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    const handlers = this.#handlers.get(message.method);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(message.params, message.sessionId);
      } catch {
        // a faulty listener must not break the connection
      }
    }
  }

  #fail(error) {
    if (this.#closed) return;
    this.#closed = error;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(typeof message === 'function' ? message() : message)), ms);
    }),
  ]);
}

/**
 * Starts Chrome with a throwaway profile. Returns { conn, version, executablePath, close }.
 * Flags keep timers and rendering running at full speed in the background and turn off
 * features that add network noise.
 */
export async function launchChrome({ executablePath = findChrome(), headless = true, width = 1280, height = 800 } = {}) {
  if (!executablePath) {
    throw new Error('No Chrome or Chromium found. Install Google Chrome, or set CHROME_PATH to a Chromium-based browser.');
  }
  const userDataDir = mkdtempSync(join(tmpdir(), 'render-audit-chrome-'));
  const args = [
    '--remote-debugging-pipe',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-hang-monitor',
    '--disable-prompt-on-repost',
    '--disable-client-side-phishing-detection',
    '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CertificateTransparencyComponentUpdater,PaintHolding',
    '--metrics-recording-only',
    '--mute-audio',
    '--password-store=basic',
    '--use-mock-keychain',
    '--force-color-profile=srgb',
    `--window-size=${width},${height}`,
  ];
  if (headless) args.push('--headless');
  args.push('about:blank');

  const child = spawn(executablePath, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-8000);
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const spawnError = new Promise((_, reject) => child.once('error', reject));

  const conn = new Connection(child.stdio[3], child.stdio[4]);
  let version;
  try {
    version = await Promise.race([
      withTimeout(conn.send('Browser.getVersion'), 30000, () => `Chrome did not answer within 30 s.\n${stderr.trim()}`),
      spawnError,
    ]);
  } catch (error) {
    child.kill('SIGKILL');
    rmSync(userDataDir, { recursive: true, force: true });
    throw new Error(`Could not start ${executablePath}: ${error.message}`);
  }

  async function close() {
    try {
      await withTimeout(conn.send('Browser.close'), 5000, 'Browser.close timed out');
    } catch {
      // fall through to kill
    }
    await withTimeout(exited, 5000, 'exit').catch(() => child.kill('SIGKILL'));
    // Our end of the pipes stays open after Chrome exits and would keep Node running.
    for (const stream of [child.stdio[2], child.stdio[3], child.stdio[4]]) {
      if (stream) stream.destroy();
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Chrome may still hold files on some platforms; the OS cleans the temp dir later
    }
  }

  return { conn, version, executablePath, close };
}

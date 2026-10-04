// Starts and stops the dev servers a benchmark compares, so both builds run fresh with the same
// command. A command may contain {port}, which becomes the port of its URL; PORT is set as well.
// Each server runs in its own process group, and the whole group is stopped afterwards, even if
// the benchmark is interrupted.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';

const running = new Set();
let exitHooked = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function killGroup(child, signal) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    else process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  const cleanup = () => {
    for (const child of running) killGroup(child, 'SIGKILL');
  };
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      cleanup();
      process.exit(130);
    });
  }
}

export function portOf(url) {
  const parsed = new URL(url);
  return Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
}

export function fillCommand(command, port) {
  return String(command).replace(/\{port\}/g, String(port));
}

/** The HTTP status when `url` answers (anything below 500), otherwise null. */
export async function answers(url, timeoutMs = 30000) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return response.status < 500 ? response.status : null;
  } catch {
    return null;
  }
}

function tail(file, lines = 25) {
  try {
    return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '(no output)';
  }
}

async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    killGroup(child, 'SIGTERM');
    const deadline = Date.now() + 8000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(100);
  }
  // Grandchildren (the framework's own workers) may outlive the shell.
  await sleep(300);
  killGroup(child, 'SIGKILL');
  running.delete(child);
}

/**
 * Runs `command` in `cwd` and waits until `url` answers. Output goes to `logFile`. Returns
 * { name, url, pid, logFile, stop }.
 */
export async function startServer({ name, command, cwd, url, logFile, timeoutS = 180, env = {} }) {
  if (!cwd || !existsSync(cwd)) throw new Error(`The ${name} server's folder doesn't exist: ${cwd}`);
  if (await answers(url, 3000)) {
    throw new Error(`Something already answers at ${url}, so the ${name} server can't start there. Stop it, or choose another port.`);
  }
  const port = portOf(url);
  const fd = openSync(logFile, 'a');
  const child = spawn(fillCommand(command, port), {
    cwd,
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', fd, fd],
    env: { ...process.env, PORT: String(port), BROWSER: 'none', NEXT_TELEMETRY_DISABLED: '1', ...env },
  });
  closeSync(fd);
  hookExit();
  running.add(child);
  let exited = null;
  child.once('exit', (code, signal) => {
    exited = { code, signal };
  });
  child.once('error', (error) => {
    exited = { code: error.message, signal: null };
  });
  const started = Date.now();
  while (Date.now() - started < timeoutS * 1000) {
    if (exited) {
      running.delete(child);
      throw new Error(`The ${name} server stopped (${exited.code ?? exited.signal}) before answering at ${url}. Last output:\n${tail(logFile)}`);
    }
    if (await answers(url)) {
      return { name, url, pid: child.pid, logFile, stop: () => stop(child) };
    }
    await sleep(500);
  }
  await stop(child);
  throw new Error(`The ${name} server didn't answer at ${url} within ${timeoutS} s. Last output:\n${tail(logFile)}`);
}

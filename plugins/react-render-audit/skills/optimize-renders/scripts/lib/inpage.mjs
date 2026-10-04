// The scripts injected into every page before its own scripts run: the element finder that
// scenario steps use, plus either the render tracker (measure, inspect) or the timing collector
// (bench), which measures without per-render instrumentation.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FINDER_PATH = join(scriptsDir, 'finder.js');
export const TRACKER_PATH = join(scriptsDir, 'tracker.js');
export const VITALS_PATH = join(scriptsDir, 'vitals.js');

/** kind: 'tracker' (render counts and causes) or 'vitals' (timings). */
export function inPageSource(kind = 'tracker') {
  const main = kind === 'vitals' ? VITALS_PATH : TRACKER_PATH;
  return `${readFileSync(FINDER_PATH, 'utf8')}\n${readFileSync(main, 'utf8')}`;
}

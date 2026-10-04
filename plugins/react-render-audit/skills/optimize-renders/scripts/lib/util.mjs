import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJson(file, fallback) {
  if (!existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Not found: ${file}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function median(values) {
  const sorted = values.filter((value) => typeof value === 'number' && !Number.isNaN(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** "−92%" style change from a to b (a typographic minus, as in the report). */
export function percentChange(before, after) {
  if (!before) return after ? '+∞' : '0%';
  const change = Math.round(((after - before) / before) * 100);
  if (change === 0) return '0%';
  return change > 0 ? `+${change}%` : `−${Math.abs(change)}%`;
}

/** Left-aligned text table; numbers are right-aligned. */
export function table(rows, { indent = '' } = {}) {
  if (!rows.length) return '';
  const widths = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] || 0, String(cell).length)));
  return rows
    .map((row) =>
      indent +
      row
        .map((cell, i) => {
          const text = String(cell);
          return typeof cell === 'number' ? text.padStart(widths[i]) : text.padEnd(widths[i]);
        })
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export function list(value) {
  if (!value || value === true) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseViewport(value, fallback = { width: 1280, height: 800 }) {
  if (!value) return fallback;
  if (typeof value === 'object') return { width: value.width || fallback.width, height: value.height || fallback.height };
  const match = /^(\d+)x(\d+)$/.exec(String(value));
  return match ? { width: Number(match[1]), height: Number(match[2]) } : fallback;
}

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

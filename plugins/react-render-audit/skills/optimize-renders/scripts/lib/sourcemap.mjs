// Maps a position in served JavaScript back to the original source file, and turns the many URL
// shapes dev servers use (webpack-internal, webpack://, turbopack, Vite paths) into file paths.
import { createHash } from 'node:crypto';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) DIGIT[BASE64.charCodeAt(i)] = i;

/** Decodes a source map `mappings` string into lines of [generatedColumn, source, line, column]. */
export function decodeMappings(mappings) {
  const lines = [];
  let line = [];
  let generatedColumn = 0;
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let fields = [];

  const flush = () => {
    if (!fields.length) return;
    generatedColumn += fields[0];
    if (fields.length >= 4) {
      source += fields[1];
      sourceLine += fields[2];
      sourceColumn += fields[3];
      line.push([generatedColumn, source, sourceLine, sourceColumn]);
    } else {
      line.push([generatedColumn]);
    }
    fields = [];
  };

  for (let i = 0; i < mappings.length; ) {
    const code = mappings.charCodeAt(i);
    if (code === 59) {
      // ';' ends a generated line
      flush();
      lines.push(line);
      line = [];
      generatedColumn = 0;
      i++;
      continue;
    }
    if (code === 44) {
      // ',' ends a segment
      flush();
      i++;
      continue;
    }
    let value = 0;
    let shift = 0;
    let digit;
    do {
      digit = DIGIT[mappings.charCodeAt(i++)];
      if (digit === undefined || digit < 0) throw new Error('Invalid source map mappings');
      value += (digit & 31) * 2 ** shift;
      shift += 5;
    } while (digit & 32);
    fields.push(value % 2 === 1 ? -Math.floor(value / 2) : value / 2);
  }
  flush();
  lines.push(line);
  return lines;
}

/** Original { source, line, column } (all 0-based) for a generated 0-based line and column. */
export function originalPosition(map, line, column) {
  if (!map) return null;
  if (Array.isArray(map.sections)) {
    let section = null;
    for (const candidate of map.sections) {
      const { line: offsetLine, column: offsetColumn } = candidate.offset;
      if (offsetLine < line || (offsetLine === line && offsetColumn <= column)) section = candidate;
      else break;
    }
    if (!section || !section.map) return null;
    const relLine = line - section.offset.line;
    const relColumn = relLine === 0 ? column - section.offset.column : column;
    return originalPosition(section.map, relLine, relColumn);
  }
  if (!map.decoded) map.decoded = decodeMappings(map.mappings || '');
  const segments = map.decoded[line];
  if (!segments || !segments.length) return null;
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid][0] <= column) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // A function's location can sit just before the first mapped column of its line.
  const segment = segments[found === -1 ? 0 : found];
  if (segment.length < 4) return null;
  let source = map.sources ? map.sources[segment[1]] : null;
  if (source && map.sourceRoot && !/^[a-z]+:/i.test(source) && !source.startsWith('/')) {
    source = `${map.sourceRoot.replace(/\/$/, '')}/${source}`;
  }
  return { source, line: segment[2], column: segment[3] };
}

function parseDataUrl(url) {
  const comma = url.indexOf(',');
  if (comma === -1) return null;
  const meta = url.slice(0, comma);
  const data = url.slice(comma + 1);
  const text = meta.includes(';base64') ? Buffer.from(data, 'base64').toString('utf8') : decodeURIComponent(data);
  return JSON.parse(text);
}

/** Loads (and caches) the source map of a parsed script. Returns null when there isn't one. */
export async function loadSourceMap(script, cache) {
  const ref = script.sourceMapURL;
  if (!ref) return null;
  let key;
  let absolute = null;
  if (ref.startsWith('data:')) {
    key = `data:${createHash('sha1').update(ref).digest('hex')}`;
  } else {
    try {
      absolute = new URL(ref, script.url).href;
    } catch {
      return null;
    }
    if (!/^https?:/.test(absolute)) return null;
    key = absolute;
  }
  if (cache.has(key)) return cache.get(key);
  let map = null;
  try {
    if (absolute) {
      const response = await fetch(absolute);
      if (response.ok) map = await response.json();
    } else {
      map = parseDataUrl(ref);
    }
  } catch {
    map = null;
  }
  cache.set(key, map);
  return map;
}

/**
 * Turns a script URL or a source map `sources` entry into an absolute file path, or null when it
 * names no file (a bundle chunk, an inline script). `appRoot` is the directory webpack and Vite
 * resolve `./` paths against; `repoRoot` is what Turbopack's `[project]` means.
 */
export function toFilePath(candidate, { appRoot, repoRoot = appRoot } = {}) {
  if (!candidate || typeof candidate !== 'string') return null;
  let value = candidate.trim();
  // Loader chains: keep the resource after the last '!'
  if (value.includes('!')) value = value.slice(value.lastIndexOf('!') + 1);
  value = value.replace(/[?#].*$/, '');
  if (!value) return null;

  let base = appRoot;
  if (value.startsWith('webpack-internal:///')) {
    value = value.slice('webpack-internal:///'.length);
  } else if (value.startsWith('webpack://')) {
    value = value.slice('webpack://'.length);
    // drop the namespace segment (webpack://_N_E/./src/x.tsx, webpack:///./src/x.tsx)
    value = value.startsWith('/') ? value.slice(1) : value.slice(value.indexOf('/') + 1);
  } else if (value.startsWith('turbopack://')) {
    value = value.replace(/^turbopack:\/\/\/?/, '');
  } else if (value.startsWith('file://')) {
    try {
      return normalize(fileURLToPath(value));
    } catch {
      return null;
    }
  } else if (/^https?:\/\//.test(value)) {
    let path;
    try {
      path = decodeURIComponent(new URL(value).pathname);
    } catch {
      return null;
    }
    if (path.startsWith('/@fs/')) return normalize(path.slice('/@fs'.length));
    if (path.startsWith('/@id/') || path.startsWith('/@vite/') || path.startsWith('/_next/') || path.startsWith('/__')) return null;
    if (!/\.(m?[jt]sx?|cjs|cts|mts|vue|svelte)$/.test(path)) return null;
    return normalize(join(appRoot, path));
  }

  // Next.js layer prefixes: (pages-dir-browser)/./src/x.tsx, (app-pages-browser)/./src/x.tsx
  value = value.replace(/^\([^)]+\)\//, '');
  if (value.startsWith('[project]/')) {
    value = value.slice('[project]/'.length);
    base = repoRoot;
  }
  if (isAbsolute(value)) return normalize(value);
  return normalize(join(base, value));
}

/** 'scope' | 'project' | 'external' for a file path, given the audit scope directories. */
export function classifyFile(file, { scope = [], repoRoot }) {
  if (!file) return 'unknown';
  if (file.split(sep).includes('node_modules') || file.includes('/node_modules/')) return 'external';
  for (const dir of scope) {
    const rel = relative(dir, file);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return 'scope';
  }
  if (repoRoot) {
    const rel = relative(repoRoot, file);
    if (rel.startsWith('..') || isAbsolute(rel)) return 'external';
  }
  return 'project';
}

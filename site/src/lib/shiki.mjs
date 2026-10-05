// @ts-check
import {
  transformerNotationDiff,
  transformerNotationErrorLevel,
  transformerNotationHighlight,
} from '@shikijs/transformers';

/** Shared Shiki setup for Markdown code fences and the <CodeBlock> component. */

export const CODE_THEMES = /** @type {const} */ ({ light: 'github-light', dark: 'github-dark' });

/** @type {Record<string, string>} */
const LANG_LABEL = {
  tsx: 'TSX',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  js: 'JavaScript',
  javascript: 'JavaScript',
  css: 'CSS',
  html: 'HTML',
  json: 'JSON',
  bash: 'Terminal',
  sh: 'Terminal',
  shell: 'Terminal',
  diff: 'Diff',
  md: 'Markdown',
  markdown: 'Markdown',
};

/**
 * Parses "1,3-5" into a set of 1-based line numbers.
 * @param {string} spec
 */
function parseLineRanges(spec) {
  const lines = new Set();
  for (const part of spec.split(',')) {
    const [start, end = start] = part.split('-').map((n) => Number.parseInt(n, 10));
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    for (let line = start; line <= end; line++) lines.add(line);
  }
  return lines;
}

const META_LINE_CLASSES = {
  mark: ['highlighted'],
  add: ['diff', 'add'],
  del: ['diff', 'remove'],
  error: ['highlighted', 'error'],
  warn: ['highlighted', 'warning'],
};

/**
 * Marks lines from the fence meta: mark="2", add="5-7", del="3", error="2,9", warn="4".
 * Use these for JSX lines, where a `// [!code ++]` comment isn't valid syntax. Inline
 * `// [!code …]` notation still works on JavaScript lines.
 * @returns {import('shiki').ShikiTransformer}
 */
function transformerMetaLines() {
  return {
    name: 'rbp:meta-lines',
    preprocess(code) {
      if (/\{\s*\/\*\s*\[!code/.test(code)) {
        throw new Error(
          'Code blocks must not use JSX-comment notation like {/* [!code ++] */}: it leaves stray braces. ' +
            'Mark JSX lines with fence meta instead, e.g. ```tsx add="5" del="3".',
        );
      }
    },
    line(node, line) {
      const raw = this.options.meta?.__raw ?? '';
      for (const [key, classes] of Object.entries(META_LINE_CLASSES)) {
        const spec = raw.match(new RegExp(`\\b${key}="([\\d,\\s-]+)"`))?.[1];
        if (spec && parseLineRanges(spec.replace(/\s/g, '')).has(line)) this.addClassToHast(node, classes);
      }
    },
  };
}

/**
 * Wraps every highlighted block in <figure class="code"> with a caption bar, at build time.
 * Fence meta: `title="File.tsx"` names the block; a bare `bad` or `good` marks it as the
 * issue or the fix version.
 * @returns {import('shiki').ShikiTransformer}
 */
function transformerCodeFigure() {
  return {
    name: 'rbp:code-figure',
    root(root) {
      const pre = /** @type {import('hast').Element | undefined} */ (
        root.children.find((node) => node.type === 'element' && node.tagName === 'pre')
      );
      if (!pre) return;
      const raw = this.options.meta?.__raw ?? '';
      const title = raw.match(/title="([^"]+)"/)?.[1];
      const words = raw.replace(/title="[^"]*"/, '').split(/\s+/);
      const variant = words.includes('bad') ? 'issue' : words.includes('good') ? 'fix' : undefined;
      const lang = this.options.lang ?? 'text';
      const langLabel = LANG_LABEL[lang] ?? '';

      /** @type {import('hast').ElementContent[]} */
      const caption = [];
      if (variant) {
        caption.push({
          type: 'element',
          tagName: 'span',
          properties: { className: ['code-variant'] },
          children: [{ type: 'text', value: variant === 'issue' ? 'Issue' : 'Fix' }],
        });
      }
      caption.push({
        type: 'element',
        tagName: 'span',
        properties: { className: ['code-title'] },
        children: [{ type: 'text', value: title ?? langLabel }],
      });
      if (title && langLabel) {
        caption.push({
          type: 'element',
          tagName: 'span',
          properties: { className: ['code-lang'] },
          children: [{ type: 'text', value: langLabel }],
        });
      }

      root.children = [
        {
          type: 'element',
          tagName: 'figure',
          properties: { className: ['code'], dataLang: lang, dataVariant: variant },
          children: [
            { type: 'element', tagName: 'figcaption', properties: { className: ['code-head'] }, children: caption },
            pre,
          ],
        },
      ];
    },
  };
}

/** The transformers, in order: line marks, inline notation, then the figure wrapper. */
export function codeTransformers() {
  return [
    transformerMetaLines(),
    transformerNotationDiff(),
    transformerNotationHighlight(),
    transformerNotationErrorLevel(),
    transformerCodeFigure(),
  ];
}

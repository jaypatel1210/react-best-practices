# Example: Trimming an Invoicing App's Entry Chunk

An invoicing SPA built with Vite ships a 780 KB (minified) entry chunk. Every page, including the login screen, waits for it.

## Step 1: read the report

```bash
npx vite-bundle-visualizer        # or: rollup-plugin-visualizer in vite.config, @next/bundle-analyzer for Next.js
```

Sorting the treemap by size shows five problems:

1. a date library with every locale (~230 KB);
2. the CommonJS build of `lodash` (~70 KB), imported for three functions;
3. an icon package whose 1,600 icons are all included;
4. a markdown editor and a syntax highlighter (~200 KB), used only on the Settings page;
5. polyfills for browsers the app doesn't support.

## Step 2: dates without a date library

```ts
// Before
import moment from 'moment';
export const formatDue = (d: Date) => moment(d).format('MMM D, YYYY');
export const fromNow = (d: Date) => moment(d).fromNow();
```

```ts
// After: the platform's Intl APIs, cached per locale
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export const formatDue = (d: Date) => dateFormat.format(d);
export const fromNow = (d: Date) => {
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  return relative.format(days, 'day');
};
```

When date math gets complex (time zones, recurrence), use a modular library (`date-fns`, `dayjs`) and import only the functions you need. Create `Intl` formatters once: constructing them is the expensive part.

## Step 3: lodash

```ts
import _ from 'lodash';              // the whole library, CommonJS, not tree-shakable
_.debounce(fn, 300); _.groupBy(rows, 'status'); _.isEqual(a, b);
```

Options, best first:

- **Native code:** `Object.groupBy(rows, (r) => r.status)` (Baseline 2024), `structuredClone` for deep copies, and the project's own debounce hook (`react-refs-closures` has a tested one).
- **The ES module build with named imports:** `import { isEqual } from 'lodash-es'`.
- **Per-method paths**, which also work for CommonJS: `import isEqual from 'lodash/isEqual'`.

## Step 4: icons

```tsx
// Before: dynamic access keeps every export alive
import * as Icons from '@acme/icons';
export function Icon({ name }: { name: keyof typeof Icons }) {
  const Svg = Icons[name];
  return <Svg aria-hidden />;
}
```

The bundler can't know which `name` values will be used, so all 1,600 icons ship. Name the icons the app actually uses:

```tsx
import { Bell, Check, Download, FileText, Search } from '@acme/icons';

const icons = { bell: Bell, check: Check, download: Download, 'file-text': FileText, search: Search } as const;
export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  const Svg = icons[name];
  return <Svg aria-hidden />;
}
```

Static named imports let tree-shaking drop the rest. If the icon package re-exports everything from one index file and isn't marked side-effect free, also import from its per-icon paths, or add it to Next.js's `optimizePackageImports`.

## Step 5: an internal package that defeats tree-shaking

The markdown editor reached the entry chunk through the team's design-system package:

```ts
// packages/ui/src/index.ts
export * from './Button';
export * from './Avatar';
export * from './MarkdownEditor'; // imports the editor and the highlighter at module level
```

The invoice list imports only `Button` and `Avatar`, but the package's `package.json` has no `"sideEffects"` field, so the bundler must assume every re-exported module does something on import, and keeps them all.

```json
{
  "name": "@acme/ui",
  "sideEffects": ["*.css"]
}
```

With `sideEffects` declared, unused re-exports are dropped, while the package's CSS files still load. Then lazy-load the editor where it's used (`examples/code-splitting.md`), so Settings downloads it on demand.

## Step 6: polyfills and targets

Check `browserslist` (in `package.json` or `.browserslistrc`). A `> 0.2%, not dead`-style query from an old template, or `@vitejs/plugin-legacy` enabled "just in case", ships transpiled code and polyfills that modern browsers never use. Set targets that match the browsers your users actually have, and add legacy builds only when analytics justify them.

## Step 7: keep it from coming back

```json
// package.json
"size-limit": [
  { "name": "entry", "path": "dist/assets/index-*.js", "limit": "120 kB" }
]
```

Run `size-limit` in CI so a pull request that adds a large import fails with a size diff. Know what each tool measures:

- `size-limit` reports compressed size;
- Vite's `build.chunkSizeWarningLimit` (default 500 kB) compares *uncompressed* chunk size;
- webpack's `performance.maxEntrypointSize` and `maxAssetSize` use bytes of emitted assets.

A common starting budget for first-load JavaScript is around 150–200 KB compressed for the whole page, including framework code.

## Result

The entry chunk went from 780 KB to 240 KB minified (about 75 KB compressed). The login page no longer downloads the editor, the icon set or the date locales.

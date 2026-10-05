// @ts-check
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { CODE_THEMES, codeTransformers } from './src/lib/shiki.mjs';

// Absolute paths, resolved from this file, so build-time code can read the skills and font files
// no matter which directory the build runs from.
const siteRoot = fileURLToPath(new URL('./', import.meta.url));
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

// Where the site is deployed. The defaults target GitHub Pages for this repository;
// for a custom domain, set SITE_URL=https://example.com and BASE_PATH=/ when building.
const site = process.env.SITE_URL ?? 'https://jaypatel1210.github.io';
const base = process.env.BASE_PATH ?? '/react-best-practices';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  compressHTML: true,
  build: { format: 'directory' },
  integrations: [
    mdx(),
    react(),
    sitemap({
      filter: (page) => !/\/404\/?$/.test(page),
    }),
  ],
  markdown: {
    shikiConfig: {
      themes: CODE_THEMES,
      defaultColor: false,
      transformers: codeTransformers(),
    },
  },
  vite: {
    define: {
      __SITE_ROOT__: JSON.stringify(siteRoot),
      __REPO_ROOT__: JSON.stringify(repoRoot),
    },
    resolve: {
      // Demos import the tested hooks from ../skills, which sit next to the repository's own
      // node_modules. Dedupe so every import resolves to the site's single copy of React.
      dedupe: ['react', 'react-dom'],
    },
    server: { fs: { allow: ['..'] } },
  },
});

// @vitest-environment jsdom
// Same suite on React 18 (installed in fixtures/react18: run `npm install` there once).
import '../skills/optimize-renders/scripts/tracker.js';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { trackerSuite } from './tracker-suite.mjs';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'react18');

if (existsSync(join(fixture, 'node_modules', 'react-dom', 'package.json'))) {
  const require = createRequire(join(fixture, 'package.json'));
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  trackerSuite(React.version, React, createRoot);
} else {
  describe('tracker on React 18', () => {
    it.skip('needs `npm install` in plugins/react-render-audit/fixtures/react18', () => {});
  });
}

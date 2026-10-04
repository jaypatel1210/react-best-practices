// @vitest-environment jsdom
// The tracker must load before react-dom, exactly as it does in the browser.
import '../skills/optimize-renders/scripts/tracker.js';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { trackerSuite } from './tracker-suite.mjs';

trackerSuite(React.version, React, createRoot);

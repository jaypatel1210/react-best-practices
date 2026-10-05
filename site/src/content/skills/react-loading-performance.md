---
title: "Loading performance"
headline: "Ship less JavaScript, start the critical resources first, and keep the page still while it loads."
description: "Make React apps load fast: bundle analysis and tree-shaking, route and interaction code splitting, preloading on intent, LCP images, web fonts and layout shift."
group: speed
rules:
  - "Open the bundle report before cutting anything, and start with the entry chunk."
  - "Split by route first, then by interaction, and call lazy at module scope."
  - "Start downloads on intent, such as hover, focus or idle time, together with the data the code needs."
  - "The LCP image belongs in the server HTML: never lazy, with fetchPriority high, an accurate srcSet and dimensions."
  - "Reserve space for everything that arrives late: images, embeds, ads and lazy fallbacks."
  - "Self-host WOFF2 fonts, preload only first-screen files with crossorigin, and match the fallback's metrics."
  - "Judge LCP and CLS at the 75th percentile of real page loads. Lab tools explain, field data decides."
prompts:
  - "Our landing page's LCP is 4 seconds on mobile. Can you find out why?"
  - "The main bundle is 800 KB. What's in it, and how do we cut it?"
  - "Add code splitting to the routes and the heavy editor dialog."
  - "Text jumps when our web font loads."
---

A page load is a chain of dependencies: the HTML, then the CSS and JavaScript it references, then data, images and fonts. Every link that starts late, or carries bytes the first screen doesn't need, pushes back the moment users see what they came for. This skill teaches Claude to decide what goes into the first load and when each resource starts.

Claude reads the bundle report before changing anything, fixes imports that defeat tree-shaking, splits code by route and then by interaction, and preloads chunks on intent so nothing a user clicks waits on a cold download. It knows the React 19 resource APIs, such as `preload`, `preconnect` and `preinit`, and when a plain `<link>` or the framework's image component is the better tool.

For Core Web Vitals, Claude splits Largest Contentful Paint into its four parts and fixes the largest, keeps the hero image discoverable and prioritized, and prevents layout shift with reserved space and metric-matched font fallbacks. It checks results against field data at the 75th percentile, not a single Lighthouse run.

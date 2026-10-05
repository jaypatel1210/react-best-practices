---
title: "Data fetching"
headline: "Start requests early and in parallel, and let only the latest response land."
description: "How to load data in React without waterfalls or race conditions: start requests in parallel, cancel stale ones, and keep content on screen while refetching."
group: data
rules:
  - "Decide the loading sequence first: what users see first, what can arrive later, and what each placeholder looks like."
  - "A child's effect can't start before the child mounts, so parent-then-child fetching is a waterfall."
  - "Start independent requests together, as early as you know they're needed: in one component, with Promise.all, in providers or loaders."
  - "Every fetch in an effect cleans up with AbortController or an ignore flag, so a late, older response can't overwrite a newer one."
  - "fetch resolves on HTTP errors. Check res.ok, and render loading, error and empty states explicitly."
  - "Keep existing data visible during refetches, with a subtle indicator, instead of swapping in a spinner."
  - "Use the framework's loaders or a data library rather than hand-rolled caching."
prompts:
  - "The dashboard shows spinners one after another. Can you make it load faster?"
  - "Search sometimes shows results for what I typed before. Why?"
  - "Should this fetch live in a useEffect, TanStack Query or a route loader?"
---

Fast renders can't rescue a page whose data arrives late or out of order. This skill teaches Claude that most fetching problems come from *when* requests start and *which* response wins, not from the library. Claude picks the layer first: framework loaders or Server Components for route data, a client library such as TanStack Query or SWR for anything beyond "fetch once", and raw `fetch` in an effect only for simple cases.

Claude spots waterfalls in the component structure: a parent that shows a spinner before it renders the child that fetches next. It moves where requests *start*, using one component, `Promise.all`, data providers, route loaders or library prefetching, and it keeps a chain only where one request really needs another's result.

Every fetch Claude writes is safe when inputs change quickly. It aborts or ignores the previous request in the effect's cleanup, checks `res.ok`, renders explicit loading, error and empty states, and keeps the previous content on screen while the next item loads.

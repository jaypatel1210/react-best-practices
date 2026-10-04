# Troubleshooting

## Chrome won't start / "Chrome closed the DevTools connection"

- `ra doctor` checks Node and starts Chrome headless. Set `CHROME_PATH` to a Chrome, Chromium or Edge binary if none is found; Playwright's downloaded Chromium is picked up automatically.
- **Sandboxed shells** (such as Claude Code's Bash sandbox) usually block what Chrome needs (its profile socket) and block dev servers from listening on a port. Run `doctor`, `inspect`, `measure` and the dev server outside the sandbox (the user approves each command), or have the user allow local binding (`sandbox.network.allowLocalBinding`) and adjust the sandbox with `/sandbox`.

## "No React renderer registered" / React not detected

- The page might not be React, or React might live in an iframe (only the top frame is measured).
- Something on the page may disable React DevTools (code that overwrites `__REACT_DEVTOOLS_GLOBAL_HOOK__`). Look for "disable react devtools" snippets and turn them off for local development.
- Make sure you're measuring the dev server, not a production deployment. Production builds work but have minified component names and no render timings.

## Component files are missing ("file unknown")

Locations come from each component function's source position plus the dev server's source maps. They work with webpack (Next.js), Turbopack and Vite in development. Without source maps, or for components from `node_modules`, the file stays empty and the component counts as outside the scope. Check that the dev server serves source maps.

## A step never settles

The step waits until React has been idle and the network quiet for `quietMs`. Polling, streaming connections, analytics beacons or animations held in state prevent that.

- Add the polling URL to `ignoreRequests` in the scenario (requests open longer than 5 s are already ignored).
- Raise `maxSettleMs` for slow steps, or lower `quietMs` for very busy pages.
- If React itself never goes idle, `analyze` reports a `continuous` hotspot naming the component that keeps updating.

## Render counts vary between runs

Live data, the clock, random ordering, feature flags and request timing all change what renders. Use stable test data, add `waitFor` steps for async content, and exclude live regions. `analyze` names the steps that varied; compare medians from several runs (`--runs 5`) if some noise remains.

## The behavior comparison reports noise

Lines that already differed between baseline runs are ignored automatically. If a difference is real but harmless (a CSS-in-JS class hash the normalizer missed, for example), confirm that the visible text and accessibility tree are unchanged, then re-run compare with `--allow-dom` and say why in the change log. Never use `--allow-dom` when text, accessibility, network or console differ.

## Next.js notes

- `next dev` compiles each route on its first request; the warm-up run absorbs that.
- Server Components never re-render in the browser, so only client components appear. Moving work out of a client component into a Server Component is a structural fix, but it's an `ask` change.
- Middleware rewrites and redirects appear as Document requests. They take part in the comparison because they're part of the app's behavior.
- Locale or subdomain routing: use the local URL form the app documents (for example `/_companies/<slug>`).

## Monorepos

`detect` looks for a root script like `dev:<app>` that also builds workspace packages. Set `--root` to the app folder; components from workspace packages resolve to their source files and count as project code. Add those package directories to the scope if they're the target.

## Production timings (optional)

Counts are measured on the development build because it keeps component names and file locations. To confirm timing gains in production, build with React's profiling build (`next build --profile`, or aliasing `react-dom/client` to `react-dom/profiling`), serve it, and measure the same scenario under a different label. Names may be minified there, so compare totals and long frames rather than per-component counts.

# Real users and CI

The timing benchmark proves cause and effect in a controlled lab. Two more kinds of evidence go beyond it:
- what real users experience after the change ships;
- a check that keeps the gain from regressing.

Each of these changes something outside the audit (an API key, app code, a CI workflow), so offer them and do them only with the user's go-ahead, each as its own commit.

## Chrome UX Report (public sites)

The Chrome UX Report (CrUX) is Google's dataset of real Chrome users. Its numbers are the 75th percentile over a rolling 28 days, per origin or URL, and per phone, desktop or tablet. Search's Core Web Vitals assessment uses the same numbers.

- **Needs:**
  - A public site with enough Chrome traffic. Small or private apps aren't in it.
  - A free API key: in Google Cloud, enable the "Chrome UX Report API" and create a key. The user exports it, for example as `CRUX_API_KEY`. Never ask for the key in chat, and never print it.
- **Now:** `ra field crux --origin https://example.com --form-factor phone`
- **Week by week, around a deploy:** `ra field crux --origin https://example.com --history --deploy 2026-10-04`
- **Reading it:**
  - Each data point covers 28 days, and consecutive points overlap by three weeks.
  - The first point made only of post-deploy visits ends about four weeks after the deploy; the command prints that date.
  - Anything else that shipped in the same window also counts, so present CrUX as confirmation, not proof of cause.
- **Saving it:** `--audit <audit> --save crux-before` stores it, and the report shows it under "Real users".

## Your own real-user data

For apps CrUX doesn't cover, or for per-page and per-element detail, send Core Web Vitals from the app itself.

1. **Reporter.** Copy `assets/web-vitals-reporter.js` into the app.
   - Add the `web-vitals` package.
   - Call `reportWebVitals({ endpoint: '/api/vitals', release: <commit SHA or build id> })` once on the client: from a client component in the root layout, `pages/_app`, or next to `createRoot`.
   - It sends INP, LCP and CLS with their attribution (the element, interaction type, and input delay, processing and presentation) as a JSON array when the page is hidden.
2. **Endpoint.** Store each record as a JSON line, wherever logs or analytics already go. In the Next.js App Router, for example:

   ```ts
   // app/api/vitals/route.ts
   export async function POST(request: Request) {
     const records = await request.json(); // sendBeacon posts text; .json() parses it anyway
     for (const record of records) console.log(JSON.stringify({ webVitals: record }));
     return new Response(null, { status: 204 });
   }
   ```

   Then export those lines (as JSON lines, a JSON array or CSV) from the log or analytics tool.
3. **Compare** two periods, or two releases:

   ```
   ra field compare --data vitals.jsonl --split-at 2026-10-04 --metric INP --by page
   ra field compare --data vitals.jsonl --before-release 3f2a1c9 --after-release 8b7e0d4 --by target
   ra field compare --before september.jsonl --after october.jsonl --metric LCP
   ```

   Each group gets its p75 before and after, the change with a 95% confidence interval, the rating, and a verdict. Groups with fewer than 50 samples on either side are listed but not judged (`--min-samples`).

**Privacy.** Records hold route names, element selectors and timings, but no user data. Use `sampleRate` on high-traffic apps. Adding the reporter means a new dependency and new network requests, so it's a product decision: ask first, and keep it out of the fix commits.

## CI: a benchmark on every pull request

```
ra ci --app apps/web --scenario apps/web/.render-audit/scenarios/checkout.json \
      --dev "pnpm --filter web dev --port {port}" --paths "apps/web/**,packages/ui/**"
```

This writes `.github/workflows/render-benchmark.yml`. On each pull request the workflow:
1. checks out the pull request with full history;
2. installs dependencies;
3. fetches this tool;
4. checks out and installs the base commit (`ra baseline`);
5. starts both dev servers;
6. runs `ra bench` on the mobile and desktop profiles;
7. writes the comparison to the job summary and uploads `bench.json` and the Chrome traces as an artifact.

- **Scenario files** must be committed, at the paths given to `--scenario`.
- **Dev command.** `--dev` is the dev command with `{port}` where the port goes, run from `--dev-cwd`, which defaults to where `detect` says the dev server runs. Check it locally first, using two different ports.
- **Secrets.** If the dev server needs secrets, add them as repository secrets and expose them in the workflow's `env`. Both servers inherit them.
- **Noise.** Shared runners are noisier than a laptop. The A/A check measures that noise and runs more pairs (up to 20; raise it with `--max-pairs`). Beyond that it reports "no measurable change" rather than guessing. A larger or self-hosted runner gives tighter results.
- **Failing.** `--fail-on slower` (the default) fails the job when the pull request is measurably slower with medium impact or more. Use `--fail-on none` to only report.
- **Pinning.** Pin `--tool-ref` to a commit of this repository for reproducible results; the default is `main`.

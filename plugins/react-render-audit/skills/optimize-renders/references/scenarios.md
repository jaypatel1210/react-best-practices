# Scenarios

A scenario is a short, repeatable user flow in JSON. The runner opens the page in a fresh headless Chrome profile, performs each step with real mouse and keyboard input, waits until React and the network go quiet, and records renders, the visible text, the accessibility tree, the DOM, requests and console errors for that step.

## Format

```json
{
  "name": "company-page",
  "description": "Search a service, open it, pick a staff member.",
  "url": "/_companies/acme-salon",
  "steps": [
    { "name": "search \"hair\"", "action": "type", "target": { "role": "searchbox", "name": "Search services" }, "text": "hair" },
    { "action": "click", "target": { "role": "button", "name": "Haircut" } },
    { "action": "waitFor", "target": { "role": "heading", "name": "Choose a staff member" } },
    { "action": "click", "target": { "text": "Any available" } }
  ]
}
```

- `url` is resolved against the `--url` given to `init`; an absolute URL also works. Step 0, `load`, opens it.
- `name` is optional. Steps get readable default names, and names must be unique within a scenario.
- Optional: `viewport` (`"1280x800"`), `ignoreSelectors` (CSS selectors left out of the DOM comparison, such as a live clock), `ignoreRequests` (substrings or `/regex/` of URLs left out of the network comparison), and `load.quietMs`/`load.maxSettleMs` for slow pages.

## Actions

| action | fields | what it does |
|---|---|---|
| `click` | `target`, `clickCount?` | Scrolls the element into view and clicks its center |
| `hover` | `target` | Moves the mouse onto the element |
| `type` | `target?`, `text`, `delayMs?` (60), `clear?`, `submit?` | Clicks the field, then types key by key, like a user |
| `press` | `key` | `Enter`, `Escape`, `Tab`, `ArrowDown`, `Backspace`, `Shift+Tab`, … |
| `fill` / `select` | `target`, `value` | Sets the value in one go (`<select>`, long text you don't need per keystroke) |
| `scroll` | `deltaY?` (600), `times?` (1), `delayMs?`, `target?` | Mouse-wheel scrolling, over `target` or the page |
| `resize` | `width`, `height` | Changes the viewport (fires `resize`) |
| `wait` | `ms` | Waits a fixed time (timers, debounces) |
| `waitFor` | `target`, `timeoutMs?` | Waits until the element is visible |
| `goto` | `url` | Full navigation to another page |
| `eval` | `expression` | Runs JavaScript in the page; last resort |

Every step also accepts `quietMs` (how long the page must stay quiet, default 500) and `maxSettleMs` (default 10000).

## Targets

Prefer what users see; that keeps scenarios working after refactors.

| target | matches |
|---|---|
| `{ "role": "button", "name": "Save" }` | Accessibility role and accessible name (exact first, then case-insensitive "contains") |
| `{ "label": "Email" }` | A form control by its `<label>` text or `aria-label` |
| `{ "placeholder": "Search" }` | A field by placeholder |
| `{ "text": "Any available" }` | The clickable element around that text |
| `{ "testId": "slot-10-00" }` | `data-testid` |
| `{ "selector": "#cart > button" }` | A CSS selector, last resort |

Add `"nth": 1` to pick the second match, and `"exact": true` to require an exact name or text. `ra inspect --url <page>` prints the interactive elements with ready-made targets.

## Logins and secrets

- Text in `type` and `fill` may contain `${VAR_NAME}`, read from the environment when the scenario runs: `{ "action": "type", "target": { "label": "Password" }, "text": "${TEST_PASSWORD}" }`. Ask the user to export the variables. Never write credentials into the file.
- Alternatively, pass `--cookies cookies.json` to `measure` and `inspect` (an array of CDP cookie objects, or `{ "cookies": [...] }`) exported from a logged-in test session.

## Keeping runs deterministic

Render counts are only comparable when every run sees the same data and timing.

- Measure against data that doesn't change between runs: a fixed test account, seeded or staging data, or mocks.
- Prefer flows without randomness. Exclude rotating banners and live clocks with `ignoreSelectors`.
- Wait for content with `waitFor` rather than `wait` whenever there's something visible to wait for.
- Keep it short: 3 to 8 steps around the components in scope. Typing three or four characters shows a keystroke problem as well as twenty do.
- Never complete irreversible actions (payments, deletions, invitations). Each run repeats the whole flow, warm-up included.
- `analyze` reports when counts varied between runs; check that before trusting a comparison.

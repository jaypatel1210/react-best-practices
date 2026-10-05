# React Best Practices: the website

The website for the skills in this repository. Every rule the skills teach Claude is shown here as a real issue: the symptom, why it happens, the fix, how to confirm it, and, for many of them, a live demo you can break and repair.

It's a static [Astro](https://astro.build) site. Pages ship as plain HTML with almost no JavaScript, and the demos are React islands that load only when they scroll into view.

## Commands

Run these from `site/`:

```bash
bun install
bun run dev       # local dev server at http://localhost:4321/react-best-practices/
bun run build     # static build into dist/
bun run preview   # serve the build
bun run check     # type-check .astro, .ts and .tsx files
```

## Deploying

The site builds to static files in `dist/`, so any static host works.

- **GitHub Pages** (the default): `.github/workflows/deploy-site.yml` builds and deploys on every push to `main` that touches `site/` or `skills/`. In the repository settings, set **Pages → Source** to **GitHub Actions**.
- **A custom domain or another host**: set `SITE_URL` (for example `https://reactbestpractices.dev`) and `BASE_PATH` (`/` for a domain root) when building. Canonical URLs, the sitemap, Open Graph images and every internal link follow these two values.

After the first deploy, submit `<site>/sitemap-index.xml` in Google Search Console and Bing Webmaster Tools. On GitHub Pages under a project path, `robots.txt` isn't at the domain root, so crawlers ignore it; the sitemap submission covers that. With a custom domain it works as is.

## How the site is organized

```
site/
├── astro.config.mjs        # site URL and base path, integrations, Shiki code-block transformers
├── public/                 # favicon.svg
└── src/
    ├── config.ts           # site name, author, repository, install commands
    ├── content.config.ts   # schemas for fixes, skills, and the SKILL.md frontmatter
    ├── content/
    │   ├── fixes/          # one MDX file per issue → /fixes/<slug>/
    │   └── skills/         # one Markdown file per skill → /skills/<skill-id>/
    ├── components/         # Astro components, and demos/ (React islands)
    ├── layouts/            # BaseLayout: head, SEO tags, header, footer, search
    ├── lib/                # URLs, content helpers, JSON-LD builders, OG images
    ├── pages/              # routes, plus endpoints for search, RSS, robots, OG images
    └── styles/global.css   # design tokens (light and dark) and shared components
```

Some content comes straight from the skills, so it never drifts:

- Skill names and descriptions come from each `skills/*/SKILL.md`.
- The review checklist page parses `skills/react-best-practices/references/review-checklist.md`.
- The utilities pages show the source of `skills/*/assets/*` and link to their tests.
- Some demos import those same tested hooks.

## Writing a fix page

A fix page lives at `src/content/fixes/<slug>.mdx`. The slug is the URL, so make it short, lowercase and hyphenated, and describe the **symptom** (`input-loses-focus-every-keystroke`), because people search for what they see, not for the fix.

### Frontmatter

```yaml
---
title: "An input loses focus after every keystroke"   # the symptom, 20–80 chars, sentence case
description: "…"            # 80–170 chars: what goes wrong and what fixes it (the meta description)
skill: react-reconciliation # the skill that teaches the fix
kind: bug                   # bug | performance | maintainability
symptom: "…"                # one sentence each, shown in the diagnosis card
cause: "…"
fix: "…"
tags: [keys, remounts, focus]   # 3–6, lowercase except API names
react: "18 and 19"          # or "All versions", "19.2+"
order: 1                    # position within the skill
source: skills/react-reconciliation/examples/components-defined-in-render.md
published: 2026-10-01
related: [index-keys-mix-up-row-state, form-keeps-previous-items-text]   # 2–3 slugs
featured: false             # true to list it on the home page
---
```

### Body

The layout renders the title (as the only `<h1>`), the description, badges and the diagnosis card, so start the body with the scenario. Use these sections, in this order:

1. **Intro** (no heading): two or three short paragraphs that set up a realistic scenario.
2. `## Reproduce it`: the live demo and what to try, if the page has one.
3. `## Why it happens`: the issue code (a `bad` block) and the mental model that explains it.
4. `## The fix`: the fixed code (a `good` block), then what changed.
5. `## Why the fix works`: the rule behind it, and alternatives that aren't needed.
6. `## How to confirm the fix`: concrete steps (React DevTools, Performance panel, a test).
7. Optional: `## How to spot this in review`, `## Watch out for`, `## When this isn't enough`, `## Common questions` (with `###` questions).

Use `##` for sections and `###` inside them. Write about 700–1,300 words.

### Code blocks

````md
```tsx title="OrderPage.tsx" bad error="2,9"
…the code with the issue…
```

```tsx title="OrderPage.tsx" good add="6,12-13"
…the fixed code…
```
````

- `bad` and `good` label the block **Issue** or **Fix**, and `title` names the file.
- Mark lines with fence meta: `mark="3"`, `add="5-7"`, `del="2"`, `error="4"`, `warn="8"`. Ranges are 1-based.
- On JavaScript lines, an inline comment works too: `// [!code ++]`, `// [!code --]`, `// [!code error]`, `// [!code highlight]`.
- Don't use JSX-comment notation (`{/* [!code ++] */}`): it leaves stray braces, so the build rejects it.
- Lines marked `del` are left out when a reader presses **Copy**.

### Components

These are available in every fix without an import:

- `<Callout type="note | tip | warn | danger" title="…">…</Callout>`
- `<Compare>…a bad block and a good block…</Compare>` shows the blocks as tabs.
- `<FixLink slug="…" />` and `<SkillLink name="react-effects" />` for links inside the site. Don't write Markdown links to site pages, because they'd miss the base path.

Demos need an import and a client directive:

```mdx
import IndexKeysDemo from '@/components/demos/IndexKeysDemo';

<IndexKeysDemo client:visible />
```

### MDX gotchas

- `{`, `}` and `<` in prose start JSX, so put code in backticks.
- Use `{/* comment */}`, not `<!-- -->`.
- Leave a blank line before and after a JSX element that contains Markdown.

### Style

- Plain, direct, second person. Short paragraphs, concrete numbers, sentence-case headings.
- Explain with the mental model (state change → re-render → subtree; identity is type + position + key; and so on) so readers can apply it elsewhere.
- Name React versions when an API is version-specific (`useEffectEvent` and `<Activity>` need 19.2+).
- No hype, emoji, "simply", "just" or "obviously".

## Writing a skill page

`src/content/skills/<skill-id>.md` holds the site copy for one skill. The name and description shown alongside it come from the skill's own `SKILL.md`.

```yaml
---
title: Re-renders            # short display name
headline: "…"                # one-line promise
description: "…"             # 80–170 chars, the meta description
group: rendering             # core | rendering | state | ui | data | speed
rules: ["…", "…"]            # 3–8 rules worth remembering
prompts: ["…", "…"]          # 2–5 things you might say to Claude that load the skill
---
Three short paragraphs: what the skill teaches Claude, and how it changes what Claude does.
```

## Writing a demo

Demos are React components in `src/components/demos/<Name>.tsx` with a default export. Build them from the kit in `kit.tsx`:

- `DemoShell` frames the demo with an **issue / fix** switch and a **Reset** button. It remounts its children whenever either is used.
- `Tracked` draws a component box that flashes and counts each time it re-renders. Pass `cost` to simulate render work.
- `burn(ms)` simulates expensive work. `useWorkMeter()` and `Meter` show how long an interaction kept the main thread busy.
- `demo.css` has classes for rows, inputs, buttons, meters, logs and timelines.

Rules:

- Show **real React behavior**. Simulate only what's outside React, such as network latency or a slow computation.
- One idea per demo. Keep it small and deterministic.
- Clean up timers and listeners, keep it keyboard-accessible, and respect `prefers-reduced-motion`.
- Keep it SSR-safe: don't touch `window` during render, because Astro renders islands on the server first.
- No new dependencies.

## SEO

Every page gets a unique title and description, a canonical URL, Open Graph and Twitter tags with a generated 1200×630 image, and JSON-LD:

- `TechArticle` and `BreadcrumbList` on fixes.
- `ItemList` on listings.
- `SoftwareSourceCode` on utilities.

The build also produces `sitemap-index.xml`, `robots.txt`, `rss.xml` and a web manifest. Headings follow one `<h1>` per page, and internal links use descriptive text.

# React Best Practices: Skills for Claude

Ten Agent Skills that teach Claude to write, review and debug React the way experienced React engineers do. They cover re-render performance, memoization, component identity, API design, context, refs and closures, overlays, data fetching and error handling.

The skills are tuned to React 18 and 19, including React 19.2 and React Compiler, and work with any framework: Next.js, Vite, Remix, React Router, or React Native (except the DOM-specific parts).

## What's inside

| Skill | Claude uses it when you… |
|---|---|
| `react-best-practices` | write, review or debug any React code. It's the entry point, with the core mental model, a symptom-to-fix map, defaults for new code and a review checklist, and it routes to the skills below. |
| `react-rerenders` | report a slow or laggy screen, ask why something re-renders, or are about to reach for `memo` |
| `react-memoization` | add or review `memo`/`useMemo`/`useCallback`, see a memoized component still re-render, or use React Compiler |
| `react-reconciliation` | see state leak between items, inputs losing focus, list-key bugs, remounts, or need to reset state on purpose |
| `react-composition` | design reusable components (slots, render props, compound components, HOCs, hooks) |
| `react-context` | create or review context providers, fight context re-renders, or choose a state store |
| `react-refs-closures` | work with refs and imperative APIs, hit stale closures, or debounce/throttle handlers |
| `react-layout-portals` | fix flicker after mount, measure the DOM, or build modals, tooltips and dropdowns (z-index, clipping) |
| `react-data-fetching` | fetch data, fix request waterfalls or race conditions, or design loading states |
| `react-error-handling` | add error boundaries, handle async and event-handler errors, or set up reporting |

Each skill follows the same layout:

```
skills/<skill-name>/
├── SKILL.md       # the rules, loaded when the skill triggers (kept lean)
├── examples/      # worked before/after scenarios, loaded only when relevant
├── references/    # deeper material (checklists, cheat sheets), loaded on demand
└── assets/        # ready-to-copy, tested code (refs-closures, error-handling)
```

Claude reads `SKILL.md` first and opens an example or reference only when the task needs it, so every file stays out of the context window until it's useful.

### Bundled, tested utilities

| File | What it gives you |
|---|---|
| `skills/react-refs-closures/assets/use-latest-callback.ts` | A stable function that always calls the latest callback |
| `skills/react-refs-closures/assets/use-debounced-callback.ts` | A debounce that survives re-renders, with `cancel`/`flush`/`isPending` and optional flush on unmount |
| `skills/react-refs-closures/assets/use-throttled-callback.ts` | A leading + trailing throttle with the same guarantees |
| `skills/react-error-handling/assets/error-boundary.tsx` | `ErrorBoundary` (`fallback`, `fallbackRender`, `onError`, `onReset`, `resetKeys`) and `useThrowToBoundary()` |

They're dependency-free, typed, tested against React 18 and React 19, and clean under the React Compiler lint rules (see [Maintaining](#maintaining)).

## Install

### Claude Code (recommended): as a plugin

This repository is both a plugin and a plugin marketplace. In Claude Code, run:

```
/plugin marketplace add jaypatel1210/react-best-practices
/plugin install react-best-practices@react-best-practices
```

Skills appear namespaced, for example `react-best-practices:react-rerenders`. Update later with `/plugin update react-best-practices`.

To try a local checkout instead, pass its path: `/plugin marketplace add ./path/to/react-best-practices`.

### Claude Code: copy the skills

Copy any or all folders from `skills/` into:

- `~/.claude/skills/` to use them in every project, or
- `<project>/.claude/skills/` to share them with a team through the project repository.

Each skill works on its own. The entry skill references the others by name and still works without them.

### Claude apps and the API

Each folder under `skills/` is a standard Agent Skill (a `SKILL.md` with YAML frontmatter plus resources). Zip a skill folder and upload it where your Claude plan allows custom skills, or attach it through the Skills API.

## Using it

There's nothing to invoke. Work normally, and Claude loads the relevant skill from its description. For example:

- "Typing in the search box on the dashboard is laggy, can you fix it?"
- "Review `OrdersTable.tsx` before I merge."
- "Add a 300 ms debounce to this search input; it also sometimes shows results for an old query."
- "Our modal shows up under the sticky header even with `z-index: 9999`."
- "Should I wrap this handler in `useCallback`?"

To force a skill, name it: "use the react-memoization skill to review this component".

## Maintaining

The tooling uses [Bun](https://bun.sh) as its package manager and script runner. The skills themselves have no runtime dependencies.

```bash
bun install
bun run typecheck   # type-check assets and tests
bun run lint        # React Hooks + React Compiler lint rules on the assets
bun run test        # run the asset test suite (Vitest + Testing Library, jsdom)
bun run check       # all three
bun run validate    # validate the plugin and marketplace manifests (needs the Claude Code CLI)
```

Use `bun run test`, not `bun test`: `bun test` starts Bun's built-in test runner instead of Vitest.

- **Test prompts** for measuring skill quality are in `evals/evals.json`, with fixture files in `evals/files/`. Run them with and without the plugin, and compare the outputs against the listed expectations.
- **Keep `SKILL.md` files lean** (about 2,000 words at most). Put long material in `examples/` or `references/`, and reference it from `SKILL.md` with a note about when to read it.
- **Frontmatter rules:** `name` in kebab-case (64 characters or fewer); `description` under 1,024 characters, with no angle brackets, stating both what the skill does and when to use it.
- **Bump `version`** in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` for every release, so installed copies can update.
- **Any change to an asset needs a test** in `tests/`.

Issues and pull requests are welcome at [github.com/jaypatel1210/react-best-practices](https://github.com/jaypatel1210/react-best-practices).

## License

[MIT](LICENSE) © 2026 Jay Patel. You can use, copy, modify and redistribute these skills and the bundled code, including commercially, as long as the copyright notice and license text are kept.

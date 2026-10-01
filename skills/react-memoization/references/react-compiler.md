# React Compiler and Manual Memoization

React Compiler is a build-time tool that automatically memoizes components and hooks. It analyzes each component and caches JSX, computed values and callbacks at a granular level, including cases that are awkward to memoize by hand, such as values computed after an early return. When it's enabled, most hand-written `memo`, `useMemo` and `useCallback` becomes unnecessary.

## Contents

1. [Detecting it in a project](#detecting-it-in-a-project)
2. [How it changes the rules](#how-it-changes-the-rules)
3. [Directives](#directives)
4. [Why a component is not compiled](#why-a-component-is-not-compiled)
5. [Adopting it incrementally](#adopting-it-incrementally)
6. [What stays true with or without the compiler](#what-stays-true-with-or-without-the-compiler)

## Detecting it in a project

Check for any of:

- `babel-plugin-react-compiler` in `devDependencies`.
- Next.js: `reactCompiler: true` (or an options object) in `next.config.*`.
- Vite: `babel-plugin-react-compiler` in the `@vitejs/plugin-react` Babel plugins list.
- Other bundlers: the compiler plugin in the Babel config, or a bundler-specific integration.
- `react-compiler-runtime` in dependencies, which is used when targeting React versions before 19.
- React DevTools shows a "Memo ✨" badge next to compiled components.

## How it changes the rules

| Situation | Without the compiler | With the compiler |
|---|---|---|
| New component code | Memoize only for the reasons in `SKILL.md` | Write plain code; don't add `memo`/`useMemo`/`useCallback` |
| Existing manual memoization | Keep if justified, remove if noise | Leave it by default; removing it can change the compiled output, so test if you do |
| Need a guaranteed-stable reference (e.g., effect deps) | `useMemo`/`useCallback` | The compiler usually handles it; manual memo is still allowed as an explicit escape hatch |
| JSX children breaking `memo` | Must memoize the element manually | Handled automatically in compiled components |
| Composition fixes (moving state down, children as props) | Primary tool | Still valuable: they reduce work the compiler can't remove, like a state update in a parent re-rendering children that depend on it |
| Context re-render rules | Apply | Still apply: the compiler doesn't change context semantics |
| Stale closures, missing deps | Apply | Still apply to effects and to how you write them |

The compiler removes the *bookkeeping* of memoization. It doesn't change *what React re-renders when state changes*. State placement, context design, keys and effects remain your responsibility.

### How compiled code skips work

- **It doesn't wrap components in `memo`.** A compiled parent caches the JSX elements it returns, and React skips a child whose element is the same object as last time. So a compiled child under an *uncompiled* parent (a library, a file with `"use no memo"`, a component the compiler skipped) still re-renders whenever that parent does; its internal caches only make the render cheaper.
- **Caches live per component instance**, inside components and hooks only. A plain helper function called from several components isn't cached, and nothing is shared between instances. An expensive pure function used in many places still needs its own cache (a selector, a module-level memo, or a transform when the data arrives).
- **It removes redundant work, not necessary work.** When inputs really change, the work still runs: long lists still need virtualization (`react-large-lists`), and heavy computations still need deferring or a worker (`react-responsiveness`).

## Directives

- `"use no memo"` at the top of a component or hook body opts that function out of compilation. It's an escape hatch for debugging or for code that misbehaves when compiled. Leave a comment explaining why, and plan to remove it.
- `"use memo"` opts a function *in* when the compiler runs in an opt-in (annotation) compilation mode.

Directives are strings, and they must be the first statement in the function body.

## Why a component is not compiled

The compiler skips functions it can't prove safe. Common causes:

- **Mutating props, state, or values captured from render**, for example `props.items.push(x)` or `state.count++`.
- **Reading or writing `ref.current` during render.** Access refs in effects and event handlers.
- **Side effects during render**: subscriptions, logging, writing to module variables.
- **Conditional hook calls**, or other Rules of Hooks violations.
- **Dynamic patterns it can't analyze**, such as certain kinds of `eval`-like or proxy-heavy code.

`eslint-plugin-react-hooks` 7+ ships compiler-derived rules in its `recommended` configuration:

- `purity`, `refs` and `immutability`: side effects, ref access and mutation during render;
- `set-state-in-render` and `set-state-in-effect`;
- `static-components`: components created during render;
- `preserve-manual-memoization`, `use-memo`, `incompatible-library` and others.

In 6.x they were only in `recommended-latest`. Enable them in compiled projects, and they're worth enabling even without the compiler. Fixing a reported violation usually makes the component both compilable and more correct.

## Adopting it incrementally

When the user asks to adopt the compiler:

1. **Fix Rules of React violations first**, using the lint rules.
2. **Enable it for a directory or in annotation mode** (`compilationMode: 'annotation'` compiles only functions marked `"use memo"`; the default mode infers components and hooks from their names), verify, then expand.
   - In a Babel pipeline, the compiler plugin must run **first**, before other plugins transform the code it analyzes.
   - Pin the compiler version and upgrade deliberately, with tests: a new release can change what gets memoized.
3. **Watch for behavior changes** in code that accidentally depended on re-renders: effects that ran "every render" because a dependency was unstable may now run only when inputs actually change. That's usually the intended behavior, but test flows that relied on the old timing.
4. **Leave existing `useMemo`/`useCallback` in place** at first; remove them in follow-up changes with tests.
5. **Verify what compiled.** A passing build proves nothing, because the compiler skips functions silently. Use the plugin's `logger` option to see per-function successes and bail-outs, and `panicThreshold` to make CI fail on errors. In built output, compiled functions import `c` from `react/compiler-runtime` and begin by allocating a cache array with it. Searching a dependency's files for that import also tells you whether it ships precompiled code.

## What stays true with or without the compiler

- A state change re-renders the owning component; what it renders depends on that state.
- Every context consumer re-renders when the provider value changes identity.
- `key` and component type determine identity; components defined inside components remount.
- Closures capture the values of the render that created them.
- Data fetching needs cleanup, error handling and parallelism.

The other skills in this suite apply fully in compiled projects.

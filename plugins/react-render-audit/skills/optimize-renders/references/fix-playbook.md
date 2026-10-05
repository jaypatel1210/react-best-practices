# Fix playbook

Each hotspot `analyze` reports has a `kind`, a `fix in` location, a safety class, and the render time a fix would save in a slow step. Work only on the ones marked worth fixing: a hotspot that saves less than a frame where users wait isn't worth a change, however many renders it shows. This file maps every kind to the rule in the react-* skills, the usual fix, how to keep the page behaving exactly the same, and what tends to go wrong. Read the named skill for the full reasoning and more examples.

The compare step checks visible text, the accessibility tree, the DOM, data requests and console errors after every scenario step. Write fixes that leave all five identical. The per-fix proof then decides whether the fix stays: the slow step it targets must get faster by at least a frame.

## Contents

1. [cascade: a state update re-renders components that don't use it](#cascade)
2. [cascade from the viewport: resize or scroll state held high up](#viewport)
3. [memo-broken: memo defeated by unstable props](#memo-broken)
4. [context-value: a new provider value every render](#context-value)
5. [component-in-render: a new component type every render](#component-in-render)
6. [remount: unstable keys or tree shape](#remount)
7. [effect-cascade: state copied in an effect](#effect-cascade)
8. [heavy-render: an expensive render that really has to happen](#heavy-render)
9. [large-list, continuous, compiler-skipped](#others)
10. [Before you keep a fix](#checklist)

<a id="cascade"></a>
## 1. cascade (`auto`) — `react-rerenders`

**Evidence:** one component's state hook (`useState #2 ("a" → "ab")`) changes and re-renders many components with unchanged props.

**Fix, in order of preference:**

1. **Move the state down.** Extract the state and only the elements that read it into a new component, at the same position in the JSX. Event handlers that use the state move with it.
2. **Pass the rest as children.** When the state must wrap heavy content (a scroll area, a resizable panel), make the stateful component accept that content as `children` or element props, so the parent creates it and it keeps its identity.
3. **Keep the committed value up, the draft value down.** When other parts need the value only on submit or blur, keep the per-keystroke draft in the small component and lift only the committed value.

**Keep behavior identical:**

- Return a fragment from the extracted component, so no wrapper element appears in the DOM.
- Keep the element order and the props they had (`className`, `aria-*`, ids).
- Preserve resets: if the parent used to clear the state (after submit, on a prop change), the new component needs the same trigger. Pass a `key`, or call back.
- If something outside also read the state (a "clear" button, a heading showing the count), it still needs it. Lift a narrower piece, or use a small context or store with a selector (`react-context`).

**Pitfalls:** moving state into a component that's conditionally rendered resets it when it unmounts. Check that the new component lives at least as long as the old state did.

<a id="viewport"></a>
## 2. cascade from the viewport (`auto`) — `react-rerenders` (hooks that hide state)

**Evidence:** the triggering step is `resize` or `scroll`, and the changed state is a number (`useState #3 (1280 → 1000)`).

**Fix:** store the coarse value the UI actually uses. A `useWindowSize()` used for `width < 900` becomes a `useMediaQuery('(max-width: 899px)')` built on `useSyncExternalStore` and `matchMedia`, which re-renders only when the breakpoint flips. If only one leaf needs the value, call the hook there instead of in the page.

**Keep behavior identical:** match the breakpoint exactly. `width < 900` means `(max-width: 899px)` for integer widths. For server rendering, `getServerSnapshot` must return what the server rendered before (often `false`), or hydration will differ.

**Pitfalls:** scroll positions used for effects (sticky headers, progress bars) usually need refs and `requestAnimationFrame` rather than state (`react-animation`, `react-responsiveness`); that's an `ask` change.

<a id="memo-broken"></a>
## 3. memo-broken (`auto`) — `react-memoization`

**Evidence:** a `memo` component re-renders with reason `propsUnstable`, listing the props: `onAdd (new function ×24)`, `style (new object with the same content ×24)`, `icon (new JSX element)`. `fix in` points at the component that creates those props.

**Fix, per prop kind:**

- **New function:** wrap it in `useCallback` with complete dependencies. Use a functional state update (`setItems((items) => [...items, id])`) to keep the dependency list empty. For per-item handlers, pass a stable callback plus the id (`onAdd={add}`, and the child calls `onAdd(product.id)`) instead of creating `() => add(product.id)` per row. When the callback must read fresh props, use the latest-ref pattern (`react-refs-closures`).
- **New object or array with the same content:** hoist constants to module scope; `useMemo` values derived from props or state. Default parameters like `items = []` need a module-level constant.
- **New JSX element:** create the element once in a parent that doesn't re-render, or `useMemo` it, or pass the data and let the child render it.

**Keep behavior identical:** dependencies must be complete. `react-hooks/exhaustive-deps` must pass with no new disables, otherwise you've created a stale closure that the scenario might not exercise.

**Pitfalls:** if the component is wrapped in `memo` but also reads a context that changes, stabilizing props won't stop those renders. Check `contexts` in the analysis. With React Compiler on, don't add hooks by hand; find out why the compiler skipped the parent.

<a id="context-value"></a>
## 4. context-value (`auto`) — `react-context`

**Evidence:** consumers re-render with `contextUnstable`: the provider's value was a new object with the same content.

**Fix:** in the provider, build the value with `useMemo` and its functions with `useCallback`, so the value changes only when its content does. If many consumers only call actions and the state changes often, split state and actions into two contexts. That changes the context API, so ask first.

**Keep behavior identical:** every field the old value had must still be there with the same meaning. Use functional updates inside the callbacks so they don't read stale state.

<a id="component-in-render"></a>
## 5. component-in-render (`auto`) — `react-reconciliation`

**Evidence:** `identityChurn`: a component with the same name gets a new type on every render of its parent, so it unmounts and mounts each time (state, DOM and focus are lost).

**Fix:** move the component definition (or the `styled()`/HOC call that creates it) to module scope. Pass whatever it closed over (props, state, callbacks) as props.

**Keep behavior identical:** the DOM output must be the same. The difference users notice is that internal state and focus now survive the parent's renders, which is the bug being fixed. If the old code relied on the reset (rare: a form that cleared itself), keep that explicitly with a `key`.

<a id="remount"></a>
## 6. remount (`ask`) — `react-reconciliation`

**Evidence:** `remounts`: the same component type unmounted and mounted again in one commit.

**Usual causes:** keys that change between renders (`key={Math.random()}`, keys that include the index of a sorted list, keys built from changing data), or a conditional wrapper (`cond ? <Wrapper><Editor/></Wrapper> : <Editor/>`).

**Fix:** use stable ids from the data; keep the tree shape stable by toggling props or styles instead of swapping wrappers. Ask first: it changes which state survives, which is often the point, but it is a behavior change.

<a id="effect-cascade"></a>
## 7. effect-cascade (`auto`) — `react-effects`

**Evidence:** a component sets state in an effect right after rendering, so every change costs an extra commit (`cascades`).

**Fix:**

- A value derived from props or state: compute it during render (`useMemo` only if it's measurably expensive).
- State that must reset when an identity changes (a different user or item): give the component a `key`.
- State that adjusts when a prop changes: store the previous prop and adjust during render, or restructure so the parent owns it.
- Logic that belongs to an event ("after adding, show a toast"): move it into the event handler.

**Keep behavior identical:** the first render must show what the old code showed after its effect ran. Check that the initial value matches, including on the server.

**Pitfalls:** keep effects that synchronize with something outside React (subscriptions, the DOM, timers, network). Those aren't cascades to remove.

<a id="heavy-render"></a>
## 8. heavy-render (`ask`) — `react-responsiveness`

**Evidence:** a component takes more than 16 ms per render (development build) during an interaction, and its renders are legitimate (props or state really changed).

**Fix options:** `useDeferredValue` for the value the heavy part reads, with that part wrapped in `memo` so React can skip or interrupt it; `startTransition` around the non-urgent update; `useMemo` around a costly computation; chunking long loops. Ask first: deferral changes what users see in between (the old results stay visible briefly), and the compare step may flag those intermediate states. Deferral adds a render, so compare shows more render work; the per-fix proof decides.

<a id="others"></a>
## 9. large-list (`suggest`), continuous (`ask`), compiler-skipped (`auto`)

- **large-list** (`react-large-lists`): hundreds of rows render together. Virtualization or pagination changes the DOM (off-screen rows disappear), so never apply it in this loop. Record it as `proposed` with the numbers. If most row renders are wasted, fixing their props (memo-broken) is a safe first step.
- **continuous** (`react-rerenders`, `react-animation`): renders keep happening with no input (a clock, polling, an animation in state). Moving that state into the leaf that displays it is usually safe, but ask: timers interact with the scenario's timing.
- **compiler-skipped** (`react-memoization`, `references/react-compiler.md`): React Compiler compiled other components but not this one. Run the React Compiler lint rules on the file and fix what they report (mutating props or state during render, reading `ref.current` during render, conditional hooks).

<a id="checklist"></a>
## 10. Before you keep a fix

- [ ] The change is the smallest one that removes the measured cause, in the file `analyze` pointed to.
- [ ] No new `eslint-disable`, `@ts-ignore` or `any`; exhaustive-deps passes.
- [ ] Type check, lint (changed files) and related tests pass.
- [ ] `compare` says PASS: behavior identical at every step.
- [ ] The per-fix proof (`ra bench --quick`) exited 0: a slow step got faster by at least a frame, and nothing got slower.
- [ ] Only your files are staged; the commit message names the hotspot and the proof's numbers.
- [ ] The change log has the entry, with `--proof` (`ra changes add`).

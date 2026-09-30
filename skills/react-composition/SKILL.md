---
name: react-composition
description: Design flexible, readable React component APIs with composition, meaning children, elements as props (slots), render props, cloneElement, compound components, higher-order components and custom hooks, and when each is the right tool. Use when building or refactoring reusable components (buttons, dialogs, cards, layouts, form fields, tables, design-system primitives), when a component is piling up configuration props like iconName, iconColor or showFooter, when sharing stateful or DOM-bound logic between components, or when modernizing legacy HOCs and render props.
license: MIT
---

# React Composition: Designing Component APIs

Good component APIs let the consumer decide *what* to render and let the component decide *where and how*. Composition keeps components small, avoids configuration-prop explosions, and, as a bonus, often improves performance (see `react-rerenders`).

## Choose the pattern

| The component needs to… | Use |
|---|---|
| Place arbitrary content in one main area | `children` |
| Place content in several named regions (header, footer, actions, icon, empty state) | Element props ("slots"): `footer={<Actions />}` |
| Give the slot content data or state it owns (hover, open, selected, computed sizes) | Render prop: `renderItem={(item, state) => …}` |
| Share defaults (size, color) with slot content | Render prop that passes props; or context for a whole family of parts |
| Coordinate several parts that share implicit state (`Tabs`, `Tabs.List`, `Tabs.Panel`) | Compound components backed by context |
| Reuse stateful logic without UI | A custom hook |
| Reuse logic bound to a DOM element the component renders (a scroll container, a measured box) | A hook returning a ref or callback ref, or a render-prop component |
| Add cross-cutting behavior around arbitrary components (click analytics, impression tracking, permission gates, keyboard shielding) | A wrapper component, or a higher-order component (HOC) |

## Slots: elements as props

Replace configuration props that only forward to an inner element with a prop that takes the element itself:

```tsx
// Before: every icon variation needs a new prop
<Button iconName="upload" iconPosition="left" iconColor="white" iconSize={16}>Upload</Button>

// After: the consumer configures the icon however it likes
<Button startIcon={<UploadIcon />}>Upload</Button>

function Button({ startIcon, endIcon, children, ...rest }: ButtonProps) {
  return (
    <button {...rest}>
      {startIcon && <span className="button__icon">{startIcon}</span>}
      <span>{children}</span>
      {endIcon && <span className="button__icon">{endIcon}</span>}
    </button>
  );
}
```

Facts that make slots safe and cheap:

- **Creating an element is almost free** and does not render it. `footer={<Footer />}` passed to a closed dialog never renders `Footer` until the dialog renders it. Conditional rendering stays conditional, which is why route configs like `element={<Page />}` are fine.
- **Slot elements keep their identity** when the receiving component re-renders from its own state, so React skips them. That's the "wrap, don't own" optimization.
- **Use `children` for the primary content** and named props for secondary regions. Nested JSX is just the `children` prop.

When a design system needs strict control, use typed, constrained slots (`icon?: React.ReactElement<IconProps>`) or keep a small enum prop. Slots trade control for flexibility, so choose deliberately.

## Defaults for slot content

A button that wants its icon sized to match has three options, in order of preference:

1. **CSS**: size and color the icon from the button's styles (`.button--large .button__icon svg { width: 20px }`, or `currentColor`). No React API needed.
2. **A render prop** that passes defaults explicitly: `renderIcon={(p) => <UploadIcon {...p} />}`. The data flow is visible and the consumer can override or map props (`fontSize={p.size}`).
3. **`cloneElement`**, only for simple, well-known children, and always with the caller's props winning:

   ```tsx
   const icon = isValidElement<IconProps>(startIcon)
     ? cloneElement(startIcon, { ...defaultIconProps, ...startIcon.props })
     : startIcon;
   ```

   `cloneElement(startIcon, defaultIconProps)` *overwrites* the caller's props, so `<UploadIcon color="red" />` would stop working inside the button. `cloneElement` also assumes the child accepts those props, breaks with fragments and wrapper components, and hides the data flow. React's documentation lists it among legacy APIs. Prefer options 1 and 2.

## Render props

A render prop is a function the component calls to get elements, passing whatever the consumer needs:

```tsx
<Combobox
  items={users}
  renderItem={(user, { isActive, isSelected }) => (
    <UserRow user={user} highlighted={isActive} checked={isSelected} />
  )}
/>
```

- **Pass state and computed props as arguments.** Everything is explicit; nothing is injected by magic.
- **`children` can be the function**: `<Measure>{({ width }) => <Chart width={width} />}</Measure>`.
- **Mind memoization.** An inline render function is new each render. That only matters if the receiving component is `memo`-wrapped (then use `useCallback`) or lists it as an effect dependency.

## Hooks vs render-prop components

Hooks are the default for sharing stateful logic: less nesting, and the data source is obvious.

```tsx
const { width } = useElementSize(ref);
```

A component with a render prop is still the better tool when:

- **The logic needs a DOM element the provider renders**, such as a scroll or drag container. The component renders the element and owns the listener, so there's no ref plumbing.
- **You want to limit re-renders.** A hook's state re-renders the *calling* component. A render-prop component re-renders only itself and the subtree its render prop returns. For high-frequency values (scroll offset, pointer position), that difference can decide performance.
- **The codebase or a library already uses the pattern** (form libraries, virtualization, headless UI kits). Stay consistent.

## Compound components

Parts that belong together share state through context rather than props:

```tsx
<Tabs defaultValue="activity">
  <Tabs.List>
    <Tabs.Trigger value="activity">Activity</Tabs.Trigger>
    <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="activity"><ActivityFeed /></Tabs.Panel>
  <Tabs.Panel value="settings"><SettingsForm /></Tabs.Panel>
</Tabs>
```

`Tabs` owns the state and provides it. Each part reads only what it needs. Apply the context rules from `react-context`: memoize the provider value, and split state from actions if parts differ in what they read. For accessible primitives (tabs, menus, dialogs, comboboxes), prefer the project's headless library (Radix, React Aria, Headless UI, Ark) over hand-rolled ARIA.

## Higher-order components

A HOC is a function that takes a component and returns a new component rendering it. Hooks replaced most HOC use cases (data injection, context access). HOCs still fit cross-cutting behavior that wraps *any* component without editing it:

- **Intercepting callbacks**, for example logging every `onClick` with analytics context before calling the original handler.
- **Lifecycle side effects**, for example impression tracking on mount, or logging when a specific prop changes.
- **Intercepting DOM events**, for example a wrapper `div` that stops `keydown` from reaching global shortcut listeners while a dialog is open.

Rules for HOCs:

- **Apply them at module scope.** Calling a HOC during render creates a new component type every render, so the subtree remounts (see `react-reconciliation`).
- **Pass all props through, and call the original callback** when you intercept one.
- **Forward refs.** On React 19, `ref` is a regular prop and passes through `{...props}`. On React 18 and below, wrap the inner component with `forwardRef`.
- **Set `displayName`** (`withTracking(Button)`) so React DevTools and error stacks stay readable.
- **Avoid prop-name collisions and deep HOC stacks.** If a component needs three HOCs, a hook or a wrapper component is usually clearer.

## API design checklist

- [ ] The primary content is `children`; secondary regions are named slots.
- [ ] No props exist only to configure an inner element (`iconColor`, `titleClassName`). A slot or a render prop is used instead.
- [ ] Defaults flow through CSS or explicit render-prop arguments, not through `cloneElement` overwrites.
- [ ] Shared logic is a hook unless it's DOM-bound, re-render-sensitive, or cross-cutting.
- [ ] Compound parts share state through a memoized context.
- [ ] HOCs are applied at module scope, pass props and refs through, and have a `displayName`.

## Examples

- `examples/slots-and-defaults.md`: a dialog with slots, and a button icon with defaults done three ways (CSS, render prop, `cloneElement`) with their failure modes.
- `examples/render-props-and-hooks.md`: a scroll-aware container as a render-prop component versus a hook, including the re-render difference.
- `examples/higher-order-components.md`: click analytics, impression tracking and keyboard shielding HOCs done correctly, plus converting a legacy HOC to a hook.

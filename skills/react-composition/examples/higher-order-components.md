# Example: Higher-Order Components That Still Earn Their Place

A higher-order component (HOC) is `(Component) => NewComponent`. Use one when you want to add the *same behavior* to many existing components *without editing them*. For injecting data or context, use hooks instead.

## 1. Intercepting a callback: click analytics

Every clickable thing in a product area should report a click with a name, and keep working normally.

```tsx
type WithClickTrackingProps = { trackingName: string };

export function withClickTracking<P extends { onClick?: (...args: any[]) => void }>(
  Component: React.ComponentType<P>,
) {
  function Tracked({ trackingName, ...props }: P & WithClickTrackingProps) {
    const analytics = useAnalytics(); // hooks are fine: this is a regular component
    const handleClick = (...args: any[]) => {
      analytics.track('click', { name: trackingName });
      props.onClick?.(...args); // always call the original handler
    };
    return <Component {...(props as P)} onClick={handleClick} />;
  }
  Tracked.displayName = `withClickTracking(${Component.displayName || Component.name || 'Component'})`;
  return Tracked;
}

// Module scope: created once
export const TrackedButton = withClickTracking(Button);
export const TrackedMenuItem = withClickTracking(MenuItem);

<TrackedButton trackingName="export-csv" onClick={exportCsv}>Export</TrackedButton>;
```

What makes it correct:

- **The HOC's own prop is stripped** (`trackingName`), and the rest spread through.
- **The original `onClick` is still called**, with the same arguments.
- **It's applied once at module scope.** Calling `withClickTracking(Button)` inside a component would create a new component type per render and remount it (see `react-reconciliation`).
- **`displayName` is set** so DevTools shows `withClickTracking(Button)`.
- **Refs pass through.** On React 19, `ref` is a regular prop, so `{...props}` forwards it. On React 18, wrap `Tracked` in `forwardRef` and pass `ref` explicitly.

## 2. Lifecycle side effect: impression tracking

```tsx
export function withImpression<P extends { id: string }>(Component: React.ComponentType<P>, event: string) {
  function WithImpression(props: P) {
    const analytics = useAnalytics();
    useEffect(() => {
      analytics.track(event, { id: props.id }); // on mount, and whenever the id changes
    }, [analytics, props.id]);
    return <Component {...props} />;
  }
  WithImpression.displayName = `withImpression(${Component.displayName || Component.name || 'Component'})`;
  return WithImpression;
}

export const PromoCardWithImpression = withImpression(PromoCard, 'promo_impression');
```

Static configuration (`event`) goes in the HOC call. Per-use data comes through props.

In development, StrictMode runs effects twice on mount, so expect duplicate events there. For "fire once per id", deduplicate inside the analytics client rather than fighting React.

## 3. Intercepting DOM events: shielding global shortcuts

The app has global keyboard shortcuts (`j`/`k` to navigate, `c` to compose) registered on `window`. Inside dialogs, menus and editors, those keys must not trigger shortcuts.

```tsx
export function withShortcutShield<P extends object>(Component: React.ComponentType<P>) {
  function Shielded(props: P) {
    return (
      // stops keydown from bubbling to the window listener
      <div onKeyDown={(e) => e.stopPropagation()} style={{ display: 'contents' }}>
        <Component {...props} />
      </div>
    );
  }
  Shielded.displayName = `withShortcutShield(${Component.displayName || Component.name || 'Component'})`;
  return Shielded;
}

export const ShieldedCommentEditor = withShortcutShield(CommentEditor);
export const ShieldedFilterMenu = withShortcutShield(FilterMenu);
```

This depends on bubbling order. React listens at the root container, which sits below `window` in the bubble path. So `stopPropagation()` in a React handler also stops the native event before it reaches `window` listeners registered in the default bubble phase. Listeners registered with `{ capture: true }` run first and can't be shielded this way. React handlers on ancestors are skipped too, which is intended here.

If the shielded component renders through a portal, React events still bubble through the React tree, so the shield still applies to its content. See `react-layout-portals`.

A wrapper *component* achieves the same thing and is often clearer:

```tsx
<ShortcutShield><CommentEditor /></ShortcutShield>
```

Prefer the wrapper when call sites can change. Prefer the HOC when you're exporting pre-wrapped components from a shared module.

## Converting a data-injecting HOC to a hook

```tsx
// Legacy
export default withCurrentUser(ProfileMenu); // injects `user` prop from context

// Modern: the data source is visible where it's used
function ProfileMenu() {
  const user = useCurrentUser();
  // ...
}
```

Migrate call sites one at a time. Keep the HOC as a thin shim around the hook until all consumers move:

```tsx
export const withCurrentUser = <P extends { user: User }>(C: React.ComponentType<P>) =>
  function WithCurrentUser(props: Omit<P, 'user'>) {
    const user = useCurrentUser();
    return <C {...(props as P)} user={user} />;
  };
```

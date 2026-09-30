# Example: Slots and Defaults

## A dialog that stopped growing props

### Before

```tsx
<ConfirmDialog
  title="Delete project?"
  message="This cannot be undone."
  confirmLabel="Delete"
  confirmVariant="danger"
  showCancel
  cancelLabel="Keep project"
  showCheckbox
  checkboxLabel="Also delete backups"
  onConfirm={deleteProject}
  onCancel={close}
/>
```

Every new requirement ("a link in the footer", "two confirm buttons", "an illustration") adds props, and the component's internals turn into a tangle of conditionals.

### After

```tsx
type DialogProps = {
  title: React.ReactNode;
  children: React.ReactNode;       // body
  actions?: React.ReactNode;       // footer slot
  illustration?: React.ReactNode;  // optional media slot
  onClose: () => void;
};

function Dialog({ title, children, actions, illustration, onClose }: DialogProps) {
  return (
    <DialogShell onClose={onClose}>
      {illustration && <div className="dialog__media">{illustration}</div>}
      <h2 className="dialog__title">{title}</h2>
      <div className="dialog__body">{children}</div>
      {actions && <div className="dialog__actions">{actions}</div>}
    </DialogShell>
  );
}

<Dialog
  title="Delete project?"
  onClose={close}
  actions={
    <>
      <Button variant="ghost" onClick={close}>Keep project</Button>
      <Button variant="danger" onClick={deleteProject}>Delete</Button>
    </>
  }
>
  <p>This cannot be undone.</p>
  <Checkbox label="Also delete backups" checked={alsoBackups} onChange={setAlsoBackups} />
</Dialog>
```

The dialog owns layout, spacing, focus management and the close behavior. Consumers own the content. The body is `children` because it's the primary content; the footer is a named slot.

Rendering the dialog conditionally (`{isOpen && <Dialog …/>}`) means none of the slot elements render while it's closed. They are created as objects only when the parent renders, and they cost nothing until `Dialog` places them.

## Defaults for slot content: three approaches

A `Button` wants its icon to match: white on primary buttons, 20px on large ones.

### 1. CSS (preferred when it's only visual)

```tsx
function Button({ appearance = 'primary', size = 'md', startIcon, children, ...rest }: ButtonProps) {
  return (
    <button className={`btn btn--${appearance} btn--${size}`} {...rest}>
      {startIcon && <span className="btn__icon" aria-hidden>{startIcon}</span>}
      {children}
    </button>
  );
}
```

```css
.btn__icon svg { width: 1em; height: 1em; fill: currentColor; } /* follows the button's font size and color */
.btn--lg { font-size: 20px; }
.btn--primary { color: white; }
```

Consumers pass `<UploadIcon />` and it adapts. Explicit overrides (`<UploadIcon color="red" />`) still win when the icon applies them as inline styles or attributes.

### 2. Render prop (when the component must pass values or state)

```tsx
type IconSlotProps = { size: number; color: string; isHovered: boolean };

function Button({ appearance = 'primary', size = 'md', renderIcon, children, ...rest }: {
  appearance?: 'primary' | 'secondary';
  size?: 'md' | 'lg';
  renderIcon?: (p: IconSlotProps) => React.ReactNode;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [isHovered, setIsHovered] = useState(false);
  const iconProps: IconSlotProps = {
    size: size === 'lg' ? 20 : 16,
    color: appearance === 'primary' ? 'white' : 'currentColor',
    isHovered,
  };
  return (
    <button onPointerEnter={() => setIsHovered(true)} onPointerLeave={() => setIsHovered(false)} {...rest}>
      {renderIcon?.(iconProps)}
      {children}
    </button>
  );
}

// Consumers choose what to do with the values:
<Button renderIcon={(p) => <UploadIcon size={p.size} color={p.color} />}>Upload</Button>
<Button renderIcon={({ size, isHovered }) => <Heart filled={isHovered} fontSize={size} />}>Like</Button> // a different icon API
```

Everything is visible at the call site, and consumers can map the values onto any icon library's API.

### 3. `cloneElement` (simple cases only)

```tsx
function Button({ appearance = 'primary', size = 'md', startIcon, children }: ButtonProps) {
  const defaults = { size: size === 'lg' ? 20 : 16, color: appearance === 'primary' ? 'white' : 'black' };
  const icon = isValidElement<IconProps>(startIcon)
    ? cloneElement(startIcon, { ...defaults, ...startIcon.props }) // caller's props win
    : startIcon;
  return <button>{icon}{children}</button>;
}
```

Failure modes to know:

- `cloneElement(startIcon, defaults)` (defaults last) silently overrides `<UploadIcon color="red" />`. The icon works everywhere except inside this button, and nobody can tell why.
- If the consumer wraps the icon (`<Tooltip><UploadIcon /></Tooltip>`) or passes a fragment, the defaults land on the wrapper, not the icon.
- If the icon component doesn't accept `size` or `color`, the defaults do nothing, or they leak onto the DOM as invalid attributes.

Use it only when the slot's element type is known and controlled, for example icons from your own design system.

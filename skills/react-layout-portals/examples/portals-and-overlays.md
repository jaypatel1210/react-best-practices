# Example: Overlays, the Stacking-Context Trap and Portals

## The trap in a realistic layout

```tsx
function AppFrame({ children }: { children: React.ReactNode }) {
  const [isNavOpen, setIsNavOpen] = useState(true);
  return (
    <>
      <header className="topbar" />                         {/* position: sticky; top: 0; z-index: 10 */}
      <aside className="nav" style={{ transform: `translateX(${isNavOpen ? 0 : -240}px)` }} />
      <main className="content" style={{ transform: `translateX(${isNavOpen ? 0 : -240}px)` }}>
        {children}                                          {/* .content also has overflow: auto */}
      </main>
    </>
  );
}

function ExportButton() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button onClick={() => setIsOpen(true)}>Export</button>
      {isOpen && <ExportModal onClose={() => setIsOpen(false)} />} {/* .modal: position: fixed; inset: 0; z-index: 9999 */}
    </>
  );
}
```

`ExportButton` lives somewhere inside `<main>`. The modal:

- **isn't centered on screen**: `main` has a `transform`, so it becomes the containing block for `position: fixed` descendants, and the modal is positioned and sized relative to `main`;
- **is clipped** by `main`'s `overflow: auto`, because its containing block is `main` itself;
- **renders under the sticky header** when scrolled: `main`'s transform creates a stacking context with `z-index: auto` (level 0), below the header's `z-index: 10`. The modal's `9999` only competes *inside* `main`.

No `z-index` value can fix this. Removing the `transform` would, until the next animation adds one somewhere else.

## Fix: portal the overlay out

```tsx
import { createPortal } from 'react-dom';

function ExportModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        className="modal"
        onClick={(e) => e.stopPropagation()} // clicks inside don't reach the backdrop (or React ancestors)
      >
        <h2 id="export-title">Export report</h2>
        <ExportForm onDone={onClose} />
      </div>
    </div>,
    document.body,
  );
}
```

The modal's DOM now sits at the end of `<body>`, outside every transformed, clipped or stacked ancestor. It's centered on the viewport and above the header. From React's point of view nothing moved: `ExportModal` is still a child of `ExportButton`, reads the same contexts, and unmounts with it.

## The surprises: React tree versus DOM tree

### 1. Clicks bubble to React ancestors

```tsx
<tr onClick={() => navigate(`/orders/${order.id}`)}>
  <td>
    <RowActionsMenu order={order} /> {/* renders a portaled dropdown */}
  </td>
</tr>
```

Clicking "Archive" in the dropdown also navigates to the order. The dropdown's DOM is in `<body>`, but React synthetic events bubble through the *component* tree, so the row's `onClick` receives the click. Fix it in the overlay root, which protects every consumer:

```tsx
<div className="menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
  {items}
</div>
```

Alternatively, have the row ignore events from outside its own DOM: `if (!e.currentTarget.contains(e.target as Node)) return;`.

### 2. Native listeners and DOM traversal don't see the portal

```tsx
useEffect(() => {
  const onDocPointerDown = (e: PointerEvent) => {
    if (!triggerRef.current?.contains(e.target as Node)) close(); // wrong: menu clicks count as "outside"
  };
  document.addEventListener('pointerdown', onDocPointerDown);
  return () => document.removeEventListener('pointerdown', onDocPointerDown);
}, [close]);
```

The menu's DOM isn't inside the trigger, so clicking a menu item closes the menu before the click lands. Check both nodes:

```tsx
const target = e.target as Node;
if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
```

### 3. Forms don't span the portal

```tsx
<form onSubmit={saveSettings}>
  <SettingsFields />
  <ConfirmDialog>                  {/* portaled */}
    <button type="submit">Save</button> {/* does NOT submit the outer form */}
  </ConfirmDialog>
</form>
```

Form submission is a native DOM behavior: the button isn't a DOM descendant of the `<form>`, so clicking it submits nothing. Put the `<form>` inside the dialog, or call the submit logic explicitly (`onClick={() => formRef.current?.requestSubmit()}`).

### 4. Styles scoped to the original location don't apply

`.settings-page .dialog { … }` no longer matches, and fonts, colors or CSS variables set on `.settings-page` aren't inherited. Style overlays with their own classes, and define design tokens on `:root`, or on the portal container.

## Where to portal to

- `document.body` is fine for most apps.
- A dedicated container (`<div id="overlay-root">` at the end of `body`) makes ordering and styling predictable. Create it in the HTML shell rather than from React, so it exists before hydration.
- Micro-frontends and shadow DOM: portal into the host's designated overlay container, so styles and theming reach it.

## Native alternative: `<dialog>` in the top layer

```tsx
function ConfirmDelete({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal(); // top layer, backdrop, page becomes inert
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="confirm-title">
      <form method="dialog">                      {/* submitting closes the dialog natively */}
        <h2 id="confirm-title">Delete this project?</h2>
        <button value="cancel">Cancel</button>
        <button value="confirm" onClick={onConfirm}>Delete</button>
      </form>
    </dialog>
  );
}
```

A modal `<dialog>` renders above everything regardless of stacking contexts and ancestors' `overflow`, closes on Esc (firing `close`, which calls `onClose`), and keeps its DOM next to its React parent, so the React tree and DOM tree agree. The same goes for `popover` elements for menus and toasts. Check the project's browser-support targets, and remember you still own focus restoration and animations.

## Overlay review questions

1. Where does the overlay's DOM end up? Is any ancestor transformed, filtered, clipped or stacked?
2. Would a click or key press inside it trigger ancestors' React handlers?
3. Does outside-click detection include the overlay's own node?
4. Is any `<form>` split across the portal boundary?
5. Do styles depend on where the trigger lives?
6. Is focus managed (moved in, trapped, restored), and does Esc close it?
7. Is `document` accessed only on the client?

# Example: Refs and Imperative APIs

## Ref or state: quick calls

| Value | Choice | Why |
|---|---|---|
| Text shown in a character counter | State | Rendered |
| Timeout ID for a delayed tooltip | Ref | Never rendered; changing it shouldn't render |
| "Is the pointer down?" during a drag | Ref | Read in handlers only |
| Current drag position used to move an element | State, or a direct style write via a ref for 60fps | Rendered; for high-frequency motion, write `transform` imperatively and avoid React renders |
| The previous `value` prop, for comparison in an effect | Ref updated in an effect | Only read in effects |
| Selected row ID | State | Rendered and passed to children |
| A map or editor instance created by a third-party library | Ref, lazily initialized | Imperative object with its own lifecycle |

## The "shows the wrong number" bug

```tsx
function NoteEditor() {
  const textRef = useRef('');
  const [isPreview, setIsPreview] = useState(false);
  return (
    <>
      <textarea onChange={(e) => (textRef.current = e.target.value)} />
      <p>{textRef.current.length} characters</p> {/* only updates when isPreview toggles */}
      <button onClick={() => setIsPreview((p) => !p)}>Preview</button>
    </>
  );
}
```

The counter shows 0 while typing, then jumps to the right number when an unrelated state change re-renders the component. Rendered values must be state. And passing `textRef.current` as a prop to a child doesn't help: the child receives whatever the value was during the parent's last render.

## Click outside

```tsx
function useClickOutside<T extends HTMLElement>(onOutside: (e: PointerEvent) => void) {
  const ref = useRef<T>(null);
  const handler = useLatestCallback(onOutside); // stable listener that calls the latest handler

  useEffect(() => {
    const listener = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) handler(e);
    };
    document.addEventListener('pointerdown', listener);
    return () => document.removeEventListener('pointerdown', listener);
  }, [handler]);

  return ref;
}

function Popover({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useClickOutside<HTMLDivElement>(onClose);
  return <div ref={ref} className="popover">{children}</div>;
}
```

- The listener is registered once. It reads `onClose` through the latest callback, so it never goes stale, and the effect doesn't re-subscribe on every render just because the parent passed a new inline `onClose`.
- If the popover content is rendered through a portal, `contains` on the anchor won't see it. Check the portal node too, or rely on React-tree events. See `react-layout-portals`.

## A callback ref for measuring an element that may appear later

```tsx
function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return [ref, width] as const;
}

function Toolbar() {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  return <div ref={ref}>{width !== null && width < 480 ? <CompactActions /> : <FullActions />}</div>;
}
```

A `useRef` plus `useEffect(…, [])` would miss elements that mount after the first render (inside a conditional or a lazily loaded panel). A callback ref runs whenever React attaches or detaches the node. Keep it stable with `useCallback`, because a new function identity makes React detach and re-attach the ref on every render. On React 19 the callback can instead return a cleanup function (`return () => observer.disconnect()`).

## An input that can focus itself and flag an error

A sign-up form validates on submit. For an empty required field, it should focus the field and play a short "shake" animation. The form shouldn't know about DOM nodes or CSS classes.

```tsx
export type FieldHandle = { focus: () => void; flagInvalid: () => void };

type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  ref?: React.Ref<FieldHandle>; // React 19: ref is a regular prop
};

export function TextField({ label, ref, ...inputProps }: TextFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFlagged, setIsFlagged] = useState(false);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    flagInvalid: () => setIsFlagged(true),
  }), []);

  return (
    <label className="field">
      {label}
      <input
        ref={inputRef}
        className={isFlagged ? 'field__input field__input--shake' : 'field__input'}
        onAnimationEnd={() => setIsFlagged(false)} // reset so it can play again
        aria-invalid={isFlagged || undefined}
        {...inputProps}
      />
    </label>
  );
}

function SignUpForm() {
  const emailRef = useRef<FieldHandle>(null);
  const [email, setEmail] = useState('');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      emailRef.current?.focus();
      emailRef.current?.flagInvalid();
      return;
    }
    submit({ email });
  };

  return (
    <form onSubmit={onSubmit} noValidate>
      <TextField ref={emailRef} label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button>Create account</button>
    </form>
  );
}
```

On React 18, declare the component with `forwardRef<FieldHandle, Omit<TextFieldProps, 'ref'>>((props, ref) => …)` instead of reading `ref` from props. Everything else stays the same.

Why not a `shouldShake` prop? It would work once, then stay `true`. The parent would need to reset it after the animation, which couples the form to the field's animation timing. An imperative "do this now" command maps naturally to a method.

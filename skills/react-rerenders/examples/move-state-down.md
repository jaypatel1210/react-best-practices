# Example: Moving State Down

## Scenario 1: an input at page level

An order page lets support agents type a coupon code and see whether it's valid. The page also renders a long order timeline and an invoice preview that takes ~40 ms to render. Typing feels sticky.

### Before

```tsx
function OrderPage({ order }: { order: Order }) {
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const isValidFormat = /^[A-Z0-9]{6,12}$/.test(coupon);

  return (
    <div className="order-page">
      <section>
        <input
          value={coupon}
          onChange={(e) => setCoupon(e.target.value.toUpperCase())}
          aria-invalid={!isValidFormat}
        />
        <button disabled={!isValidFormat} onClick={() => setAppliedCoupon(coupon)}>
          Apply
        </button>
      </section>

      <OrderTimeline events={order.events} />
      <InvoicePreview order={order} coupon={appliedCoupon} />
    </div>
  );
}
```

Every keystroke calls `setCoupon`. `OrderPage` re-renders, so `OrderTimeline` and `InvoicePreview` re-render too, even though neither reads `coupon`.

### After

Split the state by *how often it changes*. The draft changes on every keystroke and only the field needs it. The applied coupon changes rarely and the invoice needs it.

```tsx
function OrderPage({ order }: { order: Order }) {
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);

  return (
    <div className="order-page">
      <CouponField onApply={setAppliedCoupon} />
      <OrderTimeline events={order.events} />
      <InvoicePreview order={order} coupon={appliedCoupon} />
    </div>
  );
}

function CouponField({ onApply }: { onApply: (code: string) => void }) {
  const [draft, setDraft] = useState('');
  const isValidFormat = /^[A-Z0-9]{6,12}$/.test(draft);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (isValidFormat) onApply(draft);
      }}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        aria-invalid={!isValidFormat}
      />
      <button disabled={!isValidFormat}>Apply</button>
    </form>
  );
}
```

Typing now re-renders only `CouponField`. The heavy components re-render only when a coupon is actually applied, and that update is one they need.

No `memo`, `useCallback` or `useMemo` was needed. `onApply={setAppliedCoupon}` passes a state setter, which React keeps stable.

## Scenario 2: a disclosure hook at page level

A team wraps open/close logic in a hook and calls it in the page:

```tsx
function useDisclosure(initial = false) {
  const [isOpen, setIsOpen] = useState(initial);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}

function ProductPage({ product }: { product: Product }) {
  const share = useDisclosure();
  return (
    <>
      <button onClick={share.open}>Share</button>
      {share.isOpen && <ShareSheet url={product.url} onClose={share.close} />}
      <ProductGallery images={product.images} />
      <ReviewsSection productId={product.id} />
    </>
  );
}
```

The hook makes the state *look* local, but it lives in `ProductPage`. Opening the share sheet re-renders the gallery and the reviews. Move the hook call together with the elements that use it:

```tsx
function ShareButton({ url }: { url: string }) {
  const share = useDisclosure();
  return (
    <>
      <button onClick={share.open}>Share</button>
      {share.isOpen && <ShareSheet url={url} onClose={share.close} />}
    </>
  );
}

function ProductPage({ product }: { product: Product }) {
  return (
    <>
      <ShareButton url={product.url} />
      <ProductGallery images={product.images} />
      <ReviewsSection productId={product.id} />
    </>
  );
}
```

## How to recognize the pattern

- A `useState`, or a hook containing one, near the top of a big component.
- The value is read by one or two small elements.
- The rest of the JSX doesn't reference it.

Extract "the state plus everything that reads it" into a component named after what it does (`CouponField`, `ShareButton`, `SearchBox`). If the parent needs the result, pass a callback such as `onApply` or `onSelect` for the *committed* value, rather than lifting the high-frequency draft.

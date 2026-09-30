# Example: State Leaking Between "Different" Components

## Scenario 1: checkout address tabs

```tsx
function AddressStep() {
  const [tab, setTab] = useState<'shipping' | 'billing'>('shipping');
  return (
    <>
      <Tabs value={tab} onChange={setTab} />
      {tab === 'shipping' ? (
        <AddressForm title="Shipping address" onSave={saveShipping} />
      ) : (
        <AddressForm title="Billing address" onSave={saveBilling} />
      )}
    </>
  );
}

function AddressForm({ title, onSave }: AddressFormProps) {
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  // ...
}
```

**Bug:** a user types a street into the shipping form, switches to billing, and sees the shipping street pre-filled in the billing form. Saving writes the shipping street as the billing address.

**Why:** React compares the elements in the second slot of the fragment. Before and after the switch, it's an `AddressForm` with no key. Same type, same slot, so React keeps the instance and its `useState` values, and only `title` and `onSave` change.

### Fix A: tell React they're different with keys

```tsx
{tab === 'shipping' ? (
  <AddressForm key="shipping" title="Shipping address" onSave={saveShipping} />
) : (
  <AddressForm key="billing" title="Billing address" onSave={saveBilling} />
)}
```

The key changes on switch, so React unmounts one form and mounts the other with fresh state.

### Fix B: put them in different slots

```tsx
{tab === 'shipping' && <AddressForm title="Shipping address" onSave={saveShipping} />}
{tab === 'billing' && <AddressForm title="Billing address" onSave={saveBilling} />}
```

Each conditional owns its own slot. The inactive one renders `false`, so each form mounts and unmounts independently.

### Fix C: keep both drafts

If users expect each tab to *remember* what they typed, neither remounting fix is right, because both discard the inactive form's state. Either lift the drafts up:

```tsx
const [drafts, setDrafts] = useState<Record<'shipping' | 'billing', AddressDraft>>(emptyDrafts);
<AddressForm
  key={tab}
  value={drafts[tab]}
  onChange={(d) => setDrafts((prev) => ({ ...prev, [tab]: d }))}
/>
```

Or keep both mounted and hide the inactive one: with CSS, with the `hidden` attribute, or with `<Activity mode={tab === 'billing' ? 'visible' : 'hidden'}>` on React 19.2+.

## Scenario 2: switching the record being edited

```tsx
function CustomerPanel({ customerId }: { customerId: string }) {
  const customer = useCustomer(customerId);
  return customer ? <NotesEditor initialNotes={customer.notes} /> : <Spinner />;
}

function NotesEditor({ initialNotes }: { initialNotes: string }) {
  const [notes, setNotes] = useState(initialNotes); // initialNotes only read on mount
  // ...
}
```

**Bug:** selecting another customer in the sidebar keeps showing the previous customer's notes. `useState(initialNotes)` uses its argument only on mount, and the editor never remounts because it's the same type in the same slot.

**Tempting but wrong:**

```tsx
useEffect(() => setNotes(initialNotes), [initialNotes]);
```

This renders the old notes first, then corrects them a moment later. It also overwrites the user's unsaved edits when a background refetch returns the same customer with a new object, and every new piece of local state needs another reset line.

**Fix:** key the editor by the entity it edits.

```tsx
return customer ? <NotesEditor key={customerId} initialNotes={customer.notes} /> : <Spinner />;
```

## How to spot this class of bug

- A ternary or `switch` returns the **same component type** in each branch, with different props that represent **different things**.
- A component initializes state from props (`useState(props.x)`), and the parent can change which entity those props describe.
- An effect exists only to reset state when an ID-like prop changes.

In all three cases, decide whether it's "the same thing with new data" (keep it) or "a different thing" (key it).

import { useState } from 'react';
import { DemoShell, Tracked } from './kit';

type Tab = 'shipping' | 'billing';

const TABS: { id: Tab; label: string }[] = [
  { id: 'shipping', label: 'Shipping address' },
  { id: 'billing', label: 'Billing address' },
];

function AddressForm({ title }: { title: string }) {
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  return (
    <Tracked name="AddressForm" kind="state" tag={`title="${title}"`} note="Owns street and city as local state.">
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Street</span>
        <input className="demo-input" value={street} onChange={(e) => setStreet(e.target.value)} placeholder="221 Garden Lane" />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>City</span>
        <input className="demo-input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Springfield" />
      </label>
    </Tracked>
  );
}

function Checkout({ keyed }: { keyed: boolean }) {
  const [tab, setTab] = useState<Tab>('shipping');
  const title = TABS.find((t) => t.id === tab)!.label;

  return (
    <>
      <div className="demo-switch" role="group" aria-label="Address type" style={{ justifySelf: 'start' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            className="demo-btn"
            style={{
              border: 0,
              background: tab === t.id ? 'var(--surface-3)' : 'transparent',
              boxShadow: tab === t.id ? 'var(--shadow-sm)' : 'none',
            }}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {keyed ? (
        <AddressForm key={tab} title={title} />
      ) : tab === 'shipping' ? (
        <AddressForm title="Shipping address" />
      ) : (
        <AddressForm title="Billing address" />
      )}
    </>
  );
}

export default function StateLeakDemo() {
  return (
    <DemoShell
      title="Fill in the shipping address, then switch tabs"
      hint="Type a street on the Shipping tab, then open Billing. Is the billing form empty?"
      issueLabel="Same type, same place"
      fixLabel="key={tab}"
      explain={{
        issue: (
          <>
            Both branches of the ternary render an <code>AddressForm</code> at the same position. React sees the same
            type in the same place, keeps the instance and its state, and only updates the <code>title</code> prop.
          </>
        ),
        fix: (
          <>
            A different <code>key</code> per tab tells React these are different forms, so switching unmounts one and
            mounts a fresh one. Switching back starts empty too; the article covers how to keep both drafts.
          </>
        ),
      }}
    >
      {(mode) => <Checkout keyed={mode === 'fix'} />}
    </DemoShell>
  );
}

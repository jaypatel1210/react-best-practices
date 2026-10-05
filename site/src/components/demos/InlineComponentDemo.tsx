import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { DemoShell, Meter } from './kit';

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mounts: RefObject<HTMLElement | null>;
}

/** Counts mounts: the dependency never changes, so the effect runs once each time the field mounts. */
function useMountCounter(mounts: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const out = mounts.current;
    if (out) out.textContent = String(Number(out.textContent || '0') + 1);
  }, [mounts]);
}

function FieldMarkup({ label, value, onChange }: Omit<FieldProps, 'mounts'>) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{label}</span>
      <input
        className="demo-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Type your name, one letter at a time"
      />
    </label>
  );
}

/** The issue: Field is declared inside the form, so every render creates a new component type. */
function ProfileFormWithInnerField({ mounts }: { mounts: RefObject<HTMLElement | null> }) {
  const [name, setName] = useState('');

  function Field({ label, value, onChange }: Omit<FieldProps, 'mounts'>) {
    useMountCounter(mounts);
    return <FieldMarkup label={label} value={value} onChange={onChange} />;
  }

  return <Field label="Display name" value={name} onChange={setName} />;
}

/** The fix: Field is declared once, at module scope, so its type never changes. */
function Field({ label, value, onChange, mounts }: FieldProps) {
  useMountCounter(mounts);
  return <FieldMarkup label={label} value={value} onChange={onChange} />;
}

function ProfileFormWithModuleField({ mounts }: { mounts: RefObject<HTMLElement | null> }) {
  const [name, setName] = useState('');
  return <Field label="Display name" value={name} onChange={setName} mounts={mounts} />;
}

function Stage({ mode }: { mode: 'issue' | 'fix' }) {
  const mounts = useRef<HTMLElement>(null);
  return (
    <>
      <div className="meters">
        <Meter label="Times the field has mounted" outRef={mounts} initial="" />
      </div>
      {mode === 'issue' ? <ProfileFormWithInnerField mounts={mounts} /> : <ProfileFormWithModuleField mounts={mounts} />}
    </>
  );
}

export default function InlineComponentDemo() {
  return (
    <DemoShell
      title="Type your name into the field"
      hint="Click the field and type a word without clicking again. Then switch to the fix and try once more."
      issueLabel="Field defined inside"
      fixLabel="Field at module scope"
      explain={{
        issue: (
          <>
            Each keystroke re-renders the form, which declares a brand-new <code>Field</code> function. React sees a
            different component type, so it unmounts the old input, which loses focus, and mounts a new one.
          </>
        ),
        fix: (
          <>
            <code>Field</code> is the same function on every render, so React keeps the same instance and the same
            DOM input. The mount count stays at 1 and focus stays put.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

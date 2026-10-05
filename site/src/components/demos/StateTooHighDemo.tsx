import { useState } from 'react';
import { DemoShell, Meter, RenderLegend, Tracked, useWorkMeter } from './kit';

const isValid = (code: string) => /^[A-Z0-9]{6,12}$/.test(code);

function OrderTimeline() {
  return <Tracked name="OrderTimeline" cost={22} note="Eighteen order events, rendered as a long list." />;
}

function InvoicePreview({ coupon }: { coupon: string | null }) {
  return <Tracked name="InvoicePreview" cost={22} note={coupon ? `Coupon ${coupon} applied: −10%` : 'No coupon applied.'} />;
}

function CouponInput({
  value,
  onChange,
  onApply,
}: {
  value: string;
  onChange: (value: string) => void;
  onApply: () => void;
}) {
  return (
    <form
      className="demo-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (isValid(value)) onApply();
      }}
    >
      <input
        className="demo-input"
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        placeholder="Type a coupon, e.g. SPRING2026"
        aria-label="Coupon code"
        aria-invalid={value !== '' && !isValid(value)}
        maxLength={12}
      />
      <button className="demo-btn demo-btn-primary" disabled={!isValid(value)}>
        Apply
      </button>
    </form>
  );
}

/** The issue: the page owns the draft text, so every keystroke re-renders the whole page. */
function PageWithDraftState({ measure }: { measure: () => void }) {
  const [coupon, setCoupon] = useState('');
  const [applied, setApplied] = useState<string | null>(null);
  return (
    <Tracked name="OrderPage" kind="state" tag="owns coupon, appliedCoupon">
      <CouponInput
        value={coupon}
        onChange={(value) => {
          measure();
          setCoupon(value);
        }}
        onApply={() => setApplied(coupon)}
      />
      <div className="tracked-body row">
        <OrderTimeline />
        <InvoicePreview coupon={applied} />
      </div>
    </Tracked>
  );
}

/** The fix: the draft lives in a small field component; the page keeps only the applied value. */
function CouponField({ onApply, measure }: { onApply: (code: string) => void; measure: () => void }) {
  const [draft, setDraft] = useState('');
  return (
    <Tracked name="CouponField" kind="state" tag="owns draft">
      <CouponInput
        value={draft}
        onChange={(value) => {
          measure();
          setDraft(value);
        }}
        onApply={() => onApply(draft)}
      />
    </Tracked>
  );
}

function PageWithFieldState({ measure }: { measure: () => void }) {
  const [applied, setApplied] = useState<string | null>(null);
  return (
    <Tracked name="OrderPage" tag="owns appliedCoupon">
      <CouponField onApply={setApplied} measure={measure} />
      <div className="tracked-body row">
        <OrderTimeline />
        <InvoicePreview coupon={applied} />
      </div>
    </Tracked>
  );
}

function Stage({ mode }: { mode: 'issue' | 'fix' }) {
  const meter = useWorkMeter();
  return (
    <>
      <div className="meters">
        <Meter label="Main-thread work per keystroke" outRef={meter.outRef} />
      </div>
      {mode === 'issue' ? (
        <PageWithDraftState measure={meter.measure} />
      ) : (
        <PageWithFieldState measure={meter.measure} />
      )}
    </>
  );
}

export default function StateTooHighDemo() {
  return (
    <DemoShell
      title="Type a coupon code and watch what re-renders"
      hint="Type in the field, then switch to the fix and type again. Each flash is a real React re-render."
      issueLabel="State in the page"
      fixLabel="State in the field"
      legend={<RenderLegend />}
      explain={{
        issue: (
          <>
            Each keystroke updates state in <code>OrderPage</code>, so the timeline and the invoice re-render too,
            even though neither reads the draft.
          </>
        ),
        fix: (
          <>
            Typing updates state in <code>CouponField</code> only. The heavy siblings re-render once, when a coupon is
            applied, because that’s the only change they display.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

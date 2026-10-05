import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DemoShell, type DemoMode } from './kit';
import './StackingContextDemo.css';

const ACTIVITY = [
  'Invoice #1042 paid',
  'Priya exported the February report',
  'New seat added to the Design team',
  'Invoice #1043 sent',
  'Mateo changed the billing email',
  'Weekly digest delivered',
];

/** The same dialog, with the same CSS, in both modes. Only the place its DOM ends up changes. */
function ExportDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="sc-modal" onClick={onClose}>
      <div
        ref={panelRef}
        className="sc-dialog"
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <span className="sc-badge">position: fixed · z-index: 9999</span>
        <p className="sc-dialog-title" id={titleId}>
          Export report
        </p>
        <p className="sc-dialog-text">Download March as a CSV file. Large reports can take a minute to prepare.</p>
        <div className="sc-dialog-actions">
          <button type="button" className="demo-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="demo-btn demo-btn-primary" onClick={onClose}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}

function Stage({ mode }: { mode: DemoMode }) {
  const [open, setOpen] = useState(false);
  // The portal target is an element at the root of the frame. A callback ref stores it after
  // mount, so the portal is never created during server rendering.
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const dialog = open ? <ExportDialog onClose={close} /> : null;

  return (
    <div className="sc-app">
      <div className="sc-viewport" tabIndex={0} role="region" aria-label="Mini app, scrollable">
        <header className="sc-header">
          <span className="sc-logo">Acme Analytics</span>
          <span className="sc-badge">position: sticky · z-index: 10</span>
        </header>
        <div className="sc-page">
          <section className="sc-card" aria-label="March report">
            <span className="sc-badge">transform · overflow: hidden</span>
            <p className="sc-card-title">March report</p>
            <button
              ref={triggerRef}
              type="button"
              className="demo-btn demo-btn-primary"
              onClick={() => setOpen(true)}
            >
              Open dialog
            </button>
            {mode === 'issue' ? dialog : dialog && layer && createPortal(dialog, layer)}
          </section>
          <ul className="sc-list" aria-label="Recent activity">
            {ACTIVITY.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      {/* The demo's stand-in for document.body: the last element in the frame. */}
      <div ref={setLayer} className="sc-layer" />
    </div>
  );
}

export default function StackingContextDemo() {
  return (
    <DemoShell
      title="Open a dialog from inside a transformed card"
      hint="Open the dialog, then scroll inside the mini app until the card passes under the header. Switch to the fix and try again. The frame stands in for the browser window, so neither version can cover this page."
      issueLabel="Rendered in the card"
      fixLabel="Portaled to the root"
      explain={{
        issue: (
          <>
            The dialog’s DOM sits inside the card. The card’s <code>transform</code> makes it the containing block and a
            stacking context, so <code>position: fixed</code> fills only the card, <code>overflow: hidden</code> cuts it
            off, and <code>z-index: 9999</code> can’t beat the header’s 10.
          </>
        ),
        fix: (
          <>
            The same dialog, with the same CSS, renders through <code>createPortal</code> into a layer at the root of the
            frame. No transformed or clipped ancestor sits above it, so it fills the frame and covers the header.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

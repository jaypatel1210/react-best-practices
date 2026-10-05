import { memo, useCallback, useState } from 'react';
import { burn, DemoShell, Meter, RenderLegend, Tracked, useRenderFlash, useWorkMeter } from './kit';
import './MemoListDemo.css';

interface Contact {
  id: number;
  name: string;
  starred: boolean;
}

const NAMES = [
  'Ada', 'Bilal', 'Chen', 'Dara', 'Elif', 'Femi', 'Greta', 'Hiro', 'Ines', 'Jonas',
  'Kemi', 'Luca', 'Mira', 'Nadir', 'Oona', 'Pavel', 'Quinn', 'Rosa', 'Sami', 'Tara',
  'Umar', 'Vera', 'Wren', 'Xiu', 'Yara', 'Zane', 'Aiko', 'Bruno', 'Cleo', 'Dev',
  'Esme', 'Farid', 'Gia', 'Hugo', 'Isla', 'Jae', 'Kofi', 'Lena', 'Milo', 'Noor',
];

const initialContacts = (): Contact[] => NAMES.map((name, id) => ({ id, name, starred: id % 7 === 0 }));

/** Simulated cost of rendering one row (an avatar, formatting, a menu). */
const ROW_COST = 1.2;

interface RowProps {
  id: number;
  name: string;
  starred: boolean;
  onToggle: (id: number) => void;
}

function RowView({ id, name, starred, onToggle }: RowProps) {
  burn(ROW_COST);
  const { ref, countRef } = useRenderFlash<HTMLLIElement>();
  return (
    <li ref={ref} className="mld-row flashable">
      <button
        type="button"
        className="mld-star"
        aria-pressed={starred}
        aria-label={`${starred ? 'Unstar' : 'Star'} ${name}`}
        onClick={() => onToggle(id)}
      >
        {starred ? '★' : '☆'}
      </button>
      <span className="mld-name">{name}</span>
      <span className="mld-count" title="Renders">
        <b ref={countRef} />
      </span>
    </li>
  );
}

/** The fix's row: memo, with primitive props and a stable callback. */
const MemoRow = memo(RowView);

function toggleContact(list: Contact[], id: number): Contact[] {
  return list.map((c) => (c.id === id ? { ...c, starred: !c.starred } : c));
}

/** The issue: rows aren't memoized, and each one gets a new inline callback every render. */
function ListWithInlineCallbacks({ measure }: { measure: () => void }) {
  const [contacts, setContacts] = useState(initialContacts);
  const starred = contacts.filter((c) => c.starred).length;
  return (
    <Tracked name="ContactList" kind="state" tag={`${starred} starred`}>
      <ul className="mld-list">
        {contacts.map((contact) => (
          <RowView
            key={contact.id}
            id={contact.id}
            name={contact.name}
            starred={contact.starred}
            onToggle={() => {
              measure();
              setContacts(toggleContact(contacts, contact.id));
            }}
          />
        ))}
      </ul>
    </Tracked>
  );
}

/** The fix: memo rows, primitive props, and one stable callback that takes the id. */
function ListWithMemoRows({ measure }: { measure: () => void }) {
  const [contacts, setContacts] = useState(initialContacts);
  const onToggle = useCallback(
    (id: number) => {
      measure();
      setContacts((list) => toggleContact(list, id));
    },
    [measure],
  );
  const starred = contacts.filter((c) => c.starred).length;
  return (
    <Tracked name="ContactList" kind="state" tag={`${starred} starred`}>
      <ul className="mld-list">
        {contacts.map((contact) => (
          <MemoRow key={contact.id} id={contact.id} name={contact.name} starred={contact.starred} onToggle={onToggle} />
        ))}
      </ul>
    </Tracked>
  );
}

function Stage({ mode }: { mode: 'issue' | 'fix' }) {
  const meter = useWorkMeter();
  // A stable reference for the fix's useCallback dependency.
  const [measure] = useState(() => meter.measure);
  return (
    <>
      <div className="meters">
        <Meter label="Main-thread work per star" outRef={meter.outRef} />
        <Meter label="Rows" initial={NAMES.length} />
      </div>
      {mode === 'issue' ? <ListWithInlineCallbacks measure={measure} /> : <ListWithMemoRows measure={measure} />}
    </>
  );
}

export default function MemoListDemo() {
  return (
    <DemoShell
      title="Star a contact and count the row re-renders"
      hint="Click a few stars. The number on each row counts its renders."
      issueLabel="Plain rows, inline callbacks"
      fixLabel="memo rows, stable callback"
      legend={<RenderLegend state={false} />}
      explain={{
        issue: (
          <>
            Starring one contact re-renders the list, and with it all 40 rows. Even wrapped in <code>memo</code>, the
            rows would re-render, because <code>{'onToggle={() => …}'}</code> is a new function each time.
          </>
        ),
        fix: (
          <>
            Rows are <code>memo</code>-wrapped and get primitive props plus one <code>onToggle(id)</code> from{' '}
            <code>useCallback</code>. Only the row whose <code>starred</code> prop changed re-renders.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

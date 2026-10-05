import { memo, startTransition, useDeferredValue, useEffect, useState } from 'react';
import { DemoShell, Meter, RenderLegend, Tracked, burn, useWorkMeter, type DemoMode } from './kit';
import './DeferredListDemo.css';

interface Customer {
  id: number;
  name: string;
  detail: string;
  search: string;
}

interface Section {
  letter: string;
  customers: Customer[];
}

const CUSTOMER_COUNT = 4000;
/** Simulated cost of scoring one customer against the query, like an accent- and typo-tolerant matcher. */
const MATCH_COST_MS = 0.022;

const FIRST = ['Ada', 'Ben', 'Chloe', 'Dev', 'Elena', 'Femi', 'Grace', 'Hiro', 'Ines', 'Jonas', 'Kofi', 'Lena', 'Mateo',
  'Noor', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sami', 'Tara', 'Uma', 'Victor', 'Wen', 'Xavier', 'Yara', 'Zane'];
// Alphabetical, so neighboring names share a letter section.
const LAST = ['Abbott', 'Adeyemi', 'Baker', 'Brandt', 'Castro', 'Chen', 'Diaz', 'Dubois', 'Eriksen', 'Evans', 'Fischer',
  'Flores', 'Garcia', 'Gupta', 'Haddad', 'Hughes', 'Ibrahim', 'Ito', 'Jensen', 'Jones', 'Kaur', 'Kowalski', 'Laurent',
  'Lopez', 'Moreau', 'Murphy', 'Nakamura', 'Novak', 'Okafor', 'Olsen', 'Pereira', 'Petrov', 'Quintero', 'Reyes',
  'Rossi', 'Santos', 'Schmidt', 'Tanaka', 'Torres', 'Usman', 'Varga', 'Vogel', 'Walsh', 'Weber', 'Yamada', 'Young',
  'Zhang', 'Zimmer'];
const COMPANIES = ['Acme', 'Birchwood', 'Copperline', 'Driftwood', 'Elmstead', 'Foxglove', 'Granite', 'Harborview',
  'Ironbark', 'Juniper'];
const CITIES = ['Lisbon', 'Oslo', 'Austin', 'Nairobi', 'Osaka', 'Toronto', 'Lagos', 'Krakow', 'Denver', 'Seville',
  'Dublin', 'Hanoi'];

function makeCustomer(i: number): Customer {
  const hash = (i * 2654435761) >>> 0; // spreads the other fields evenly, the same way every time
  const first = FIRST[hash % FIRST.length];
  const last = LAST[i % LAST.length];
  const company = COMPANIES[(hash >>> 8) % COMPANIES.length];
  const city = CITIES[(hash >>> 16) % CITIES.length];
  const account = 1000 + i;
  return {
    id: i,
    name: `${last}, ${first}`,
    detail: `${company} · ${city} · #${account}`,
    search: `${first} ${last} ${company} ${city} ${account}`.toLowerCase(),
  };
}

function buildSections(): Section[] {
  const sections: Section[] = [];
  LAST.forEach((last, index) => {
    if (sections.at(-1)?.letter !== last[0]) sections.push({ letter: last[0], customers: [] });
    const section = sections[sections.length - 1];
    for (let i = index; i < CUSTOMER_COUNT; i += LAST.length) section.customers.push(makeCustomer(i));
  });
  return sections;
}

const SECTIONS = buildSections();
const formatCount = new Intl.NumberFormat('en-US').format;

function countMatches(query: string) {
  let count = 0;
  for (const section of SECTIONS) {
    for (const customer of section.customers) if (customer.search.includes(query)) count++;
  }
  return count;
}

/** One letter of the directory. Each section is its own component, so React can pause between them. */
function LetterSection({ section, query }: { section: Section; query: string }) {
  burn(section.customers.length * MATCH_COST_MS);
  const matches = query ? section.customers.filter((customer) => customer.search.includes(query)) : section.customers;
  if (matches.length === 0) return null;
  return (
    <div>
      <p className="dl-letter" aria-hidden="true">
        {section.letter}
      </p>
      <ul className="dl-rows" aria-label={`Last names starting with ${section.letter}`}>
        {matches.map((customer) => (
          <li key={customer.id} className="dl-row">
            <span className="dl-name">{customer.name}</span>
            <span className="dl-detail">{customer.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Wrapped in memo in both modes. It can only skip a render when its query prop stays the same. */
const CustomerList = memo(function CustomerList({ query }: { query: string }) {
  const normalized = query.trim().toLowerCase();
  const shown = normalized ? countMatches(normalized) : CUSTOMER_COUNT;
  return (
    <Tracked
      name="CustomerList"
      kind="memo"
      tag="memo"
      note={`Showing ${formatCount(shown)} of ${formatCount(CUSTOMER_COUNT)} customers. Matching costs about 90 ms per render (simulated).`}
    >
      <div className="dl-scroll" tabIndex={0} role="region" aria-label="Customers">
        {SECTIONS.map((section) => (
          <LetterSection key={section.letter} section={section} query={normalized} />
        ))}
      </div>
    </Tracked>
  );
});

function SearchField({ value, onChange, pending }: { value: string; onChange: (value: string) => void; pending: boolean }) {
  return (
    <div className="demo-row">
      <input
        className="demo-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Filter 4,000 customers, e.g. lisbon"
        aria-label="Filter customers"
        autoComplete="off"
        spellCheck={false}
      />
      <span className="dl-pending" data-pending={pending}>
        Updating…
      </span>
    </div>
  );
}

/** The issue: the list receives the live query, so each keystroke renders it before the field can repaint. */
function DirectoryWithLiveQuery({ measure }: { measure: () => void }) {
  const [query, setQuery] = useState('');
  const handleChange = (next: string) => {
    measure();
    setQuery(next);
  };
  return (
    <>
      <SearchField value={query} onChange={handleChange} pending={false} />
      <CustomerList query={query} />
    </>
  );
}

/** The fix: the field stays urgent, and the list renders a deferred copy of the query in the background. */
function DirectoryWithDeferredQuery({ measure }: { measure: () => void }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;
  const handleChange = (next: string) => {
    measure();
    setQuery(next); // urgent, never inside a transition
  };
  return (
    <>
      <SearchField value={query} onChange={handleChange} pending={isStale} />
      <div className="dl-results" data-stale={isStale}>
        <CustomerList query={deferredQuery} />
      </div>
    </>
  );
}

function Stage({ mode }: { mode: DemoMode }) {
  const meter = useWorkMeter();
  const [ready, setReady] = useState(false);

  // Mount the 4,000 rows on the client only, in the background, so the page never waits for them.
  useEffect(() => startTransition(() => setReady(true)), []);

  return (
    <>
      <div className="meters">
        <Meter label="Main-thread work per keystroke" outRef={meter.outRef} />
      </div>
      {!ready ? (
        <p className="dl-loading">Loading 4,000 customers…</p>
      ) : mode === 'issue' ? (
        <DirectoryWithLiveQuery measure={meter.measure} />
      ) : (
        <DirectoryWithDeferredQuery measure={meter.measure} />
      )}
    </>
  );
}

export default function DeferredListDemo() {
  return (
    <DemoShell
      title="Filter 4,000 customers and watch the field"
      hint="Type a city such as lisbon, then press Backspace a few times. Compare how quickly each letter appears in the two modes."
      issueLabel="Live query"
      fixLabel="Deferred query"
      legend={<RenderLegend state={false} cost={false} />}
      explain={{
        issue: (
          <>
            Each keystroke renders <code>CustomerList</code> with the new text before the field can repaint. Its{' '}
            <code>memo</code> can’t help, because the <code>query</code> prop changes on every keystroke.
          </>
        ),
        fix: (
          <>
            The keystroke renders with the old <code>deferredQuery</code>, so <code>memo</code> skips the list and the
            field repaints at once. React renders the list in the background, starts over if you keep typing, and
            commits it when you pause.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}

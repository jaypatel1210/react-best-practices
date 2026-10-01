# Example: Effects You Don't Need

Each scenario starts with an effect that works on the happy path and ends with code that has no effect at all. The rule behind every fix: if nothing outside React is being synchronized, compute during render or act in the event handler.

## Scenario 1: a shipping calculator built from an effect chain

```tsx
function ShippingEstimate({ cart }: { cart: Cart }) {
  const [country, setCountry] = useState('US');
  const [zones, setZones] = useState<Zone[]>([]);
  const [zone, setZone] = useState<Zone | null>(null);
  const [cost, setCost] = useState(0);

  useEffect(() => setZones(zonesFor(country)), [country]);
  useEffect(() => setZone(zones[0] ?? null), [zones]);
  useEffect(() => setCost(zone ? priceFor(zone, cart.weightKg) : 0), [zone, cart.weightKg]);

  return (
    <>
      <CountrySelect value={country} onChange={setCountry} />
      <ZoneSelect zones={zones} value={zone} onChange={setZone} />
      <p>Shipping: {formatMoney(cost)}</p>
    </>
  );
}
```

What goes wrong:

- **Four renders per country change**, one per link in the chain.
- **Inconsistent frames.** The first render shows the new country with the old zones; the next shows new zones with the old zone and price. On a slow device, users see a price that belongs to another country.
- **Hidden coupling.** If the zone list for a country loads asynchronously later, the second effect silently overwrites a zone the user picked.

### After: one piece of state, everything else derived

```tsx
function ShippingEstimate({ cart }: { cart: Cart }) {
  const [country, setCountry] = useState('US');
  const [zoneId, setZoneId] = useState<string | null>(null);

  const zones = zonesFor(country);
  const zone = zones.find((z) => z.id === zoneId) ?? zones[0] ?? null;
  const cost = zone ? priceFor(zone, cart.weightKg) : 0;

  return (
    <>
      <CountrySelect value={country} onChange={(next) => { setCountry(next); setZoneId(null); }} />
      <ZoneSelect zones={zones} value={zone} onChange={(z) => setZoneId(z.id)} />
      <p>Shipping: {formatMoney(cost)}</p>
    </>
  );
}
```

- Every render is consistent, because zones, zone and cost are computed from the same inputs.
- **Store the selected ID, not a copy of the object.** The selection stays valid when the list is refreshed, and falls back cleanly when the ID disappears.
- The handler sets both pieces of state together; batching turns that into one render.
- If `zonesFor` were expensive, wrap it in `useMemo(() => zonesFor(country), [country])`, after measuring.

## Scenario 2: telling the parent about a change

```tsx
function NotificationToggle({ onChange }: { onChange: (enabled: boolean) => void }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    onChange(enabled);
  }, [enabled, onChange]);
  return <Switch checked={enabled} onCheckedChange={setEnabled} />;
}
```

- It calls `onChange(false)` on mount, which the parent never asked for.
- The parent hears about the change one render late, after the child already committed.
- If the parent passes an inline `onChange`, the effect runs after every parent render. If that callback sets parent state, the two components ping-pong.

### After: notify in the same handler

```tsx
function NotificationToggle({ onChange }: { onChange: (enabled: boolean) => void }) {
  const [enabled, setEnabled] = useState(false);
  const toggle = (next: boolean) => {
    setEnabled(next);
    onChange(next); // both updates are batched into one render
  };
  return <Switch checked={enabled} onCheckedChange={toggle} />;
}
```

If the parent needs the value to render something, make the toggle fully controlled (`checked` and `onCheckedChange` props) and keep the state in the parent.

## Scenario 3: logic that belongs to an event

```tsx
useEffect(() => {
  if (status === 'saved') toast.success('Draft saved');
}, [status]);
```

The toast fires whenever `status` *is* `'saved'` after a render: on remount, after returning to the screen, twice in StrictMode development. The user's intent was "I clicked Save". Put it there:

```tsx
async function handleSave() {
  setStatus('saving');
  await saveDraft(draft);
  setStatus('saved');
  toast.success('Draft saved');
}
```

Ask "why does this code run?" If the answer is "because the user did X", it belongs in X's handler. If it's "because the component is visible", it's an effect.

## Scenario 4: subscribing to a browser API

```tsx
function usePageVisible() {
  const [visible, setVisible] = useState(!document.hidden); // crashes during SSR
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}
```

It works on the client, but reads `document` during render (breaking SSR), and can show a stale value if visibility changed between render and the effect. `useSyncExternalStore` is built for exactly this:

```tsx
function subscribeToVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function usePageVisible() {
  return useSyncExternalStore(
    subscribeToVisibility,
    () => !document.hidden, // client snapshot: a primitive
    () => true,             // server snapshot
  );
}
```

`subscribeToVisibility` lives at module scope, so React subscribes once instead of re-subscribing every render.

## Scenario 5: initialization that runs "once"

```tsx
function App() {
  useEffect(() => {
    initErrorReporting();
    loadFeatureFlags();
  }, []);
  // ...
}
```

`[]` means "once per mount", not "once per app". It runs twice in StrictMode development, and again if `App` ever remounts (a root `key` change, an error boundary reset). For true app-level setup, run it at module scope in the entry file, guarded for the browser:

```tsx
// main.tsx
if (typeof window !== 'undefined') {
  initErrorReporting();
}
```

Or keep it in a component behind a module-level flag (`let didInit = false`) when it needs to happen after the first render.

## Quick test for any effect

1. Which external system does it synchronize with? If none, remove it.
2. Would it be correct to run it twice in a row (setup, cleanup, setup)? If not, the cleanup is missing.
3. Does it store something render could calculate from props and state? Derive it instead.

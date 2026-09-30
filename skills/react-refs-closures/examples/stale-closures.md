# Example: Stale Closures and How to Escape Them

A closure is a snapshot: a function created during a render sees the props and state *of that render*, forever. A closure goes stale when the function is kept while the values it captured have moved on.

## 1. The interval that counts to one

```tsx
function SessionTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds(seconds + 1), 1000); // captures seconds = 0
    return () => clearInterval(id);
  }, []);
  return <span>{seconds}s</span>;
}
```

The interval is created once, and its callback always computes `0 + 1`. Adding `seconds` to the deps would "work", but would tear down and recreate the interval every second. The right fix is to stop reading state:

```tsx
useEffect(() => {
  const id = setInterval(() => setSeconds((s) => s + 1), 1000);
  return () => clearInterval(id);
}, []);
```

## 2. A socket handler with old filters

```tsx
function LiveOrders({ minTotal }: { minTotal: number }) {
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    const socket = connectOrders();
    socket.on('order', (order: Order) => {
      if (order.total >= minTotal) setOrders((prev) => [order, ...prev]); // minTotal from the first render
    });
    return () => socket.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
```

Changing the `minTotal` filter has no effect on incoming orders. Adding `minTotal` to the deps fixes staleness but reconnects the socket on every filter change. You want the latest `minTotal` without re-running the effect:

**React 19.2+: `useEffectEvent`**

```tsx
const onOrder = useEffectEvent((order: Order) => {
  if (order.total >= minTotal) setOrders((prev) => [order, ...prev]); // always the latest minTotal
});

useEffect(() => {
  const socket = connectOrders();
  socket.on('order', (order: Order) => onOrder(order)); // called from code the effect set up
  return () => socket.close();
}, []); // Effect Events are deliberately left out of the dependency array
```

Effect Events are for logic *called from effects* (including callbacks those effects register). Don't pass them to child components or call them during render.

**Earlier versions: the latest-ref pattern** (`assets/use-latest-callback.ts`)

```tsx
const onOrder = useLatestCallback((order: Order) => {
  if (order.total >= minTotal) setOrders((prev) => [order, ...prev]);
});

useEffect(() => {
  const socket = connectOrders();
  socket.on('order', onOrder);
  return () => socket.close();
}, [onOrder]); // stable identity, so the effect runs once
```

## 3. A memoized child with a comparator that ignores callbacks

```tsx
const SignatureCanvas = memo(
  function SignatureCanvas({ penColor, onDone }: { penColor: string; onDone: () => void }) { /* heavy */ },
  (prev, next) => prev.penColor === next.penColor, // "ignore onDone, it always changes"
);

function ContractForm() {
  const [fullName, setFullName] = useState('');
  return (
    <>
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <SignatureCanvas penColor="navy" onDone={() => submitContract({ fullName })} />
    </>
  );
}
```

The canvas never re-renders, so it keeps the **first** `onDone`, whose closure has `fullName === ''`. The contract is submitted with an empty name.

Fix: remove the custom comparator, and pass a callback that is stable *and* reads the latest state:

```tsx
const SignatureCanvas = memo(function SignatureCanvas(props: SignatureCanvasProps) { /* heavy */ });

function ContractForm() {
  const [fullName, setFullName] = useState('');
  const onDone = useLatestCallback(() => submitContract({ fullName }));
  return (
    <>
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <SignatureCanvas penColor="navy" onDone={onDone} />
    </>
  );
}
```

Typing still doesn't re-render the canvas, because every prop is stable, and `onDone` always submits the current name.

Why not `useCallback(() => submitContract({ fullName }), [fullName])`? It's correct, but it changes on every keystroke and re-renders the canvas each time, which is what `memo` was supposed to prevent.

## 4. A function stored in a ref once

```tsx
const handlerRef = useRef(() => console.log(filters)); // initial value only, never refreshed
```

`useRef(initial)` uses its argument only on the first render. A function stored this way is frozen at mount. Refresh it after every commit (as `useLatestCallback` does), or don't store functions in refs.

## How to recognize stale closures in review

- `// eslint-disable-next-line react-hooks/exhaustive-deps` next to an effect or callback that reads props or state.
- `setX(x + 1)` inside intervals, timeouts, listeners or subscriptions registered once.
- A custom `memo` comparator that skips function props.
- `useRef(someFunction)`, or a debounced or throttled wrapper created once from a function that reads state.
- A bug report that says "it uses the old value" or "the first value", or "only works after I change something else".

import { createContext, useContext, useEffect } from 'react';

// Ground truth for the tracker tests: an effect with no dependency array runs once after every
// commit in which the component rendered, so this counts committed renders per component.
// (Run the lab without StrictMode for exact numbers; StrictMode replays mount effects.)
const truth = (window.__truth = window.__truth || {});
export function useTruth(name) {
  useEffect(() => {
    truth[name] = (truth[name] || 0) + 1;
  });
}

export const PRODUCTS = [
  ['p1', 'Trail Runner', 'Shoes', 89],
  ['p2', 'Canvas Tote', 'Bags', 24],
  ['p3', 'Wool Beanie', 'Hats', 18],
  ['p4', 'Court Sneaker', 'Shoes', 74],
  ['p5', 'Rolltop Pack', 'Bags', 96],
  ['p6', 'Sun Visor', 'Hats', 15],
  ['p7', 'Trail Sandal', 'Shoes', 52],
  ['p8', 'Sling Pouch', 'Bags', 31],
  ['p9', 'Bucket Hat', 'Hats', 22],
  ['p10', 'Road Racer', 'Shoes', 120],
  ['p11', 'Duffel 40L', 'Bags', 88],
  ['p12', 'Rain Cap', 'Hats', 27],
].map(([id, name, category, price]) => ({ id, name, category, price }));

export const CartContext = createContext(null);
CartContext.displayName = 'CartContext';

export function CartBadge() {
  useTruth('CartBadge');
  const cart = useContext(CartContext);
  return <span aria-label="Cart">{cart.items.length} in cart</span>;
}

// Burn a little CPU so render cost is visible in timings. ?cost=N multiplies it, so the timing
// benchmark's tests can make wasted renders expensive enough to measure.
const COST = Number(new URLSearchParams(window.location.search).get('cost')) || 1;
export function work(units) {
  let x = 0;
  for (let i = 0; i < units * COST * 1000; i++) x += Math.sqrt(i);
  return x;
}

export function Suggestions({ query, limit }) {
  useTruth('Suggestions');
  const q = query.toLowerCase();
  const matches = PRODUCTS.filter((product) => product.name.toLowerCase().includes(q)).slice(0, limit);
  return (
    <ul className="suggestions" aria-label="Suggestions">
      {matches.map((product) => (
        <li key={product.id}>{product.name}</li>
      ))}
    </ul>
  );
}

export function PromoBanner({ compact }) {
  useTruth('PromoBanner');
  work(20);
  return <p className={compact ? 'promo promo--compact' : 'promo'}>Free returns on every order</p>;
}

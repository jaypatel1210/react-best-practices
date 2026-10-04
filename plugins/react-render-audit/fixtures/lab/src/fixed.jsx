// The same store as broken.jsx with every planted problem fixed. It renders identical DOM, so the
// equivalence check must pass. `suggestionLimit` lets the lab simulate a fix that changes behavior.
import { memo, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { CartBadge, CartContext, PRODUCTS, PromoBanner, Suggestions, useTruth, work } from './shared.jsx';

// Fix: subscribe to the breakpoint, not the pixel width.
const compactQuery = '(max-width: 699px)';
function subscribeCompact(onChange) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
function useIsCompact() {
  return useSyncExternalStore(subscribeCompact, () => window.matchMedia(compactQuery).matches);
}

const CARD_STYLE = { minHeight: 120 };

const ProductCard = memo(function ProductCard({ product, onAdd }) {
  useTruth('ProductCard');
  work(8);
  return (
    <article className="card" style={CARD_STYLE}>
      <h3>{product.name}</h3>
      <p>
        {product.category} · ${product.price}
      </p>
      <button type="button" aria-label={`Add ${product.name} to cart`} onClick={() => onAdd(product.id)}>
        Add
      </button>
    </article>
  );
});

function ProductGrid({ products, onAdd }) {
  useTruth('ProductGrid');
  return (
    <section className="grid" aria-label="Products">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} onAdd={onAdd} />
      ))}
    </section>
  );
}

function Chip({ label }) {
  useTruth('Chip');
  return <button type="button">{label}</button>;
}

function FilterChips({ labels }) {
  useTruth('FilterChips');
  return (
    <nav className="chips" aria-label="Filters">
      {labels.map((label) => (
        <Chip key={label} label={label} />
      ))}
    </nav>
  );
}

function CartTicker({ count }) {
  useTruth('CartTicker');
  return <p aria-live="polite">{`${count} items so far`}</p>;
}

// Fix: the search text lives in the only part of the page that uses it.
function SearchArea({ suggestionLimit }) {
  useTruth('SearchArea');
  const [query, setQuery] = useState('');
  return (
    <>
      <input aria-label="Search products" placeholder="Search products" value={query} onChange={(event) => setQuery(event.target.value)} />
      {query && <Suggestions query={query} limit={suggestionLimit} />}
    </>
  );
}

const CHIP_LABELS = ['All', 'Shoes', 'Bags', 'Hats'];

export function Store({ suggestionLimit = 5 }) {
  useTruth('Store');
  const [cart, setCart] = useState([]);
  const compact = useIsCompact();
  const add = useCallback((id) => setCart((items) => [...items, id]), []);
  const cartValue = useMemo(() => ({ items: cart, add }), [cart, add]);
  return (
    <CartContext.Provider value={cartValue}>
      <header className="bar">
        <h1>Lab Store</h1>
        <SearchArea suggestionLimit={suggestionLimit} />
        <CartBadge />
      </header>
      <FilterChips labels={CHIP_LABELS} />
      <PromoBanner compact={compact} />
      <ProductGrid products={PRODUCTS} onAdd={add} />
      <CartTicker count={cart.length} />
    </CartContext.Provider>
  );
}

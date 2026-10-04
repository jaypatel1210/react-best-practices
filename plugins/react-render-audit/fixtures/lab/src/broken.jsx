// The store with planted re-render problems. fixed.jsx is the same UI with each one fixed.
import { memo, useEffect, useState } from 'react';
import { CartBadge, CartContext, PRODUCTS, PromoBanner, Suggestions, useTruth, work } from './shared.jsx';

// Problem: stores the pixel width, so every resize event re-renders the whole store.
function useViewportWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

const ProductCard = memo(function ProductCard({ product, onAdd, style }) {
  useTruth('ProductCard');
  work(8);
  return (
    <article className="card" style={style}>
      <h3>{product.name}</h3>
      <p>
        {product.category} · ${product.price}
      </p>
      <button type="button" aria-label={`Add ${product.name} to cart`} onClick={onAdd}>
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
        // Problem: a new function and a new style object every render defeat memo().
        <ProductCard key={product.id} product={product} onAdd={() => onAdd(product.id)} style={{ minHeight: 120 }} />
      ))}
    </section>
  );
}

function FilterChips({ labels }) {
  useTruth('FilterChips');
  // Problem: a component type created during render remounts on every render.
  function Chip({ label }) {
    useTruth('Chip');
    return <button type="button">{label}</button>;
  }
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
  // Problem: derived text copied into state by an effect costs a second commit.
  const [text, setText] = useState(`${count} items so far`);
  useEffect(() => {
    setText(`${count} items so far`);
  }, [count]);
  return <p aria-live="polite">{text}</p>;
}

const CHIP_LABELS = ['All', 'Shoes', 'Bags', 'Hats'];

export function Store({ suggestionLimit = 5 }) {
  useTruth('Store');
  // Problem: search text lives at the top, so each keystroke re-renders the whole page.
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState([]);
  const width = useViewportWidth();
  const add = (id) => setCart((items) => [...items, id]);
  return (
    // Problem: a new context value every render re-renders every consumer.
    <CartContext.Provider value={{ items: cart, add }}>
      <header className="bar">
        <h1>Lab Store</h1>
        <input aria-label="Search products" placeholder="Search products" value={query} onChange={(event) => setQuery(event.target.value)} />
        {query && <Suggestions query={query} limit={suggestionLimit} />}
        <CartBadge />
      </header>
      <FilterChips labels={CHIP_LABELS} />
      <PromoBanner compact={width < 700} />
      <ProductGrid products={PRODUCTS} onAdd={add} />
      <CartTicker count={cart.length} />
    </CartContext.Provider>
  );
}

import { useEffect, useState } from 'react';

type Product = { id: string; name: string; price: number };

export function ProductSearch() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [results, setResults] = useState<Product[]>([]);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    fetch(`/api/products?q=${encodeURIComponent(query)}&category=${category}`)
      .then((res) => res.json())
      .then((data) => setResults(data.items));
  }, [query, category]);

  return (
    <div className="product-search">
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="all">All</option>
        <option value="shoes">Shoes</option>
        <option value="bags">Bags</option>
      </select>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search products"
      />
      <ul>
        {results.map((p) => (
          <li key={p.id}>
            {p.name} — ${p.price}
          </li>
        ))}
      </ul>
    </div>
  );
}

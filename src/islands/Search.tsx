import { useState, useEffect, useRef } from 'react';
import { formatPaisa } from '../lib/money';

type SearchResult = {
  id: string;
  title: string;
  slug: string;
  imageUrl: string;
  pricePaisa: number;
  variantLabel: string;
};

export function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<number | null>(null);

  // Debounced search trigger
  useEffect(() => {
    if (searchTimeout.current) {
      window.clearTimeout(searchTimeout.current);
    }

    if (!query.trim() || query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setLoading(true);
    searchTimeout.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        if (res.ok && Array.isArray(data.products)) {
          setResults(data.products.slice(0, 8));
          setIsOpen(data.products.length > 0);
        } else {
          setResults([]);
          setIsOpen(false);
        }
      } catch {
        setResults([]);
        setIsOpen(false);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (searchTimeout.current) window.clearTimeout(searchTimeout.current);
    };
  }, [query]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev === results.length - 1 ? 0 : prev + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev === 0 ? results.length - 1 : prev - 1));
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < results.length) {
        e.preventDefault();
        window.location.href = `/products/${results[activeIndex].slug}`;
      }
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md" onKeyDown={handleKeyDown}>
      <label className="flex relative w-full">
        <span className="sr-only">Search products</span>
        <div className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)] pointer-events-none">
          {loading ? (
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          )}
        </div>
        <input
          type="search"
          placeholder="Search collections, bags, jewelry…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && results.length > 0 && setIsOpen(true)}
          className="control w-full pl-10 pr-4 h-10 rounded-full text-sm bg-[var(--surface-storefront)] border border-[var(--border-storefront)] focus:border-[var(--brand-storefront)] outline-none transition-all"
          autoComplete="off"
        />
      </label>

      {/* Autocomplete dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute left-0 right-0 mt-1.5 z-50 rounded-2xl bg-[var(--surface-storefront)] border border-[var(--border-storefront)] shadow-lg overflow-hidden py-1 max-h-[360px] overflow-y-auto pop">
          {results.map((product, idx) => (
            <a
              key={product.id}
              href={`/products/${product.slug}`}
              className={`flex items-center gap-3 px-4 py-2.5 text-xs transition ${
                activeIndex === idx 
                  ? 'bg-[var(--brand-storefront-light)] text-[var(--brand-storefront)] font-semibold' 
                  : 'text-[var(--ink-storefront)] hover:bg-[var(--surface-storefront-soft)]'
              }`}
            >
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[var(--surface-storefront-soft)] border border-[var(--border-storefront-soft)]">
                <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate text-xs">{product.title}</p>
                <p className="text-[10px] text-[var(--muted)] mt-0.5">{product.variantLabel}</p>
              </div>
              <span className="font-extrabold tabular text-xs text-[var(--ink-storefront)]">{formatPaisa(product.pricePaisa)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

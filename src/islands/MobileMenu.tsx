import { useState, useEffect, useRef } from 'react';

type CategoryItem = {
  name: string;
  slug: string;
  subcategories: Array<{ name: string; slug: string }>;
};

type Props = {
  categories: CategoryItem[];
};

export function MobileMenu({ categories }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function handleOpen() {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setIsOpen(true);
    }
    function handleClose() {
      setIsOpen(false);
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    }
    window.addEventListener('zb-menu-open', handleOpen);
    window.addEventListener('zb-menu-close', handleClose);
    return () => {
      window.removeEventListener('zb-menu-open', handleOpen);
      window.removeEventListener('zb-menu-close', handleClose);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const focusableElements = menuRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex="0"]'
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    if (firstElement) firstElement.focus();

    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    }

    window.addEventListener('keydown', handleTab);
    return () => window.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  function toggleExpand(slug: string) {
    setExpandedCat((prev) => (prev === slug ? null : slug));
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby="menu-title">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity fade-in"
        onClick={() => setIsOpen(false)}
      />

      {/* Menu Body */}
      <div 
        ref={menuRef}
        className="relative flex h-full w-[280px] flex-col bg-[var(--surface-storefront)] shadow-xl border-r border-[var(--border-storefront)] transition-transform duration-300 ease-out translate-x-0"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-storefront)] px-5 h-16">
          <h2 id="menu-title" className="text-base font-extrabold tracking-tight">Navigation</h2>
          <button 
            type="button" 
            onClick={() => setIsOpen(false)}
            className="tap-44 -mr-2 p-2 rounded-full hover:bg-[var(--surface-storefront-soft)] text-[var(--muted)] hover:text-[var(--ink-storefront)] transition cursor-pointer"
            aria-label="Close menu"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <nav className="space-y-1">
            <a 
              href="/"
              className="flex h-11 items-center px-3 text-sm font-bold text-[var(--ink-storefront)] rounded-xl hover:bg-[var(--surface-storefront-soft)] transition"
            >
              Home
            </a>
            
            <div className="space-y-0.5">
              <div className="flex h-11 items-center justify-between px-3 text-sm font-bold text-[var(--ink-storefront)]">
                <span>Collections</span>
              </div>
              <div className="pl-3 space-y-1">
                {categories.map((category) => {
                  const isExpanded = expandedCat === category.slug;
                  return (
                    <div key={category.slug} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => toggleExpand(category.slug)}
                        className="flex w-full h-9 items-center justify-between px-3 text-xs font-bold rounded-lg hover:bg-[var(--surface-storefront-soft)] text-[var(--ink-storefront-secondary)] transition cursor-pointer"
                      >
                        <span>{category.name}</span>
                        <svg 
                          className={`h-4 w-4 transform transition-transform duration-200 ${isExpanded ? 'rotate-180 text-[var(--brand-storefront)]' : 'text-[var(--muted)]'}`}
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor" 
                          strokeWidth="2"
                        >
                          <path d="M19 9l-7 7-7-7"/>
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="pl-4 border-l border-[var(--border-storefront)] ml-4 space-y-0.5 pop">
                          <a 
                            href={`/categories/${category.slug}`}
                            className="flex h-8 items-center px-3 text-xs font-bold text-[var(--brand-storefront)] rounded-md hover:bg-[var(--surface-storefront-soft)] transition"
                          >
                            All {category.name}
                          </a>
                          {category.subcategories.map((sub) => (
                            <a 
                              key={sub.slug}
                              href={`/categories/${sub.slug}`}
                              className="flex h-8 items-center px-3 text-xs font-semibold text-[var(--muted)] rounded-md hover:bg-[var(--surface-storefront-soft)] hover:text-[var(--ink-storefront)] transition"
                            >
                              {sub.name}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </nav>

          <div className="border-t border-[var(--border-storefront)] pt-4 space-y-3">
            <h3 className="px-3 text-[10px] font-extrabold uppercase tracking-wider text-[var(--muted)]">Store Location</h3>
            <p className="px-3 text-xs leading-relaxed text-[var(--ink-storefront-secondary)] font-medium">
              10 Ground Floor, A.K Famous Tower,<br />Rankin Street, Wari, Dhaka
            </p>
            <a 
              href="tel:+8801985516000"
              className="flex h-11 items-center gap-2 px-3 text-xs font-bold text-[var(--brand-storefront)] rounded-xl hover:bg-[var(--surface-storefront-soft)] transition"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
              Call support
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

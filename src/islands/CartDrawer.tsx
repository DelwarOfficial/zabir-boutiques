import { useEffect, useState, useRef } from 'react';
import { useLocalCart } from '../hooks/useLocalCart';
import { formatPaisa, type Paisa } from '../lib/money';

type CouponState = {
  code: string;
  discountPaisa: number;
  error?: string;
  loading: boolean;
};

export function CartDrawer() {
  const cart = useLocalCart();
  const [isOpen, setIsOpen] = useState(false);
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [coupon, setCoupon] = useState<CouponState>({ code: '', discountPaisa: 0, loading: false });
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Sync coupon with localStorage on mount & cart total changes
  useEffect(() => {
    const saved = localStorage.getItem('zb-coupon');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { code: string };
        if (parsed && parsed.code) {
          validateCouponOnServer(parsed.code, cart.subtotalPaisa);
        }
      } catch {}
    }
  }, []);

  // Recalculate coupon discount if cart total changes
  useEffect(() => {
    if (coupon.code && !coupon.error && coupon.discountPaisa > 0) {
      validateCouponOnServer(coupon.code, cart.subtotalPaisa, true);
    }
  }, [cart.subtotalPaisa]);

  // Open/Close listeners
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
    window.addEventListener('zb-cart-open', handleOpen);
    window.addEventListener('zb-cart-close', handleClose);
    return () => {
      window.removeEventListener('zb-cart-open', handleOpen);
      window.removeEventListener('zb-cart-close', handleClose);
    };
  }, []);

  // Escape key to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Focus trap inside drawer
  useEffect(() => {
    if (!isOpen || !drawerRef.current) return;
    const focusableElements = drawerRef.current.querySelectorAll(
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

  async function validateCouponOnServer(code: string, subtotal: number, silent = false) {
    if (subtotal <= 0) return;
    if (!silent) setCoupon(prev => ({ ...prev, loading: true, error: undefined }));

    try {
      const res = await fetch('/api/checkout/validate-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.toUpperCase().trim(), subtotalPaisa: subtotal })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setCoupon({
          code: data.code,
          discountPaisa: data.discountPaisa,
          loading: false
        });
        localStorage.setItem('zb-coupon', JSON.stringify({ code: data.code, discountPaisa: data.discountPaisa }));
      } else {
        setCoupon({ code: '', discountPaisa: 0, error: data.message || 'Invalid coupon.', loading: false });
        localStorage.removeItem('zb-coupon');
      }
    } catch {
      if (!silent) setCoupon({ code: '', discountPaisa: 0, error: 'Network error. Try again.', loading: false });
    }
  }

  function handleApplyCoupon(e: React.FormEvent) {
    e.preventDefault();
    if (!couponCodeInput.trim()) return;
    validateCouponOnServer(couponCodeInput, cart.subtotalPaisa);
  }

  function handleRemoveCoupon() {
    setCoupon({ code: '', discountPaisa: 0, loading: false });
    setCouponCodeInput('');
    localStorage.removeItem('zb-coupon');
  }

  const shippingCost = 7000; // Inside Dhaka ৳70 by default
  const subtotal = cart.subtotalPaisa;
  const discount = coupon.discountPaisa;
  const total = Math.max(0, subtotal + shippingCost - discount);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="cart-title">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity fade-in"
        onClick={() => setIsOpen(false)}
      />

      {/* Drawer Body */}
      <div 
        ref={drawerRef}
        className="relative flex h-full w-full max-w-md flex-col bg-[var(--surface-storefront)] shadow-xl border-l border-[var(--border-storefront)] transition-transform duration-300 ease-out translate-x-0"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-storefront)] px-5 h-16">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-[var(--brand-storefront)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
            </svg>
            <h2 id="cart-title" className="text-base font-bold">Shopping Cart ({cart.itemCount})</h2>
          </div>
          <button 
            type="button" 
            onClick={() => setIsOpen(false)}
            className="tap-44 -mr-2 p-2 rounded-full hover:bg-[var(--surface-storefront-soft)] text-[var(--muted)] hover:text-[var(--ink-storefront)] transition cursor-pointer"
            aria-label="Close cart"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {cart.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="rounded-full bg-[var(--surface-storefront-soft)] p-5 text-[var(--muted)]">
                <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
                </svg>
              </div>
              <h3 className="mt-4 text-base font-bold">Your cart is empty</h3>
              <p className="mt-1 text-xs text-[var(--muted)] max-w-[200px]">Browse our premium collections to add items.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {cart.items.map((item) => (
                <li key={item.variantId} className="flex gap-4 border border-[var(--border-storefront)] rounded-2xl p-3.5 bg-[var(--surface-storefront)]">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-[var(--surface-storefront-soft)] border border-[var(--border-storefront-soft)]">
                    <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex flex-1 flex-col justify-between min-w-0">
                    <div>
                      <h4 className="font-bold text-xs line-clamp-1 text-[var(--ink-storefront)]">{item.title}</h4>
                      <p className="text-[10px] font-semibold text-[var(--muted)] mt-0.5">{item.variantLabel}</p>
                      <p className="mt-1 font-extrabold tabular text-xs text-[var(--ink-storefront)]">{formatPaisa(item.unitPricePaisa * item.quantity)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => cart.updateQuantity(item.variantId, item.quantity - 1)}
                          className="tap-44 flex items-center justify-center h-7 w-7 rounded-lg border border-[var(--border-storefront)] text-[var(--ink-storefront-secondary)] hover:border-[var(--brand-storefront)] cursor-pointer"
                        >
                          {item.quantity > 1 ? (
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M20 12H4"/></svg>
                          ) : (
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          )}
                        </button>
                        <span className="w-6 text-center text-xs font-bold tabular">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => cart.updateQuantity(item.variantId, item.quantity + 1)}
                          className="tap-44 flex items-center justify-center h-7 w-7 rounded-lg border border-[var(--border-storefront)] text-[var(--ink-storefront-secondary)] hover:border-[var(--brand-storefront)] cursor-pointer"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer actions */}
        {cart.items.length > 0 && (
          <div className="border-t border-[var(--border-storefront)] p-5 bg-[var(--surface-storefront-soft)] space-y-4">
            {/* Coupon Code section */}
            <form onSubmit={handleApplyCoupon} className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="COUPON CODE"
                  disabled={coupon.code !== '' || coupon.loading}
                  value={coupon.code || couponCodeInput}
                  onChange={(e) => setCouponCodeInput(e.target.value)}
                  className={`w-full px-3 h-10 text-xs border rounded-xl bg-[var(--surface-storefront)] uppercase font-semibold tracking-wider outline-none transition-all ${
                    coupon.code
                      ? 'border-[var(--success-storefront)] text-[var(--success-storefront)] bg-emerald-50/20'
                      : 'border-[var(--border-storefront)] focus:border-[var(--brand-storefront)]'
                  }`}
                />
                {coupon.code && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--success-storefront)]">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>
                  </span>
                )}
              </div>
              {coupon.code ? (
                <button
                  type="button"
                  onClick={handleRemoveCoupon}
                  className="tap-44 px-3 h-10 text-xs font-bold rounded-xl border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  Remove
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={coupon.loading || !couponCodeInput.trim()}
                  className="tap-44 px-4 h-10 text-xs font-bold rounded-xl bg-[var(--brand-storefront)] text-white hover:brightness-110 disabled:opacity-40 cursor-pointer"
                >
                  {coupon.loading ? '...' : 'Apply'}
                </button>
              )}
            </form>
            {coupon.error && <p className="text-[10px] text-[var(--danger-storefront)] font-medium pl-1">{coupon.error}</p>}

            {/* Price Calculations */}
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between text-[var(--ink-storefront-secondary)]">
                <span>Subtotal</span>
                <span className="font-bold tabular">{formatPaisa(subtotal)}</span>
              </div>
              <div className="flex justify-between text-[var(--ink-storefront-secondary)]">
                <span>Estimated Shipping</span>
                <span className="font-bold tabular">{formatPaisa(shippingCost)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-[var(--success-storefront)] font-semibold">
                  <span>Coupon Discount ({coupon.code})</span>
                  <span className="tabular">-{formatPaisa(discount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-[var(--border-storefront)] pt-2.5 text-sm font-bold text-[var(--ink-storefront)]">
                <span>Total</span>
                <span className="tabular text-[var(--brand-storefront)]">{formatPaisa(total)}</span>
              </div>
            </div>

            {/* Checkout CTA */}
            <a
              href="/checkout"
              className="press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-storefront)] text-white text-sm font-extrabold shadow-[0_8px_24px_rgba(188,21,69,0.2)] hover:brightness-110 transition cursor-pointer"
            >
              Proceed to checkout
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M9 5l7 7-7 7"/></svg>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

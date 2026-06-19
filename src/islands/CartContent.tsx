import { ArrowRight, Loader2, Minus, Package, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocalCart } from "../hooks/useLocalCart";
import { formatPaisa } from "../lib/money";

const SHIPPING_COST = 7000;
const FREE_SHIPPING_THRESHOLD = 500000;

export function CartContent() {
  const cart = useLocalCart();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <section className="max-w-lg mx-auto text-center py-16">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[var(--surface-soft)]">
          <ShoppingBag className="h-10 w-10 text-[var(--muted)]" />
        </div>
        <h1 className="mt-6 text-2xl font-extrabold">Your cart is empty</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Looks like you haven't added anything yet.</p>
        <a
          href="/"
          className="press mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] text-white px-6 h-12 text-sm font-bold"
        >
          Continue shopping <ArrowRight className="h-4 w-4" />
        </a>
      </section>
    );
  }

  const subtotal = cart.subtotalPaisa;
  const freeShipping = subtotal >= FREE_SHIPPING_THRESHOLD;
  const total = freeShipping ? subtotal : subtotal + SHIPPING_COST;

  return (
    <section className="max-w-2xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Shopping Cart</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{cart.itemCount} item{cart.itemCount === 1 ? "" : "s"}</p>
        </div>
        <button
          type="button"
          onClick={() => cart.clear()}
          className="press tap-44 inline-flex items-center gap-1.5 rounded-full border border-[var(--danger)]/30 text-[var(--danger)] px-4 h-9 text-xs font-bold"
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear cart
        </button>
      </header>

      <ul className="space-y-3">
        {cart.items.map((item) => (
          <li key={item.variantId} className="shell-card flex gap-4 p-4">
            <div className="aspect-square h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--surface-soft)]">
              <img src={item.imageUrl} alt="" width="96" height="96" className="h-full w-full object-cover" loading="lazy" />
            </div>
            <div className="flex flex-1 flex-col justify-between min-w-0">
              <div>
                <p className="font-bold text-sm line-clamp-2">{item.title}</p>
                <p className="text-xs font-semibold text-[var(--muted)] mt-0.5">{item.variantLabel}</p>
                <p className="mt-1 font-extrabold tabular text-sm">{formatPaisa(item.unitPricePaisa * item.quantity)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => cart.updateQuantity(item.variantId, item.quantity - 1)}
                  className="press tap-44 grid place-items-center h-8 w-8 rounded-lg border border-[var(--line)]"
                >
                  {item.quantity > 1 ? <Minus className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
                <span className="w-8 text-center text-sm font-extrabold tabular">{item.quantity}</span>
                <button
                  type="button"
                  onClick={() => cart.updateQuantity(item.variantId, item.quantity + 1)}
                  className="press tap-44 grid place-items-center h-8 w-8 rounded-lg border border-[var(--line)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="shell-card p-5 space-y-3">
        <div className="flex justify-between gap-3 text-sm tabular">
          <span className="text-[var(--muted)]">Subtotal</span>
          <strong>{formatPaisa(subtotal)}</strong>
        </div>
        <div className="flex justify-between gap-3 text-sm tabular">
          <span className="text-[var(--muted)]">Shipping</span>
          <strong>{freeShipping ? <span className="text-[var(--success)]">FREE</span> : formatPaisa(SHIPPING_COST)}</strong>
        </div>
        {!freeShipping && (
          <p className="text-xs text-[var(--muted)]">
            Free shipping on orders over {formatPaisa(FREE_SHIPPING_THRESHOLD)}.
          </p>
        )}
        <div className="flex justify-between gap-3 border-t border-[var(--line)] pt-3 text-base tabular">
          <span className="font-bold">Total</span>
          <strong>{formatPaisa(total)}</strong>
        </div>
        <a
          href="/checkout"
          className="press mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--brand)] text-white px-6 h-12 text-sm font-extrabold shadow-[0_8px_24px_rgba(161,98,7,0.25)]"
        >
          <Package className="h-4 w-4" /> Proceed to checkout
        </a>
      </div>
    </section>
  );
}

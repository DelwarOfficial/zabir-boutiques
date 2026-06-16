import { Check, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { useLocalCart } from "../hooks/useLocalCart";
import type { Paisa } from "../lib/money";

type Props = {
  productId: string;
  variantId: string;
  title: string;
  imageUrl: string;
  variantLabel: string;
  unitPricePaisa: Paisa;
  availableQuantity: number;
  /** "sticky" variant: full-width primary button for PDP mobile bottom bar */
  variant?: "card" | "sticky";
};

function tryVibrate() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate(8); } catch { /* no-op */ }
  }
}

export function AddToCartButton(props: Props) {
  const cart = useLocalCart();
  const [added, setAdded] = useState(false);
  const [pulse, setPulse] = useState(false);
  const disabled = props.availableQuantity <= 0;
  const isSticky = props.variant === "sticky";

  function add() {
    if (disabled) return;
    cart.addItem({
      productId: props.productId,
      variantId: props.variantId,
      title: props.title,
      imageUrl: props.imageUrl,
      variantLabel: props.variantLabel,
      unitPricePaisa: props.unitPricePaisa,
      quantity: 1,
      availableQuantity: props.availableQuantity,
    });
    tryVibrate();
    setAdded(true);
    setPulse(true);
    window.setTimeout(() => setAdded(false), 1400);
    window.setTimeout(() => setPulse(false), 600);
  }

  if (isSticky) {
    return (
      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className={`press tap-44 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold transition-all duration-200 ${
          disabled
            ? "cursor-not-allowed bg-[var(--surface-soft)] text-[var(--muted)]"
            : added
              ? "bg-[var(--success)] text-white"
              : "bg-[var(--brand)] text-white shadow-[0_8px_24px_rgba(161,98,7,0.25)] hover:brightness-110"
        }`}
      >
        {added ? <Check className="h-5 w-5" aria-hidden="true" /> : <ShoppingBag className="h-5 w-5" aria-hidden="true" />}
        {disabled ? "Out of stock" : added ? "Added to cart" : "Add to cart"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={disabled}
      className={`press tap-44 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
        disabled
          ? "cursor-not-allowed border border-[var(--line)] bg-[var(--surface-soft)] text-[var(--muted)]"
          : added
            ? "border border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]"
            : "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--brand)] hover:text-[var(--brand)] hover:bg-[var(--brand-light)]"
      } ${pulse ? "pop" : ""}`}
    >
      {added ? <Check className="h-4 w-4" aria-hidden="true" /> : <ShoppingBag className="h-4 w-4" aria-hidden="true" />}
      {disabled ? "Out of stock" : added ? "Added" : "Add to cart"}
    </button>
  );
}

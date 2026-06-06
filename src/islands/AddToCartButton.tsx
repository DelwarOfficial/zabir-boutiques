import { ShoppingBag } from "lucide-react";
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
};

export function AddToCartButton(props: Props) {
  const cart = useLocalCart();
  const [added, setAdded] = useState(false);
  const disabled = props.availableQuantity <= 0;

  function add() {
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
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1100);
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={disabled}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm font-semibold text-[var(--ink)] transition-all duration-200 hover:border-[var(--brand)] hover:text-[var(--brand)] hover:bg-[var(--brand-light)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--line)] disabled:hover:text-[var(--muted)] disabled:hover:bg-[var(--surface)]"
    >
      <ShoppingBag className="h-4 w-4" aria-hidden="true" />
      {disabled ? "Out of stock" : added ? "Added" : "Add to cart"}
    </button>
  );
}

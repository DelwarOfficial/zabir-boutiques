import { Zap, Loader2 } from "lucide-react";
import { useState } from "react";

type Props = {
  productId: string;
  variantId: string;
  slug?: string;
  quantity?: number;
  disabled?: boolean;
  variant?: "card" | "sticky";
};

export function BuyNowButton({ productId, variantId, quantity = 1, disabled = false, variant = "card" }: Props) {
  const [loading, setLoading] = useState(false);
  const isSticky = variant === "sticky";

  async function handleBuyNow() {
    if (disabled || loading) return;
    setLoading(true);

    try {
      const res = await fetch("/api/buy-now/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          variant_id: variantId,
          quantity,
        }),
      });

      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        session_id?: string;
        redirect_url?: string;
        error?: string;
      };

      if (res.ok && data?.ok && data.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        console.error("[BuyNow] session failed:", data?.error);
        setLoading(false);
      }
    } catch (err) {
      console.error("[BuyNow] network error:", err);
      setLoading(false);
    }
  }

  if (isSticky) {
    return (
      <button
        type="button"
        onClick={handleBuyNow}
        disabled={disabled || loading}
        className={`press tap-44 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold transition-all duration-200 ${
          disabled
            ? "cursor-not-allowed bg-[var(--surface-soft)] text-[var(--muted)]"
            : "bg-[var(--danger)] text-white shadow-[0_8px_24px_rgba(220,38,38,0.25)] hover:brightness-110"
        }`}
      >
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
        {disabled ? "Out of stock" : loading ? "Processing…" : "Buy Now"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleBuyNow}
      disabled={disabled || loading}
      className={`press tap-44 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
        disabled
          ? "cursor-not-allowed border border-[var(--line)] bg-[var(--surface-soft)] text-[var(--muted)]"
          : "border border-[var(--danger)] bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white"
      }`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
      {disabled ? "Out of stock" : loading ? "Processing…" : "Buy Now"}
    </button>
  );
}

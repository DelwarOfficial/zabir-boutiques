import { AlertTriangle, CheckCircle2, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useLocalCart } from "../hooks/useLocalCart";
import { applyOutOfStockUpdate } from "../lib/cart-store";
import { addPaisa, formatPaisa, type Paisa } from "../lib/money";
import { normalizeBangladeshPhone, phoneHelperText } from "../lib/phone";

type DeliveryZone = "inside_dhaka" | "outside_dhaka";
type PaymentMethod = "cod" | "uddoktapay";
type CheckoutStatus =
  | { type: "idle" }
  | { type: "success"; orderNumber: string; redirectUrl?: string }
  | { type: "error"; code: string; message: string };

const SHIPPING_COST: Record<DeliveryZone, Paisa> = {
  inside_dhaka: 7000,
  outside_dhaka: 13000,
};

export function GuestCheckout() {
  const cart = useLocalCart();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [zone, setZone] = useState<DeliveryZone>("inside_dhaka");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cod");
  const [status, setStatus] = useState<CheckoutStatus>({ type: "idle" });

  const normalizedPhone = useMemo(() => normalizeBangladeshPhone(phone), [phone]);
  const shippingPaisa = SHIPPING_COST[zone];
  const totalPaisa = addPaisa([cart.subtotalPaisa, shippingPaisa]);
  const canSubmit = cart.items.length > 0 && name.trim().length >= 2 && normalizedPhone.ok && address.trim().length >= 8 && !isPending;

  function submitCheckout() {
    if (!canSubmit || !normalizedPhone.ok) return;
    setStatus({ type: "idle" });

    startTransition(async () => {
      try {
        const response = await fetch("/api/checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            name: name.trim(),
            phone: normalizedPhone.phone,
            address: address.trim(),
            shipping_zone: zone,
            payment_method: paymentMethod,
            subtotal_paisa: cart.subtotalPaisa,
            delivery_paisa: shippingPaisa,
            discount_paisa: 0,
            total_paisa: totalPaisa,
            items: cart.items.map((item) => ({
              product_id: item.productId,
              variant_id: item.variantId,
              quantity: item.quantity,
              unit_price_paisa: item.unitPricePaisa,
            })),
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          code?: string;
          message?: string;
          order_number?: string;
          checkout_url?: string;
          failed_variant_id?: string;
          available_quantity?: number;
        };

        if (!response.ok || !payload.ok) {
          if (payload.code === "OUT_OF_STOCK" && payload.failed_variant_id) {
            applyOutOfStockUpdate(payload.failed_variant_id, payload.available_quantity ?? 0);
            setStatus({
              type: "error",
              code: "OUT_OF_STOCK",
              message: payload.message || "One cart item just went out of stock. We updated your cart with the latest available quantity.",
            });
            return;
          }
          setStatus({ type: "error", code: payload.code || "CHECKOUT_FAILED", message: payload.message || "Checkout failed. Please try again." });
          return;
        }

        cart.clear();
        setStatus({ type: "success", orderNumber: payload.order_number || "Pending", redirectUrl: payload.checkout_url });
      } catch {
        setStatus({ type: "error", code: "NETWORK_ERROR", message: "Network problem. Your cart is still saved offline on this device." });
      }
    });
  }

  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--brand)]">Guest checkout</p>
        <h1 className="mt-1 text-3xl font-black leading-tight">Place order without login</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Cash on Delivery is selected by default. No OTP, password, or account is required.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <form
          className="shell-card space-y-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            submitCheckout();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm font-black">Customer Name</span>
            <input className="control" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Ayesha Rahman" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-black">Phone Number</span>
            <input
              className={`control ${phone && !normalizedPhone.ok ? "border-[var(--danger)]" : ""}`}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="017XXXXXXXX"
            />
            <span className={`mt-1 block text-xs font-semibold ${normalizedPhone.ok ? "text-[var(--success)]" : phone ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
              {phoneHelperText(phone)}
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-black">Shipping Address</span>
            <textarea className="control min-h-28 resize-none py-3" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="House, road, area, district" />
          </label>

          <fieldset>
            <legend className="mb-2 text-sm font-black">Delivery Zone</legend>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--surface-soft)] p-1">
              {[
                ["inside_dhaka", "Inside Dhaka", 7000],
                ["outside_dhaka", "Outside Dhaka", 13000],
              ].map(([value, label, price]) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => setZone(value as DeliveryZone)}
                  className={`rounded-md px-3 py-3 text-left text-sm font-black transition active:scale-[0.98] ${
                    zone === value ? "bg-white text-[var(--brand)] shadow-sm" : "text-[var(--muted)]"
                  }`}
                >
                  {label}
                  <span className="block text-xs font-bold">{formatPaisa(price as Paisa)}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-black">Payment Method</legend>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["cod", "Cash on Delivery"],
                ["uddoktapay", "UddoktaPay"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPaymentMethod(value as PaymentMethod)}
                  className={`min-h-14 rounded-md border px-3 text-sm font-black transition active:scale-[0.98] ${
                    paymentMethod === value ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--line)] bg-white text-[var(--ink)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          {status.type === "error" ? (
            <div className="flex gap-2 rounded-md bg-red-50 p-3 text-sm font-semibold text-[var(--danger)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{status.message}</span>
            </div>
          ) : null}

          {status.type === "success" ? (
            <div className="flex gap-2 rounded-md bg-green-50 p-3 text-sm font-semibold text-[var(--success)]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Order received. Order number: {status.orderNumber}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-md bg-[var(--brand)] text-base font-black text-white transition active:scale-[0.98] disabled:bg-stone-300 disabled:text-stone-600"
          >
            {isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
            {isPending ? "Reserving stock..." : `Place Order · ${formatPaisa(totalPaisa)}`}
          </button>
        </form>

        <aside className="shell-card h-fit p-4">
          <h2 className="text-lg font-black">Cart Summary</h2>
          {cart.items.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-[var(--line)] p-4 text-center text-sm font-semibold text-[var(--muted)]">Your offline cart is empty.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {cart.items.map((item) => (
                <div key={item.variantId} className="grid grid-cols-[64px_1fr_auto] gap-3">
                  <div className="aspect-square overflow-hidden rounded-md bg-[var(--surface-soft)]">
                    <img src={item.imageUrl} alt="" width="64" height="64" className="h-full w-full object-cover" />
                  </div>
                  <div>
                    <p className="line-clamp-2 text-sm font-black">{item.title}</p>
                    <p className="text-xs font-semibold text-[var(--muted)]">{item.variantLabel}</p>
                    <p className="mt-1 text-sm font-black">{formatPaisa(item.unitPricePaisa * item.quantity)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <button type="button" className="rounded-md border border-[var(--line)] p-1" onClick={() => cart.updateQuantity(item.variantId, item.quantity + 1)} aria-label="Increase quantity">
                      <Plus className="h-4 w-4" />
                    </button>
                    <span className="text-xs font-black">{item.quantity}</span>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--line)] p-1"
                      onClick={() => cart.updateQuantity(item.variantId, item.quantity - 1)}
                      aria-label={item.quantity > 1 ? "Decrease quantity" : "Remove item"}
                    >
                      {item.quantity > 1 ? <Minus className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
            <div className="flex justify-between gap-3">
              <span>Subtotal</span>
              <strong>{formatPaisa(cart.subtotalPaisa)}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span>Shipping</span>
              <strong>{formatPaisa(shippingPaisa)}</strong>
            </div>
            <div className="flex justify-between gap-3 border-t border-[var(--line)] pt-2 text-base">
              <span>Total</span>
              <strong>{formatPaisa(totalPaisa)}</strong>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

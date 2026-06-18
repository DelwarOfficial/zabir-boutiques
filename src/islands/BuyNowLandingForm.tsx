import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, MapPin, Package, ShieldCheck, Truck, User } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { addPaisa, formatPaisa, type Paisa } from "../lib/money";
import { normalizeBangladeshPhone, phoneHelperText } from "../lib/phone";

type DeliveryZone = "inside_dhaka" | "outside_dhaka";
type PaymentMethod = "cod" | "uddoktapay";
type SubmitStatus =
  | { type: "idle" }
  | { type: "success"; orderNumber: string; redirectUrl?: string }
  | { type: "error"; code: string; message: string };

type Props = {
  sessionId: string;
  productName: string;
  variantLabel: string;
  unitPricePaisa: Paisa;
  quantity: number;
  insideDhakaPaisa: Paisa;
  outsideDhakaPaisa: Paisa;
  initialDraft: { name?: string; phone?: string; address?: string; shippingZone?: string } | null;
};

export function BuyNowLandingForm({
  sessionId,
  productName,
  variantLabel,
  unitPricePaisa,
  quantity,
  insideDhakaPaisa,
  outsideDhakaPaisa,
  initialDraft,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(initialDraft?.name ?? "");
  const [phone, setPhone] = useState(initialDraft?.phone ?? "");
  const [address, setAddress] = useState(initialDraft?.address ?? "");
  const [zone, setZone] = useState<DeliveryZone>(
    initialDraft?.shippingZone === "outside_dhaka" ? "outside_dhaka" : "inside_dhaka"
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cod");
  const [status, setStatus] = useState<SubmitStatus>({ type: "idle" });
  const idempotencyKeyRef = useRef<string | null>(null);

  const normalizedPhone = useMemo(() => normalizeBangladeshPhone(phone), [phone]);
  const shippingPaisa = zone === "inside_dhaka" ? insideDhakaPaisa : outsideDhakaPaisa;
  const subtotalPaisa = unitPricePaisa * quantity;
  const totalPaisa = addPaisa([subtotalPaisa, shippingPaisa]);
  const prepaymentRequired = quantity > 2 && paymentMethod === "cod";
  const advancePaisa = prepaymentRequired ? ((totalPaisa + 1) >> 1) : 0;

  const contactValid = name.trim().length >= 2 && normalizedPhone.ok;
  const deliveryValid = address.trim().length >= 8;
  const canSubmit = contactValid && deliveryValid && !isPending;

  function submitOrder() {
    if (!canSubmit || !normalizedPhone.ok) return;
    const phoneE164 = normalizedPhone.phone;
    setStatus({ type: "idle" });

    startTransition(async () => {
      try {
        if (!idempotencyKeyRef.current) {
          idempotencyKeyRef.current = crypto.randomUUID();
        }
        const idempotencyKey = idempotencyKeyRef.current;

        async function postSubmit(method: PaymentMethod | "partial_prepay") {
          return fetch("/api/buy-now/submit", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify({
              session_id: sessionId,
              name: name.trim(),
              phone: phoneE164,
              address: address.trim(),
              shipping_zone: zone,
              payment_method: method,
            }),
          });
        }

        let response = await postSubmit(paymentMethod);
        let payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          code?: string;
          message?: string;
          order_number?: string;
          checkout_url?: string;
        };

        if (response.status === 402 && payload.code === "PREPAYMENT_REQUIRED") {
          response = await postSubmit("partial_prepay");
          payload = (await response.json().catch(() => ({}))) as typeof payload;
        }

        if (response.status === 202) {
          setStatus({
            type: "error",
            code: "CHECKOUT_PROCESSING",
            message: "Your order is still processing. Please wait.",
          });
          return;
        }

        if (!response.ok || !payload.ok) {
          setStatus({
            type: "error",
            code: payload.code || "CHECKOUT_FAILED",
            message: payload.message || "Order failed. Please try again.",
          });
          return;
        }

        idempotencyKeyRef.current = null;
        setStatus({ type: "success", orderNumber: payload.order_number || "Pending", redirectUrl: payload.checkout_url });
        if (payload.checkout_url) {
          window.setTimeout(() => { window.location.href = payload.checkout_url as string; }, 1500);
        }
      } catch {
        setStatus({ type: "error", code: "NETWORK_ERROR", message: "Network problem. Please try again." });
      }
    });
  }

  if (status.type === "success") {
    return (
      <section className="text-center py-8 fade-up">
        <div className="mx-auto h-20 w-20 grid place-items-center rounded-full bg-[var(--success)]/10">
          <CheckCircle2 className="h-10 w-10 text-[var(--success)]" />
        </div>
        <h2 className="mt-4 text-2xl font-extrabold">Order placed!</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Order number</p>
        <p className="mt-1 font-mono text-xl font-bold text-[var(--brand)]">{status.orderNumber}</p>
        <p className="mt-3 text-sm text-[var(--muted)]">Confirmation will reach you via SMS/WhatsApp.</p>
        {status.redirectUrl && (
          <p className="mt-3 text-xs text-[var(--muted)]">Redirecting to payment…</p>
        )}
      </section>
    );
  }

  return (
    <form
      className="shell-card p-4 sm:p-5 space-y-4"
      onSubmit={(e) => { e.preventDefault(); submitOrder(); }}
    >
      {status.type === "error" && (
        <div className="flex gap-2 rounded-xl border border-[var(--danger)] bg-[var(--danger)]/10 p-3 text-sm font-semibold text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{status.message}</span>
        </div>
      )}

      <h2 className="text-base font-extrabold flex items-center gap-2">
        <User className="h-4 w-4 text-[var(--brand)]" /> Your Details
      </h2>

      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Name</span>
        <input className="control" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Ayesha Rahman" />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Phone</span>
        <input
          className={`control ${phone && !normalizedPhone.ok ? "border-[var(--danger)]" : ""}`}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          autoComplete="tel"
          placeholder="017XXXXXXXX"
        />
        <span className={`mt-1 block text-xs font-semibold ${normalizedPhone.ok ? "text-[var(--success)]" : phone ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
          {phoneHelperText(phone)}
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Delivery Address</span>
        <textarea className="control min-h-24 resize-none py-3" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House, road, area, district" />
      </label>

      <fieldset>
        <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1.5">
          <Truck className="h-3.5 w-3.5" /> Delivery Zone
        </legend>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-soft)] p-1">
          {([
            ["inside_dhaka", "Inside Dhaka", insideDhakaPaisa],
            ["outside_dhaka", "Outside Dhaka", outsideDhakaPaisa],
          ] as const).map(([value, label, price]) => (
            <button
              key={value}
              type="button"
              onClick={() => setZone(value)}
              className={`press tap-44 rounded-lg px-3 py-3 text-left text-sm font-bold transition ${
                zone === value ? "bg-[var(--surface)] text-[var(--brand)] shadow-sm" : "text-[var(--muted)]"
              }`}
            >
              {label}
              <span className="block text-xs font-bold tabular">{formatPaisa(price)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> Payment
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["cod", "Cash on Delivery"],
            ["uddoktapay", "UddoktaPay"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPaymentMethod(value)}
              className={`press tap-44 min-h-12 rounded-xl border px-3 text-sm font-bold transition ${
                paymentMethod === value ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {prepaymentRequired && (
        <div className="flex gap-2 rounded-xl border border-[var(--brand)] bg-[var(--brand-light)] p-3 text-sm font-semibold">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" />
          <div>
            <p>Orders with &gt;2 items require 50% advance. Balance on delivery.</p>
            <p className="mt-1 font-extrabold tabular">Advance: {formatPaisa(advancePaisa)} · Balance: {formatPaisa(totalPaisa - advancePaisa)}</p>
          </div>
        </div>
      )}

      <div className="border-t border-[var(--line)] pt-3 space-y-1.5 text-sm tabular">
        <div className="flex justify-between"><span className="text-[var(--muted)]">Subtotal</span><strong>{formatPaisa(subtotalPaisa)}</strong></div>
        <div className="flex justify-between"><span className="text-[var(--muted)]">Shipping</span><strong>{formatPaisa(shippingPaisa)}</strong></div>
        <div className="flex justify-between border-t border-[var(--line)] pt-2 text-base"><span>Total</span><strong>{formatPaisa(totalPaisa)}</strong></div>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="press tap-44 w-full inline-flex items-center justify-center gap-2 rounded-full bg-[var(--brand)] text-white px-5 h-12 text-sm font-extrabold shadow-[0_8px_24px_rgba(161,98,7,0.25)] disabled:opacity-50"
      >
        {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
        {isPending ? "Placing order…" : `Confirm Order · ${formatPaisa(totalPaisa)}`}
      </button>
    </form>
  );
}

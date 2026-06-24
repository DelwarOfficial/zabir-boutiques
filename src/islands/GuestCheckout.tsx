import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, Loader2, MapPin, Minus, Package, Plus, ShieldCheck, Sparkles, Trash2, Truck, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocalCart } from "../hooks/useLocalCart";
import { applyOutOfStockUpdate, readCartSessionId } from "../lib/cart-store";
import { addPaisa, formatPaisa, type Paisa } from "../lib/money";
import { normalizeBangladeshPhone, phoneHelperText } from "../lib/phone";

type DeliveryZone = "inside_dhaka" | "outside_dhaka";
type PaymentMethod = "cod" | "uddoktapay";
type CheckoutStatus =
  | { type: "idle" }
  | { type: "success"; orderNumber: string; redirectUrl?: string }
  | { type: "error"; code: string; message: string };

type StoredCoupon = {
  code?: string;
  discountPaisa?: number;
};

type CouponValidationResponse = {
  ok?: boolean;
  code?: string;
  discountPaisa?: number;
};

type Step = 0 | 1 | 2 | 3;
const STEPS: Array<{ id: Step; label: string; icon: typeof User }> = [
  { id: 0, label: "Contact", icon: User },
  { id: 1, label: "Delivery", icon: MapPin },
  { id: 2, label: "Payment", icon: ShieldCheck },
  { id: 3, label: "Review", icon: Package },
];

export function GuestCheckout({ turnstileSiteKey, insideDhakaPaisa, outsideDhakaPaisa }: { turnstileSiteKey?: string; insideDhakaPaisa?: number; outsideDhakaPaisa?: number }) {
  const cart = useLocalCart();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [zone, setZone] = useState<DeliveryZone>("inside_dhaka");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cod");
  const [status, setStatus] = useState<CheckoutStatus>({ type: "idle" });
  const [step, setStep] = useState<Step>(0);
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const shippingCosts = useMemo<Record<DeliveryZone, Paisa>>(() => ({
    inside_dhaka: (Number.isSafeInteger(insideDhakaPaisa) && insideDhakaPaisa! >= 0 ? insideDhakaPaisa! : 7000) as Paisa,
    outside_dhaka: (Number.isSafeInteger(outsideDhakaPaisa) && outsideDhakaPaisa! >= 0 ? outsideDhakaPaisa! : 13000) as Paisa,
  }), [insideDhakaPaisa, outsideDhakaPaisa]);
  const idempotencyKeyRef = useRef<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('zb-coupon');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as StoredCoupon;
        if (parsed && parsed.code && typeof parsed.discountPaisa === 'number') {
          setCouponCode(parsed.code);
          setCouponDiscount(parsed.discountPaisa);
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (!couponCode) return;
    fetch('/api/checkout/validate-coupon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: couponCode, subtotalPaisa: cart.subtotalPaisa })
    })
      .then(res => res.json() as Promise<CouponValidationResponse>)
      .then(data => {
        if (data.ok && typeof data.code === "string" && typeof data.discountPaisa === "number") {
          setCouponDiscount(data.discountPaisa);
          localStorage.setItem('zb-coupon', JSON.stringify({ code: data.code, discountPaisa: data.discountPaisa }));
        } else {
          setCouponCode("");
          setCouponDiscount(0);
          localStorage.removeItem('zb-coupon');
        }
      })
      .catch(() => {});
  }, [cart.subtotalPaisa, couponCode]);

  useEffect(() => {
    if (!turnstileSiteKey) return;
    const id = 'cf-turnstile-script';
    if (document.getElementById(id)) return;
    const s = document.createElement('script');
    s.id = id;
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=turnstileOnLoad&render=explicit';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }, [turnstileSiteKey]);

  useEffect(() => {
    if (!turnstileSiteKey || !turnstileRef.current) return;
    if (turnstileWidgetId.current) return;
    const win = window as any;
    const render = () => {
      if (!win.turnstile || !turnstileRef.current) { setTimeout(render, 100); return; }
      turnstileWidgetId.current = win.turnstile.render(turnstileRef.current, { sitekey: turnstileSiteKey });
    };
    render();
    return () => {
      if (turnstileWidgetId.current && win.turnstile) {
        try { win.turnstile.remove(turnstileWidgetId.current); } catch {}
        turnstileWidgetId.current = null;
      }
    };
  }, [turnstileSiteKey]);

  const normalizedPhone = useMemo(() => normalizeBangladeshPhone(phone), [phone]);
  const shippingPaisa = shippingCosts[zone];
  const totalPaisa = Math.max(0, addPaisa([cart.subtotalPaisa, shippingPaisa]) - couponDiscount);
  const totalQuantity = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  const prepaymentRequired = totalQuantity > 2 && paymentMethod === "cod";
  const advancePaisa = prepaymentRequired ? ((totalPaisa + 1) >> 1) : 0;

  const contactValid = name.trim().length >= 2 && normalizedPhone.ok;
  const deliveryValid = address.trim().length >= 8;
  const canSubmit = cart.items.length > 0 && contactValid && deliveryValid && !isPending;

  function submitCheckout() {
    if (!canSubmit || !normalizedPhone.ok) return;
    const phoneE164 = normalizedPhone.phone;
    setStatus({ type: "idle" });

    startTransition(async () => {
      try {
        if (!idempotencyKeyRef.current) {
          idempotencyKeyRef.current = crypto.randomUUID();
        }
        const idempotencyKey = idempotencyKeyRef.current;

        async function postCheckout(method: PaymentMethod | "partial_prepay") {
          const turnstile = turnstileWidgetId.current ? (window as any).turnstile?.getResponse(turnstileWidgetId.current) ?? "" : "";
          const sessionId = readCartSessionId();
          return fetch("/api/checkout", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify({
              session_id: sessionId,
              customer: {
                name: name.trim(),
                phone: phoneE164,
                address: address.trim(),
              },
              couponCode: couponCode || undefined,
              payment_method: method,
              shipping_zone: zone,
              turnstile,
            }),
          });
        }

        let response = await postCheckout(paymentMethod);
        let payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          code?: string;
          message?: string;
          order_number?: string;
          checkout_url?: string;
          failed_cart_index?: number;
          available_quantity?: number;
        };

        if (response.status === 402 && payload.code === "PREPAYMENT_REQUIRED") {
          response = await postCheckout("partial_prepay");
          payload = (await response.json().catch(() => ({}))) as typeof payload;
        }

        if (response.status === 202) {
          setStatus({
            type: "error",
            code: "CHECKOUT_PROCESSING",
            message: "Your order is still processing. Please wait a moment and try again.",
          });
          return;
        }

        if (!response.ok || !payload.ok) {
          if (payload.code === "OUT_OF_STOCK" && typeof payload.failed_cart_index === "number" && payload.failed_cart_index >= 0) {
            const failedLine = cart.items[payload.failed_cart_index];
            if (failedLine) {
              applyOutOfStockUpdate(failedLine.variantId, payload.available_quantity ?? 0);
            }
            setStatus({
              type: "error",
              code: "OUT_OF_STOCK",
              message: payload.message || "One cart item just went out of stock. We updated your cart with the latest available quantity.",
            });
            setStep(3);
            return;
          }
          setStatus({ type: "error", code: payload.code || "CHECKOUT_FAILED", message: payload.message || "Checkout failed. Please try again." });
          return;
        }

        idempotencyKeyRef.current = null;
        cart.clear();
        localStorage.removeItem('zb-coupon');
        setStatus({ type: "success", orderNumber: payload.order_number || "Pending", redirectUrl: payload.checkout_url });
        if (payload.checkout_url) {
          window.setTimeout(() => { window.location.href = payload.checkout_url as string; }, 1500);
        }
      } catch {
        setStatus({ type: "error", code: "NETWORK_ERROR", message: "Network problem. Your cart is still saved offline on this device." });
      }
    });
  }

  if (status.type === "success") {
    return (
      <section className="max-w-xl mx-auto text-center py-12 fade-up">
        <div className="relative mx-auto h-24 w-24 grid place-items-center rounded-full bg-[var(--success)]/10 pop">
          <div className="absolute inset-0 rounded-full pulse-ring" aria-hidden="true"></div>
          <CheckCircle2 className="h-12 w-12 text-[var(--success)]" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight">Order placed!</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Your order number is</p>
        <p className="mt-1 font-mono text-xl font-bold text-[var(--brand)] tracking-wider">{status.orderNumber}</p>
        <p className="mt-4 text-sm text-[var(--muted)]">We've kept your cart empty. A confirmation will reach you via SMS/WhatsApp shortly.</p>
        <div className="mt-8 flex flex-col sm:flex-row gap-2 justify-center">
          <a href={`/order-track?number=${status.orderNumber}`} className="press inline-flex items-center justify-center gap-2 rounded-full bg-[var(--brand)] text-white px-6 h-12 text-sm font-bold">
            Track this order <ArrowRight className="h-4 w-4" />
          </a>
          <a href="/" className="press inline-flex items-center justify-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-6 h-12 text-sm font-semibold text-[var(--ink)]">
            Continue shopping
          </a>
        </div>
        {status.redirectUrl && (
          <p className="mt-4 text-xs text-[var(--muted)]">
            <span className="dots" aria-hidden="true"><span></span><span></span><span></span></span> Redirecting to payment…
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-5 fade-up">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-[var(--brand)] flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Guest checkout
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight">Place order without login</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Cash on Delivery by default · No OTP, no account.</p>
        </div>
        <a href="/orders" className="chip press">My orders <ChevronRight className="h-3 w-3" aria-hidden="true" /></a>
      </header>

      {/* Stepper */}
      <ol className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scroll-x-snap" aria-label="Checkout steps">
        {STEPS.map((s, i) => {
          const done = step > s.id;
          const active = step === s.id;
          const Icon = s.icon;
          return (
            <li key={s.id} className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setStep(s.id)}
                className={`press tap-44 inline-flex items-center gap-1.5 rounded-full border px-3 h-9 text-xs font-semibold transition ${
                  active
                    ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-sm"
                    : done
                      ? "border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]"
                      : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                <span className="hidden sm:inline">{i + 1}. {s.label}</span>
                <span className="sm:hidden">{i + 1}</span>
              </button>
              {i < STEPS.length - 1 && (
                <span className={`h-px w-4 sm:w-6 ${done ? "bg-[var(--success)]" : "bg-[var(--line)]"}`} aria-hidden="true"></span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <form
          className="shell-card space-y-4 p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            submitCheckout();
          }}
        >
          {step === 0 && (
            <div className="space-y-4 fade-in">
              <h2 className="text-base font-extrabold flex items-center gap-2"><User className="h-4 w-4 text-[var(--brand)]" aria-hidden="true" /> Contact</h2>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Customer Name</span>
                <input className="control" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Ayesha Rahman" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Phone Number</span>
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
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={!contactValid}
                  className="press tap-44 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] text-white px-5 h-11 text-sm font-bold disabled:opacity-50"
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 fade-in">
              <h2 className="text-base font-extrabold flex items-center gap-2"><Truck className="h-4 w-4 text-[var(--brand)]" aria-hidden="true" /> Delivery</h2>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Shipping Address</span>
                <textarea className="control min-h-28 resize-none py-3" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="House, road, area, district" />
              </label>

              <fieldset>
                <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Delivery Zone</legend>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-soft)] p-1">
                  {([
                    ["inside_dhaka", "Inside Dhaka"],
                    ["outside_dhaka", "Outside Dhaka"],
                  ] as const).map(([value, label]) => { const price = shippingCosts[value]; return (
                    <button
                      key={String(value)}
                      type="button"
                      onClick={() => setZone(value as DeliveryZone)}
                      className={`press tap-44 rounded-lg px-3 py-3 text-left text-sm font-bold transition ${
                        zone === value ? "bg-[var(--surface)] text-[var(--brand)] shadow-sm" : "bg-[var(--surface-soft)] text-[var(--muted)]"
                      }`}
                    >
                      {label}
                      <span className="block text-xs font-bold tabular">{formatPaisa(price as Paisa)}</span>
                    </button>
                  )})}
                </div>
              </fieldset>
              <div className="flex justify-between">
                <button type="button" onClick={() => setStep(0)} className="press tap-44 inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-5 h-11 text-sm font-semibold">Back</button>
                <button type="button" onClick={() => setStep(2)} disabled={!deliveryValid} className="press tap-44 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] text-white px-5 h-11 text-sm font-bold disabled:opacity-50">Continue <ArrowRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 fade-in">
              <h2 className="text-base font-extrabold flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--brand)]" aria-hidden="true" /> Payment</h2>
              <fieldset>
                <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Payment Method</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["cod", "Cash on Delivery"],
                    ["uddoktapay", "UddoktaPay"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPaymentMethod(value as PaymentMethod)}
                      className={`press tap-44 min-h-14 rounded-xl border px-3 text-sm font-bold transition ${
                        paymentMethod === value ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-sm" : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {prepaymentRequired ? (
                <div className="flex gap-2 rounded-xl border border-[var(--brand)] bg-[var(--brand-light)] p-3 text-sm font-semibold text-[var(--ink)] fade-in">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden="true" />
                  <div>
                    <p>Orders with more than two items require a 50% advance to confirm. Balance is paid on delivery.</p>
                    <p className="mt-2 font-extrabold tabular">Advance: {formatPaisa(advancePaisa)} · Balance (COD): {formatPaisa(totalPaisa - advancePaisa)}</p>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-between">
                <button type="button" onClick={() => setStep(1)} className="press tap-44 inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-5 h-11 text-sm font-semibold">Back</button>
                <button type="button" onClick={() => setStep(3)} className="press tap-44 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] text-white px-5 h-11 text-sm font-bold">Review <ArrowRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 fade-in">
              <h2 className="text-base font-extrabold flex items-center gap-2"><Package className="h-4 w-4 text-[var(--brand)]" aria-hidden="true" /> Review</h2>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-[var(--surface-soft)] p-3">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Name</dt>
                  <dd className="font-semibold">{name || "—"}</dd>
                </div>
                <div className="rounded-xl bg-[var(--surface-soft)] p-3">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Phone</dt>
                  <dd className="font-semibold tabular">{normalizedPhone.ok ? normalizedPhone.phone : "—"}</dd>
                </div>
                <div className="rounded-xl bg-[var(--surface-soft)] p-3 sm:col-span-2">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Address</dt>
                  <dd className="font-semibold">{address || "—"}</dd>
                </div>
                <div className="rounded-xl bg-[var(--surface-soft)] p-3">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Zone</dt>
                  <dd className="font-semibold">{zone === "inside_dhaka" ? "Inside Dhaka" : "Outside Dhaka"}</dd>
                </div>
                <div className="rounded-xl bg-[var(--surface-soft)] p-3">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Payment</dt>
                  <dd className="font-semibold">{paymentMethod === "cod" ? "Cash on Delivery" : "UddoktaPay"}</dd>
                </div>
              </dl>

              {turnstileSiteKey ? <div ref={turnstileRef} className="mb-3"></div> : null}

              {status.type === "error" ? (
                <div className="flex gap-2 rounded-xl border border-[var(--danger)] bg-[var(--danger)]/10 p-3 text-sm font-semibold text-[var(--danger)] fade-in">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{status.message}</span>
                </div>
              ) : null}

              <div className="flex justify-between gap-2">
                <button type="button" onClick={() => setStep(2)} className="press tap-44 inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-5 h-11 text-sm font-semibold">Back</button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="press tap-44 inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--brand)] text-white px-5 h-12 text-sm font-extrabold shadow-[0_8px_24px_rgba(161,98,7,0.25)] disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
                  {isPending ? "Reserving stock…" : `Place Order · ${formatPaisa(totalPaisa)}`}
                </button>
              </div>
            </div>
          )}
        </form>

        <aside className="shell-card h-fit p-4 sm:p-5 lg:sticky lg:top-32 fade-in">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold">Cart Summary</h2>
            <span className="chip tabular">{cart.itemCount} item{cart.itemCount === 1 ? "" : "s"}</span>
          </div>
          {cart.items.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-[var(--line)] p-4 text-center text-sm font-semibold text-[var(--muted)]">Your offline cart is empty.</p>
          ) : (
            <ul className="mt-4 space-y-3 stagger">
              {cart.items.map((item) => (
                <li key={item.variantId} className="grid grid-cols-[56px_1fr_auto] gap-3">
                  <div className="aspect-square overflow-hidden rounded-lg bg-[var(--surface-soft)]">
                    <img src={item.imageUrl} alt="" width="56" height="56" loading="lazy" className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-bold">{item.title}</p>
                    <p className="text-[11px] font-semibold text-[var(--muted)] truncate">{item.variantLabel}</p>
                    <p className="mt-1 text-sm font-extrabold tabular">{formatPaisa(item.unitPricePaisa * item.quantity)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <button type="button" className="press tap-44 grid place-items-center h-7 w-7 rounded-md border border-[var(--line)]" onClick={() => cart.updateQuantity(item.variantId, item.quantity + 1)} aria-label="Increase quantity">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-xs font-extrabold tabular">{item.quantity}</span>
                    <button
                      type="button"
                      className="press tap-44 grid place-items-center h-7 w-7 rounded-md border border-[var(--line)]"
                      onClick={() => cart.updateQuantity(item.variantId, item.quantity - 1)}
                      aria-label={item.quantity > 1 ? "Decrease quantity" : "Remove item"}
                    >
                      {item.quantity > 1 ? <Minus className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 space-y-1.5 border-t border-[var(--line)] pt-3 text-sm tabular">
            <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Subtotal</span><strong>{formatPaisa(cart.subtotalPaisa)}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Shipping</span><strong>{formatPaisa(shippingPaisa)}</strong></div>
            {couponDiscount > 0 && (
              <div className="flex justify-between gap-3 text-[var(--success)] font-semibold">
                <span>Discount ({couponCode})</span>
                <span>-{formatPaisa(couponDiscount)}</span>
              </div>
            )}
            <div className="flex justify-between gap-3 border-t border-[var(--line)] pt-2 text-base"><span>Total</span><strong className="text-[var(--brand-storefront)]">{formatPaisa(totalPaisa)}</strong></div>
          </div>
        </aside>
      </div>
    </section>
  );
}

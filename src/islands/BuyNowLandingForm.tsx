import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addPaisa, formatPaisa, type Paisa } from "../lib/money";
import { normalizeBangladeshPhone, phoneHelperText } from "../lib/phone";

type DeliveryZone = "inside_dhaka" | "outside_dhaka";
type SubmitStatus =
  | { type: "idle" }
  | { type: "success"; orderNumber: string; redirectUrl?: string }
  | { type: "error"; code: string; message: string };

type Variant = {
  id: string;
  size: string | null;
  color: string | null;
  pricePaisa: Paisa;
};

type Props = {
  sessionId: string;
  productName: string;
  productImageUrl: string;
  variantLabel: string;
  unitPricePaisa: Paisa;
  quantity: number;
  insideDhakaPaisa: Paisa;
  outsideDhakaPaisa: Paisa;
  initialDraft: { name?: string; phone?: string; address?: string; shippingZone?: string } | null;
  variants: Variant[];
  selectedVariantId: string;
  turnstileSiteKey?: string;
};

export function BuyNowLandingForm({
  sessionId,
  productName,
  productImageUrl,
  variantLabel: initialVariantLabel,
  unitPricePaisa,
  quantity: initialQty,
  insideDhakaPaisa,
  outsideDhakaPaisa,
  initialDraft,
  variants,
  selectedVariantId: initialVariantId,
  turnstileSiteKey,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(initialDraft?.name ?? "");
  const [phone, setPhone] = useState(initialDraft?.phone ?? "");
  const [address, setAddress] = useState(initialDraft?.address ?? "");
  const [note, setNote] = useState("");
  const [zone, setZone] = useState<DeliveryZone>(
    initialDraft?.shippingZone === "outside_dhaka" ? "outside_dhaka" : "inside_dhaka"
  );
  const [status, setStatus] = useState<SubmitStatus>({ type: "idle" });
  const [selectedVariantId, setSelectedVariantId] = useState(initialVariantId || (variants[0]?.id ?? ''));
  const [qty, setQty] = useState(initialQty || 1);
  const idempotencyKeyRef = useRef<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);

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
  const selectedVariant = useMemo(() => variants.find(v => v.id === selectedVariantId) ?? variants[0], [variants, selectedVariantId]);
  const unitPrice = selectedVariant?.pricePaisa ?? unitPricePaisa;
  const shippingPaisa = zone === "inside_dhaka" ? insideDhakaPaisa : outsideDhakaPaisa;
  const subtotalPaisa = unitPrice * qty;
  const totalPaisa = addPaisa([subtotalPaisa, shippingPaisa]);

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

        const response = await fetch("/api/buy-now/submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            session_id: sessionId,
            variant_id: selectedVariantId,
            quantity: qty,
            name: name.trim(),
            phone: phoneE164,
            address: address.trim(),
            shipping_zone: zone,
            payment_method: "cod",
            note: note.trim() || undefined,
            turnstile: turnstileWidgetId.current ? (window as any).turnstile?.getResponse(turnstileWidgetId.current) ?? "" : "",
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          code?: string;
          message?: string;
          order_number?: string;
          checkout_url?: string;
        };

        if (response.status === 202) {
          setStatus({
            type: "error",
            code: "CHECKOUT_PROCESSING",
            message: "অর্ডার প্রসেস হচ্ছে। একটু অপেক্ষা করুন।",
          });
          return;
        }

        if (!response.ok || !payload.ok) {
          setStatus({
            type: "error",
            code: payload.code || "CHECKOUT_FAILED",
            message: payload.message || "অর্ডার ব্যর্থ হয়েছে। আবার চেষ্টা করুন।",
          });
          return;
        }

        idempotencyKeyRef.current = null;
        setStatus({ type: "success", orderNumber: payload.order_number || "Pending", redirectUrl: payload.checkout_url });
        if (payload.checkout_url) {
          window.setTimeout(() => { window.location.href = payload.checkout_url as string; }, 2000);
        }
      } catch {
        setStatus({ type: "error", code: "NETWORK_ERROR", message: "নেটওয়ার্ক সমস্যা। আবার চেষ্টা করুন।" });
      }
    });
  }

  // ── SUCCESS STATE ──
  if (status.type === "success") {
    return (
      <div className="rounded-[22px] border border-[var(--line)] bg-[var(--surface-soft)] p-5 text-center fade-up">
        <div className="mx-auto h-20 w-20 grid place-items-center rounded-full bg-[var(--success)]/10 pop">
          <CheckCircle2 className="h-10 w-10 text-[var(--success)]" />
        </div>
        <h2 className="mt-4 text-2xl font-extrabold">অর্ডার সফল হয়েছে! 🎉</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">অর্ডার নম্বর</p>
        <p className="mt-1 font-mono text-xl font-bold text-[var(--brand)] tracking-wider">{status.orderNumber}</p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          আপনার অর্ডারটি কনফার্ম করা হয়েছে। SMS/WhatsApp এ কনফার্মেশন পাঠানো হবে।
        </p>
        {status.redirectUrl && (
          <p className="mt-2 text-xs text-[var(--muted)]">পেমেন্ট পেজে নিয়ে যাওয়া হচ্ছে…</p>
        )}
      </div>
    );
  }

  // ── ORDER FORM ──
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => { e.preventDefault(); submitOrder(); }}
    >
      {/* Error alert */}
      {status.type === "error" && (
        <div className="flex gap-2 rounded-xl border border-[var(--danger)] bg-[var(--danger)]/10 p-3 text-sm font-semibold text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{status.message}</span>
        </div>
      )}

      {/* ── Selected product card ── */}
      <div className="flex gap-3.5 p-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--line)]">
        <div className="w-16 h-16 rounded-lg overflow-hidden bg-[var(--surface)] shrink-0 border border-[var(--line)]">
          <img src={productImageUrl} alt={productName} width="64" height="64" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1 flex flex-col justify-between">
          <div>
            <p className="text-sm font-extrabold line-clamp-2 text-[var(--ink)] leading-snug">{productName}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {selectedVariant ? [selectedVariant.size, selectedVariant.color].filter(Boolean).join(" / ") : initialVariantLabel}
            </p>
          </div>
          <p className="mt-1 text-base font-extrabold tabular text-[var(--brand)]">{formatPaisa(unitPrice)}</p>
        </div>
      </div>

      {/* ── Size / Variant Selection (Clickable Buttons) ── */}
      {variants && variants.length > 0 && (
        <div className="space-y-2">
          <span className="block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">📏 সাইজ নির্বাচন করুন</span>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => {
              const label = [v.size, v.color].filter(Boolean).join(" - ") || "Standard";
              const isSelected = v.id === selectedVariantId;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedVariantId(v.id)}
                  className={`press tap-44 px-4 py-2 rounded-xl text-xs font-bold border transition duration-200 cursor-pointer ${
                    isSelected
                      ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)] ring-1 ring-[var(--brand)]"
                      : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:border-[var(--brand)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Quantity Stepper ── */}
      <div className="flex items-center justify-between p-3.5 rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Quantity (পরিমাণ)</span>
          <span className="text-[11px] text-[var(--muted)]">কত পিস নিতে চান?</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setQty(q => Math.max(1, q - 1))}
            disabled={qty <= 1}
            className="press tap-44 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-soft)] text-sm font-extrabold hover:bg-[var(--line)] active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            -
          </button>
          <span className="text-base font-extrabold tabular w-8 text-center">{qty}</span>
          <button
            type="button"
            onClick={() => setQty(q => q + 1)}
            className="press tap-44 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-soft)] text-sm font-extrabold hover:bg-[var(--line)] active:scale-95 cursor-pointer"
          >
            +
          </button>
        </div>
      </div>

      {/* ── Billing fields ── */}
      <div className="space-y-3">
        <h3 className="text-sm font-extrabold">📋 অর্ডার তথ্য</h3>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">আপনার নাম *</span>
          <input className="control" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="আপনার নাম লিখুন" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">মোবাইল নম্বর *</span>
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
          <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">ডেলিভারি ঠিকানা *</span>
          <textarea className="control min-h-24 resize-none py-3" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="বাসা নং, রোড, এরিয়া, জেলা" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--muted)]">নোট (ঐচ্ছিক)</span>
          <input className="control" value={note} onChange={(e) => setNote(e.target.value)} placeholder="অর্ডার সম্পর্কে কোনো বিশেষ নির্দেশনা" />
        </label>
      </div>

      {/* ── Shipping zone ── */}
      <fieldset>
        <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">🚚 শিপিং জোন</legend>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["inside_dhaka", "ঢাকা সিটির ভেতরে", insideDhakaPaisa],
            ["outside_dhaka", "ঢাকা সিটির বাইরে", outsideDhakaPaisa],
          ] as const).map(([value, label, price]) => (
            <button
              key={value}
              type="button"
              onClick={() => setZone(value)}
              className={`press tap-44 rounded-xl border p-3 text-left text-sm font-bold transition cursor-pointer ${
                zone === value ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]"
              }`}
            >
              {label}
              <span className="block text-base font-extrabold tabular">{formatPaisa(price)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* ── Order summary table ── */}
      <div className="border-t border-[var(--line)] pt-4 space-y-2 text-sm tabular">
        <h3 className="text-sm font-extrabold mb-2">🧾 অর্ডার সামারি</h3>
        <div className="flex justify-between">
          <span>{productName} × {qty}</span>
          <strong>{formatPaisa(subtotalPaisa)}</strong>
        </div>
        <div className="flex justify-between">
          <span>ডেলিভারি</span>
          <strong>{formatPaisa(shippingPaisa)}</strong>
        </div>
        <div className="flex justify-between border-t border-[var(--line)] pt-2 text-lg">
          <span className="font-extrabold">মোট</span>
          <strong className="font-extrabold text-[var(--brand)]">{formatPaisa(totalPaisa)}</strong>
        </div>
      </div>

      {/* ── Payment: COD ── */}
      <div className="rounded-xl border-2 border-[var(--brand)] bg-[var(--brand)]/5 p-4 text-center">
        <p className="text-base font-extrabold">💵 ক্যাশ অন ডেলিভারি</p>
        <p className="mt-1 text-sm text-[var(--muted)]">পণ্য হাতে পেয়ে মূল্য পরিশোধ করুন</p>
      </div>

      <div className="rounded-xl bg-[var(--surface-soft)] p-3 text-center text-xs font-semibold text-[var(--muted)]">
        অর্ডার সাবমিট করার পর আমাদের টিম কনফার্মেশন কল বা মেসেজ দিতে পারে।
      </div>

      {/* ── Turnstile ── */}
      {turnstileSiteKey ? <div ref={turnstileRef} className="flex justify-center"></div> : null}

      {/* ── Submit ── */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={`press tap-44 w-full inline-flex items-center justify-center gap-2 rounded-full bg-[var(--brand)] text-white px-5 h-14 text-base font-extrabold shadow-[0_8px_24px_rgba(161,98,7,0.25)] disabled:opacity-50 cursor-pointer ${
          canSubmit ? "animate-pulse" : ""
        }`}
      >
        {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
        {isPending ? "অর্ডার প্রসেস হচ্ছে…" : `অর্ডার কনফার্ম করুন · ${formatPaisa(totalPaisa)}`}
      </button>
    </form>
  );
}

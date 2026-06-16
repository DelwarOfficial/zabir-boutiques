/**
 * Resend Email Client [Master_Prompt v7.0 §2.10, §15]
 *
 * Thin wrapper over the Resend SDK. Falls back to a no-op if the
 * RESEND_API_KEY binding is missing. Every send is recorded in
 * `email_log` for bounce tracking.
 *
 * Templates are inlined HTML strings (no React Email dependency) — the
 * platform's needs are modest. If a template grows complex, migrate
 * to React Email per the spec.
 */
type OrderLike = {
  order_number: string;
  name: string;
  phone: string;
  address: string;
  total_paisa: number;
  payment_method: string;
  items?: Array<{ product_name: string; variant_label: string; quantity: number; total_price_paisa: number }>;
};

type EmailType = "order_confirmed" | "payment_confirmed" | "order_shipped" | "order_delivered" | "abandoned_cart_1h" | "abandoned_cart_24h" | "return_confirmed";

function formatTaka(paisa: number): string {
  return `৳${(paisa / 100).toFixed(0)}`;
}

function templateFor(type: EmailType, order: OrderLike): { subject: string; html: string } {
  switch (type) {
    case "order_confirmed":
      return {
        subject: `Order Confirmed — ${order.order_number}`,
        html: `<h1>Thanks for your order!</h1>
<p>Hi ${order.name},</p>
<p>Your order <strong>${order.order_number}</strong> is confirmed. Total: ${formatTaka(order.total_paisa)}. Payment: ${order.payment_method}.</p>
<p>We'll notify you when it ships.</p>
<p>— Zabir Boutiques</p>`,
      };
    case "payment_confirmed":
      return {
        subject: `Payment Received — ${order.order_number}`,
        html: `<h1>Payment received</h1>
<p>We've received your ${order.payment_method.toUpperCase()} payment for order <strong>${order.order_number}</strong>.</p>`,
      };
    case "order_shipped":
      return {
        subject: `Your order is on the way — ${order.order_number}`,
        html: `<h1>Shipped</h1>
<p>Order <strong>${order.order_number}</strong> is on its way to ${order.address}.</p>`,
      };
    case "order_delivered":
      return {
        subject: `Delivered — ${order.order_number}`,
        html: `<h1>Delivered</h1>
<p>Your order <strong>${order.order_number}</strong> was delivered. Thank you!</p>`,
      };
    case "abandoned_cart_1h":
      return {
        subject: "You left items in your cart",
        html: `<h1>Your cart is waiting</h1>
<p>Hi ${order.name}, you started an order earlier. Pick up where you left off?</p>`,
      };
    case "abandoned_cart_24h":
      return {
        subject: "Still interested? Your cart is expiring",
        html: `<h1>Last chance</h1>
<p>Your cart is still saved. Complete checkout before stock runs out.</p>`,
      };
    case "return_confirmed":
      return {
        subject: `Return Confirmed — ${order.order_number}`,
        html: `<h1>Return approved</h1>
<p>Your return for <strong>${order.order_number}</strong> is approved. Refund will be processed within 5 business days.</p>`,
      };
  }
}

export async function sendTransactionalEmail(
  env: { DB: D1Database; RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string },
  to: string,
  type: EmailType,
  order: OrderLike,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!env.RESEND_API_KEY) {
    // No-op in dev: log to email_log so the path is testable.
    await env.DB
      .prepare(
        `INSERT INTO email_log (id, order_id, email_type, recipient, status, sent_at, error_message, created_at)
         VALUES (?1, ?2, ?3, ?4, 'queued', ?5, 'no-resend-key', ?6)`,
      )
      .bind(crypto.randomUUID(), order.order_number, type, to, new Date().toISOString().replace("T", " ").slice(0, 19), new Date().toISOString().replace("T", " ").slice(0, 19))
      .run();
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  const { subject, html } = templateFor(type, order);
  const from = env.RESEND_FROM_EMAIL ?? "Zabir Boutiques <orders@zabirboutiques.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !data.id) {
      const error = data.error?.message ?? `http_${res.status}`;
      await env.DB
        .prepare(
          `INSERT INTO email_log (id, order_id, email_type, recipient, status, sent_at, error_message, created_at)
           VALUES (?1, ?2, ?3, ?4, 'failed', NULL, ?5, ?6)`,
        )
        .bind(crypto.randomUUID(), order.order_number, type, to, error, new Date().toISOString().replace("T", " ").slice(0, 19))
        .run();
      return { ok: false, error };
    }
    await env.DB
      .prepare(
        `INSERT INTO email_log (id, order_id, email_type, recipient, status, sent_at, error_message, created_at)
         VALUES (?1, ?2, ?3, ?4, 'sent', ?5, NULL, ?6)`,
      )
      .bind(crypto.randomUUID(), order.order_number, type, to, new Date().toISOString().replace("T", " ").slice(0, 19), new Date().toISOString().replace("T", " ").slice(0, 19))
      .run();
    return { ok: true, id: data.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : "unknown";
    await env.DB
      .prepare(
        `INSERT INTO email_log (id, order_id, email_type, recipient, status, sent_at, error_message, created_at)
         VALUES (?1, ?2, ?3, ?4, 'failed', NULL, ?5, ?6)`,
      )
      .bind(crypto.randomUUID(), order.order_number, type, to, error, new Date().toISOString().replace("T", " ").slice(0, 19))
      .run();
    return { ok: false, error };
  }
}

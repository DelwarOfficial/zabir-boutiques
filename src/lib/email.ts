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
import { getEmailProvider } from './integrations/email';

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

type AbandonedCartEmail = {
  session_id: string;
  name: string;
  email: string;
  recovery_url: string;
};

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
  env: { DB: D1Database; EMAIL_PROVIDER?: string; RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string },
  to: string,
  type: EmailType,
  order: OrderLike,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { subject, html } = templateFor(type, order);
  const provider = getEmailProvider(env);
  const messageId = crypto.randomUUID();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  try {
    const result = await provider.sendEmail({
      to: [to],
      from_name: "Zabir Boutiques",
      subject,
      html,
      tags: [type],
      custom_args: { order_number: order.order_number, email_type: type },
      message_id: messageId,
    });
    await env.DB
      .prepare(
        `INSERT INTO email_log (id, order_id, email_type, recipient, status, sent_at, error_message, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(messageId, order.order_number, type, to, result.status, result.status === 'sent' ? now : null, result.error_code ?? null, now)
      .run();
    return { ok: result.accepted, id: result.provider_message_id, error: result.error_code };
  } catch (err) {
    const error = err instanceof Error ? err.message : "unknown";
    await env.DB
      .prepare(
        `INSERT INTO email_log (id, order_id, email_type, recipient, status, sent_at, error_message, created_at)
         VALUES (?1, ?2, ?3, ?4, 'failed', NULL, ?5, ?6)`,
      )
      .bind(messageId, order.order_number, type, to, error, now)
      .run();
    return { ok: false, error };
  }
}

export async function sendAbandonedCartEmail(
  env: { DB: D1Database; EMAIL_PROVIDER?: string; RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string },
  payload: AbandonedCartEmail,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const provider = getEmailProvider(env);
  const messageId = crypto.randomUUID();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const subject = 'Complete your Zabir Boutiques checkout';
  const html = `<h1>Your cart is still waiting</h1>
<p>Hi ${payload.name},</p>
<p>You left items in your cart at Zabir Boutiques. Continue checkout before the saved cart goes stale.</p>
<p><a href="${payload.recovery_url}">Resume your checkout</a></p>
<p>If the button does not open your saved cart directly, visit checkout on the same device/browser you used earlier.</p>`;

  try {
    const result = await provider.sendEmail({
      to: [payload.email],
      from_name: 'Zabir Boutiques',
      subject,
      html,
      tags: ['abandoned_cart'],
      custom_args: { session_id: payload.session_id, email_type: 'abandoned_cart' },
      message_id: messageId,
    });
    await env.DB.prepare(
      `INSERT INTO email_log (id, order_id, email_type, recipient, status, sent_at, error_message, created_at)
       VALUES (?1, NULL, 'abandoned_cart', ?2, ?3, ?4, ?5, ?6)`,
    ).bind(
      messageId,
      payload.email,
      result.status,
      result.status === 'sent' ? now : null,
      result.error_code ?? null,
      now,
    ).run();
    return { ok: result.accepted, id: result.provider_message_id, error: result.error_code };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'unknown';
    await env.DB.prepare(
      `INSERT INTO email_log (id, order_id, email_type, recipient, status, sent_at, error_message, created_at)
       VALUES (?1, NULL, 'abandoned_cart', ?2, 'failed', NULL, ?3, ?4)`,
    ).bind(messageId, payload.email, error, now).run();
    return { ok: false, error };
  }
}

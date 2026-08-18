/**
 * POST /api/payments/webhook — UddoktaPay IPN (N-28).
 *
 * The documented contract authenticates with the RT-UDDOKTAPAY-API-KEY header
 * and nothing else. The previous implementation additionally demanded an
 * X-UddoktaPay-Signature HMAC that the provider never sends, so every genuine
 * webhook was rejected with 401 before it could be processed.
 *
 * The body is treated purely as a notification: the invoice id is pulled from
 * it, then the payment state comes from an independent server-to-server
 * verify-payment call. Dedup, queue handoff and the synchronous fallback are
 * unchanged, and share the reconciliation path with the browser callback.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { nowSql } from '../../../lib/dates';
import { safeLog } from '../../../lib/pii-scrubber';
import { parseWebhookPayload, recordWebhookReceipt, resolveWebhookEventId } from '../../../lib/payment-webhook-ingress';
import { UddoktaPayClient, timingSafeEqualString } from '../../../lib/integrations/uddoktapay';
import { bindProviderInvoice, isValidProviderInvoiceId } from '../../../lib/payment-invoice-binding';
import { enqueuePaymentWebhook, processPaymentWebhookMessage } from '../../../queues/consumers';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  // The API key is the only documented webhook credential. It is alphanumeric,
  // not hex, so the comparison uses a byte-wise constant-time comparator
  // rather than the hex-only one (which silently mis-decodes non-hex input).
  if (!env.UDDOKTAPAY_API_KEY) {
    return Response.json({ error: 'Payment provider not configured' }, { status: 503 });
  }
  const ipnKey = context.request.headers.get('RT-UDDOKTAPAY-API-KEY') ?? '';
  if (!timingSafeEqualString(ipnKey, env.UDDOKTAPAY_API_KEY)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawBody = await context.request.text().catch(() => '');
  const body = parseWebhookPayload(rawBody);
  if (!body) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });

  const providerInvoiceId = typeof body.invoice_id === 'string' ? body.invoice_id.trim() : '';
  if (!isValidProviderInvoiceId(providerInvoiceId)) {
    return Response.json({ error: 'Missing or invalid invoice_id' }, { status: 400 });
  }

  // Independent verification. The webhook body is never trusted for status or
  // amount, and the invoice must map back to one of our payments through the
  // metadata we set at charge creation.
  const verified = await new UddoktaPayClient(env).verifyPayment(providerInvoiceId);
  if (verified.status === 'pending') {
    // Not an error: acknowledge so the provider stops retrying this event and
    // let reconciliation pick it up when it settles.
    return Response.json({ received: true, pending: true }, { status: 200 });
  }
  if (verified.status !== 'paid') {
    return Response.json({ received: true, applied: false }, { status: 200 });
  }

  const bound = await bindProviderInvoice(env.DB, providerInvoiceId, verified, now);
  if (!bound.ok) {
    safeLog.warn('[payments/webhook] invoice binding rejected', { code: bound.code });
    const status = bound.code === 'PAYMENT_NOT_FOUND' ? 404 : 409;
    return Response.json({ error: bound.code }, { status });
  }
  const invoiceId = bound.localInvoiceId;

  const eventId = await resolveWebhookEventId(body, rawBody);
  const receipt = await recordWebhookReceipt(env.DB, { eventId, invoiceId, rawBody, now });

  if (receipt === 'payment_not_found') {
    return Response.json({ error: 'Payment not found' }, { status: 404 });
  }
  if (receipt === 'duplicate') {
    return Response.json({ received: true, duplicate: true }, { status: 200 });
  }

  if (env.PAYMENT_WEBHOOKS) {
    await enqueuePaymentWebhook(env, providerInvoiceId, eventId);
    return Response.json({ received: true, queued: true }, { status: 200 });
  }

  const cfContext = context.locals.cfContext;
  if (cfContext?.waitUntil) {
    cfContext.waitUntil(processPaymentWebhookMessage(env, providerInvoiceId));
    return Response.json({ received: true, async: true }, { status: 200 });
  }

  // K-05: neither the queue nor waitUntil is available — a fire-and-forget
  // `void work` here could be killed mid-flight when the Worker instance
  // recycles, silently leaving the payment unapplied with no queue to
  // retry it and a 200 already sent to the provider. Await it directly
  // instead; this is the only path where nothing else guarantees the work
  // completes.
  await processPaymentWebhookMessage(env, providerInvoiceId);
  return Response.json({ received: true, async: false }, { status: 200 });
}

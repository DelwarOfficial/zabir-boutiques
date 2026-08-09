import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { timingSafeEqualHex } from '../../../lib/security';
import { nowSql } from '../../../lib/dates';
import {
  parseWebhookPayload,
  readWebhookSignature,
  recordWebhookReceipt,
  resolveWebhookEventId,
  verifyPaymentWebhookSignature,
} from '../../../lib/payment-webhook-ingress';
import { enqueuePaymentWebhook, processPaymentWebhookMessage } from '../../../queues/consumers';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  const rawBody = await context.request.text().catch(() => '');

  const webhookSecret = env.UDDOKTAPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json({ error: 'Webhook secret not configured' }, { status: 503 });
  }
  const receivedSig = readWebhookSignature(context.request);
  if (!(await verifyPaymentWebhookSignature(rawBody, receivedSig, webhookSecret))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (env.UDDOKTAPAY_API_KEY) {
    const ipnKey = context.request.headers.get('RT-UDDOKTAPAY-API-KEY');
    if (!ipnKey || !timingSafeEqualHex(ipnKey, env.UDDOKTAPAY_API_KEY)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = parseWebhookPayload(rawBody);
  if (!body) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });

  const invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id.trim() : '';
  if (!invoiceId) return Response.json({ error: 'Missing invoice_id' }, { status: 400 });

  const eventId = await resolveWebhookEventId(body, rawBody);
  const receipt = await recordWebhookReceipt(env.DB, { eventId, invoiceId, rawBody, now });

  if (receipt === 'payment_not_found') {
    return Response.json({ error: 'Payment not found' }, { status: 404 });
  }
  if (receipt === 'duplicate') {
    return Response.json({ received: true, duplicate: true }, { status: 200 });
  }

  if (env.PAYMENT_WEBHOOKS) {
    await enqueuePaymentWebhook(env, invoiceId, eventId);
    return Response.json({ received: true, queued: true }, { status: 200 });
  }

  const cfContext = context.locals.cfContext;
  if (cfContext?.waitUntil) {
    cfContext.waitUntil(processPaymentWebhookMessage(env, invoiceId));
    return Response.json({ received: true, async: true }, { status: 200 });
  }

  // K-05: neither the queue nor waitUntil is available — a fire-and-forget
  // `void work` here could be killed mid-flight when the Worker instance
  // recycles, silently leaving the payment unapplied with no queue to
  // retry it and a 200 already sent to the provider. Await it directly
  // instead; this is the only path where nothing else guarantees the work
  // completes.
  await processPaymentWebhookMessage(env, invoiceId);
  return Response.json({ received: true, async: false }, { status: 200 });
}

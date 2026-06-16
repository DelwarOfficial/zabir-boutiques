export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { applyPaymentVerified, verifyUddoktaPayment } from '../../../lib/payments';
import { timingSafeEqualHex } from '../../../lib/security';
import { nowSql } from '../../../lib/dates';
import { enqueuePaymentWebhook } from '../../../queues/consumers';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  // Webhook authenticity: UddoktaPay sends the merchant API key in this header
  // on every IPN. Reject anything that does not carry the correct key before
  // doing any work (server-to-server verification below is the second gate).
  const ipnKey = context.request.headers.get('RT-UDDOKTAPAY-API-KEY');
  if (!ipnKey || !timingSafeEqualHex(ipnKey, env.UDDOKTAPAY_API_KEY)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const invoiceId = body.invoice_id;
  if (!invoiceId) return Response.json({ error: 'Missing invoice_id' }, { status: 400 });

  const { status, amountPaisa, metadata, rawResponse } = await verifyUddoktaPayment(
    invoiceId,
    env.UDDOKTAPAY_API_KEY,
    env.UDDOKTAPAY_BASE_URL,
  );

  if (status !== 'paid') return Response.json({ received: true, status }, { status: 200 });

  // Production path: always enqueue. The queue consumer shares the same
  // applyPaymentVerified code path so there is exactly ONE implementation
  // of "a payment was verified". This closes P0-001 (two divergent code
  // paths producing inconsistent state).
  if (env.PAYMENT_WEBHOOKS) {
    await enqueuePaymentWebhook(env, invoiceId);
    return Response.json({ received: true, status: 'queued' }, { status: 200 });
  }

  // Dev fallback (no queue binding): run the SAME claim-gated function
  // the consumer would run. Idempotency is the payment_events UNIQUE
  // claim, so a retry cannot double-deduct.
  const result = await applyPaymentVerified(
    env,
    invoiceId,
    { amountPaisa, metadata, rawResponse },
    now,
  );

  if (!result.ok) {
    if (result.code === 'PAYMENT_NOT_FOUND') return Response.json({ error: 'Payment not found' }, { status: 404 });
    if (result.code === 'AMOUNT_MISMATCH') return Response.json({ error: 'Payment amount mismatch' }, { status: 409 });
    if (result.code === 'INVOICE_ORDER_MISMATCH') return Response.json({ error: 'Invoice does not belong to this order' }, { status: 409 });
    return Response.json({ error: 'Payment processing failed' }, { status: 500 });
  }

  return Response.json({ received: true, status: result.status, replay: result.alreadyProcessed }, { status: 200 });
}

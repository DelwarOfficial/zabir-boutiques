/**
 * GET /api/payments/callback — UddoktaPay browser return (N-28).
 *
 * The provider sends the customer back here with `invoice_id` in the query
 * string (return_type: "GET"). That query string is NOT proof of payment: it
 * is attacker-supplied, so it is used only as a lookup key. The payment state
 * comes exclusively from a server-to-server /api/verify-payment call, and
 * reconciliation runs through the same applyPaymentVerified path the webhook
 * uses, so a callback and a webhook racing each other cannot double-confirm
 * inventory, re-enqueue mail or duplicate audit events.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { nowSql } from '../../../lib/dates';
import { safeLog } from '../../../lib/pii-scrubber';
import { UddoktaPayClient } from '../../../lib/integrations/uddoktapay';
import { applyPaymentVerified } from '../../../lib/payments';
import { bindProviderInvoice, isValidProviderInvoiceId } from '../../../lib/payment-invoice-binding';

type Outcome = 'paid' | 'pending' | 'failed' | 'cancelled';

function redirect(siteUrl: string, outcome: Outcome, orderNumber?: string | null): Response {
  const url = new URL('/order-track', siteUrl);
  url.searchParams.set('payment', outcome);
  if (orderNumber) url.searchParams.set('order_number', orderNumber);
  return new Response(null, { status: 303, headers: { Location: url.toString() } });
}

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();
  const site = env.PUBLIC_SITE_URL;

  const invoiceId = context.url.searchParams.get('invoice_id');
  if (!isValidProviderInvoiceId(invoiceId)) {
    return redirect(site, 'cancelled');
  }

  const verified = await new UddoktaPayClient(env).verifyPayment(invoiceId);
  if (verified.status === 'pending') return redirect(site, 'pending');
  if (verified.status !== 'paid') return redirect(site, 'failed');

  // The provider must echo back the invoice id we just asked about; anything
  // else means we are looking at someone else's charge.
  if (verified.verifiedInvoiceId && verified.verifiedInvoiceId !== invoiceId) {
    safeLog.warn('[payments/callback] verified invoice mismatch');
    return redirect(site, 'failed');
  }

  const bound = await bindProviderInvoice(env.DB, invoiceId, verified, now);
  if (!bound.ok) {
    safeLog.warn('[payments/callback] invoice binding rejected', { code: bound.code });
    return redirect(site, 'failed');
  }

  const applied = await applyPaymentVerified(env, bound.localInvoiceId, verified, now);
  if (!applied.ok) {
    safeLog.warn('[payments/callback] reconciliation rejected', { code: applied.code });
    return redirect(site, 'failed');
  }

  const order = await env.DB
    .prepare('SELECT order_number FROM orders WHERE id = ?1')
    .bind(bound.orderId)
    .first<{ order_number: string }>();

  return redirect(site, 'paid', order?.order_number ?? null);
}

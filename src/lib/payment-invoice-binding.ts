/**
 * Provider-generated invoice binding (N-28).
 *
 * UddoktaPay generates `invoice_id` itself, at charge creation, and only ever
 * hands it back to us through a callback or a webhook. Our own
 * `payments.invoice_id` is a merchant-generated UUID (SSLCommerz genuinely
 * needs one), so the provider's id lands in `payments.provider_invoice_id` and
 * is bound exactly once — after server-to-server verification, never from a
 * query parameter or a webhook body.
 *
 * The link between the two is `metadata.payment_id`, which we set to our local
 * invoice id at charge creation and which the provider echoes back verbatim in
 * the verification response.
 */
import type { VerifiedPayment } from './payments';

export type BindResult =
  | { ok: true; localInvoiceId: string; orderId: string; alreadyBound: boolean }
  | {
      ok: false;
      code:
        | 'METADATA_MISSING'
        | 'PAYMENT_NOT_FOUND'
        | 'ORDER_MISMATCH'
        | 'AMOUNT_MISMATCH'
        | 'INVOICE_ALREADY_BOUND';
    };

/** Provider invoice ids are opaque; accept only a conservative safe shape. */
const PROVIDER_INVOICE_RE = /^[A-Za-z0-9_-]{6,128}$/;

export function isValidProviderInvoiceId(raw: unknown): raw is string {
  return typeof raw === 'string' && PROVIDER_INVOICE_RE.test(raw);
}

function readMetaString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Match a verified provider charge back to its local payment row and bind the
 * provider invoice id, transaction id and payment method to it.
 *
 * Safe to call concurrently: the bind UPDATE is conditional on the row being
 * unbound or already bound to this same invoice, and `provider_invoice_id`
 * carries a unique index, so a second delivery either no-ops (`alreadyBound`)
 * or is rejected rather than re-pointing an invoice at a different payment.
 */
export async function bindProviderInvoice(
  db: D1Database,
  providerInvoiceId: string,
  verified: VerifiedPayment,
  now: string,
): Promise<BindResult> {
  const localInvoiceId = readMetaString(verified.metadata, 'payment_id');
  const metaOrderId = readMetaString(verified.metadata, 'order_id');
  if (!localInvoiceId || !metaOrderId) return { ok: false, code: 'METADATA_MISSING' };

  const payment = await db
    .prepare('SELECT id, order_id, amount_paisa, provider_invoice_id FROM payments WHERE invoice_id = ?1')
    .bind(localInvoiceId)
    .first<{ id: string; order_id: string; amount_paisa: number; provider_invoice_id: string | null }>();
  if (!payment) return { ok: false, code: 'PAYMENT_NOT_FOUND' };
  if (payment.order_id !== metaOrderId) return { ok: false, code: 'ORDER_MISMATCH' };

  // The charge amount must match to the paisa. A mismatch means the metadata
  // was replayed against a different payment, so nothing gets bound.
  if (verified.amountPaisa !== null && verified.amountPaisa !== payment.amount_paisa) {
    return { ok: false, code: 'AMOUNT_MISMATCH' };
  }

  if (payment.provider_invoice_id && payment.provider_invoice_id !== providerInvoiceId) {
    return { ok: false, code: 'INVOICE_ALREADY_BOUND' };
  }

  const bind = await db
    .prepare(
      `UPDATE payments
          SET provider_invoice_id = ?2,
              transaction_id = COALESCE(?3, transaction_id),
              provider_payment_method = COALESCE(?4, provider_payment_method),
              updated_at = ?5
        WHERE invoice_id = ?1
          AND (provider_invoice_id IS NULL OR provider_invoice_id = ?2)`,
    )
    .bind(localInvoiceId, providerInvoiceId, verified.transactionId, verified.paymentMethod, now)
    .run();

  if (bind.meta.changes !== 1) {
    // Lost the race to a concurrent delivery that bound a different invoice.
    return { ok: false, code: 'INVOICE_ALREADY_BOUND' };
  }

  return {
    ok: true,
    localInvoiceId,
    orderId: payment.order_id,
    alreadyBound: payment.provider_invoice_id === providerInvoiceId,
  };
}

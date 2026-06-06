/**
 * UddoktaPay Payment Integration [v6.8B]
 * - Browser redirects never mark an order paid.
 * - Paid status requires webhook authenticity + server-to-server verification + amount match.
 * - Forward-only payment status transitions.
 *
 * Verify Payment API (POST {baseUrl}/api/verify-payment) returns, among others:
 *   { status: 'COMPLETED'|'PENDING'|..., amount: "100.00", invoice_id, metadata: {...} }
 * `amount` echoes the value passed at charge creation, so it is the authoritative
 * amount to reconcile against our stored payments.amount_paisa.
 */

export type PaymentStatus = 'created' | 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled' | 'expired' | 'refunded';

export interface VerifiedPayment {
  status: PaymentStatus;
  /** Verified amount converted to INTEGER paisa, or null if absent/unparseable. */
  amountPaisa: number | null;
  /** invoice_id echoed by the gateway, or null. */
  verifiedInvoiceId: string | null;
  /** metadata object echoed by the gateway (e.g. { order_id }), or null. */
  metadata: Record<string, unknown> | null;
  rawResponse: string;
}

/** Convert a decimal-taka string like "100.00" to INTEGER paisa. Null on bad input. */
export function takaStringToPaisa(amount: unknown): number | null {
  if (typeof amount !== 'string' && typeof amount !== 'number') return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * Verify payment status server-to-server with UddoktaPay.
 */
export async function verifyUddoktaPayment(
  invoiceId: string,
  apiKey: string,
  baseUrl: string
): Promise<VerifiedPayment> {
  const res = await fetch(`${baseUrl}/api/verify-payment`, {
    method: 'POST',
    headers: {
      'RT-UDDOKTAPAY-API-KEY': apiKey,
      'accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ invoice_id: invoiceId })
  });

  const data = await res.json().catch(() => ({})) as any;
  const rawResponse = JSON.stringify(data);

  const empty: VerifiedPayment = { status: 'failed', amountPaisa: null, verifiedInvoiceId: null, metadata: null, rawResponse };
  if (!res.ok || !data || !data.status) return empty;

  const statusMap: Record<string, PaymentStatus> = {
    'COMPLETED': 'paid',
    'PENDING': 'pending',
    'PROCESSING': 'processing',
    'CANCELLED': 'cancelled',
    'EXPIRED': 'expired'
  };

  return {
    status: statusMap[data.status] ?? 'failed',
    amountPaisa: takaStringToPaisa(data.amount),
    verifiedInvoiceId: typeof data.invoice_id === 'string' ? data.invoice_id : null,
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata as Record<string, unknown> : null,
    rawResponse
  };
}

/**
 * Forward-only payment status update.
 * Will not transition backwards (e.g. paid -> pending).
 */
export async function markPaymentPaid(
  db: D1Database,
  invoiceId: string,
  now: string
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE payments
     SET status = 'paid', verified_at = ?1, updated_at = ?1
     WHERE invoice_id = ?2
       AND status IN ('created','pending','processing')`
  ).bind(now, invoiceId).run();

  return result.meta.changes === 1;
}

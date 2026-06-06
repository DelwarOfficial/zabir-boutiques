/**
 * UddoktaPay Payment Integration [v6.8A]
 * - Browser redirects never mark an order paid.
 * - Paid status requires webhook idempotency + server-to-server verification.
 * - Forward-only payment status transitions.
 */

export type PaymentStatus = 'created' | 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled' | 'expired' | 'refunded';

/**
 * Verify payment status server-to-server with UddoktaPay.
 */
export async function verifyUddoktaPayment(
  invoiceId: string,
  apiKey: string,
  baseUrl: string
): Promise<{ status: PaymentStatus; rawResponse: string }> {
  const res = await fetch(`${baseUrl}/api/verify-payment`, {
    method: 'POST',
    headers: {
      'RT-UDDOKTAPAY-API-KEY': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ invoice_id: invoiceId })
  });

  const data = await res.json() as any;
  const rawResponse = JSON.stringify(data);

  if (!res.ok || !data.status) {
    return { status: 'failed', rawResponse };
  }

  const statusMap: Record<string, PaymentStatus> = {
    'COMPLETED': 'paid',
    'PENDING': 'pending',
    'PROCESSING': 'processing',
    'CANCELLED': 'cancelled',
    'EXPIRED': 'expired'
  };

  return { status: statusMap[data.status] ?? 'failed', rawResponse };
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
       AND status IN ('created','pending','processing')
       AND status IS NOT 'paid'`
  ).bind(now, invoiceId).run();

  return result.meta.changes === 1;
}

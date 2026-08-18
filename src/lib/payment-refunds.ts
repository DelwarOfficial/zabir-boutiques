/**
 * Canonical refund accounting (N-28).
 *
 * The refundable ceiling is what D1 says was actually captured, never what a
 * caller asks for. `payments.refunded_amount_paisa` is the running total, and
 * the claim below moves it in a single conditional UPDATE, so two concurrent
 * refunds cannot each read "nothing refunded yet" and both pass the cap.
 */

export type RefundClaim = { ok: true } | { ok: false; code: 'OVER_REFUND' | 'PAYMENT_NOT_REFUNDABLE' };

/**
 * Reserve `amountPaisa` of a payment's refundable balance.
 *
 * The UPDATE is its own guard: it only matches while the payment is in a
 * refundable state and the new total still fits inside the captured amount.
 */
export async function claimRefundAmount(
  db: D1Database,
  paymentId: string,
  amountPaisa: number,
  now: string,
): Promise<RefundClaim> {
  if (!Number.isInteger(amountPaisa) || amountPaisa <= 0) return { ok: false, code: 'OVER_REFUND' };

  const claimed = await db
    .prepare(
      `UPDATE payments
          SET refunded_amount_paisa = refunded_amount_paisa + ?2, updated_at = ?3
        WHERE id = ?1
          AND status IN ('paid', 'partially_paid', 'partially_refunded')
          AND refunded_amount_paisa + ?2 <= amount_paisa`,
    )
    .bind(paymentId, amountPaisa, now)
    .run();
  if (claimed.meta.changes === 1) return { ok: true };

  const row = await db
    .prepare('SELECT status FROM payments WHERE id = ?1')
    .bind(paymentId)
    .first<{ status: string }>();
  const refundable = row && ['paid', 'partially_paid', 'partially_refunded'].includes(row.status);
  return { ok: false, code: refundable ? 'OVER_REFUND' : 'PAYMENT_NOT_REFUNDABLE' };
}

/** Release a claim when the provider refuses or errors, so a retry is possible. */
export async function releaseRefundAmount(
  db: D1Database,
  paymentId: string,
  amountPaisa: number,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE payments
          SET refunded_amount_paisa = MAX(0, refunded_amount_paisa - ?2), updated_at = ?3
        WHERE id = ?1`,
    )
    .bind(paymentId, amountPaisa, now)
    .run();
}

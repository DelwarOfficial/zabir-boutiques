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

export type PaymentStatus = 'created' | 'pending' | 'processing' | 'paid' | 'partially_paid' | 'failed' | 'cancelled' | 'expired' | 'refunded' | 'partially_refunded';

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

/**
 * Forward-only partial-prepay status update (50% advance captured,
 * balance pending on delivery). Mirrors markPaymentPaid semantics but
 * targets the partial-payment terminal status.
 */
export async function markPaymentPartiallyPaid(
  db: D1Database,
  invoiceId: string,
  now: string
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE payments
     SET status = 'partially_paid', verified_at = ?1, updated_at = ?1
     WHERE invoice_id = ?2
       AND status IN ('created','pending','processing')`
  ).bind(now, invoiceId).run();

  return result.meta.changes === 1;
}

export type ApplyPaymentResult =
  | { ok: true; status: 'paid' | 'partially_paid' | 'paid_over_allocated'; isPartialPrepay: boolean; alreadyProcessed: boolean }
  | { ok: false; code: 'PAYMENT_NOT_FOUND' | 'AMOUNT_MISMATCH' | 'INVOICE_ORDER_MISMATCH' };

/**
 * Single source-of-truth for "a payment has been verified by the gateway".
 * Used by BOTH the inline webhook path (when PAYMENT_WEBHOOKS queue is
 * unavailable) and the queue consumer. Idempotency is enforced by a
 * payment_events UNIQUE(invoice_id, event_type, status) claim that
 * happens BEFORE any other DB write.
 *
 * On success, performs:
 *   1. Claim payment_events row (INSERT OR IGNORE). If 0 changes, return
 *      alreadyProcessed: true (replay-safe).
 *   2. UPDATE payments.status to 'paid' or 'partially_paid', guarded by
 *      current status so a replay cannot re-flip.
 *   3. Confirm stock_reservations and decrement inventory_items in one
 *      atomic batch. Over-allocated variants move the order to
 *      'paid_over_allocated' for staff review.
 *   4. UPDATE orders.payment_status and orders.status to the matching
 *      payment_verified / staff_confirmed state, guarded so a replay
 *      does not re-deduct.
 */
export async function applyPaymentVerified(
  env: { DB: D1Database; VARIANT_INVENTORY?: DurableObjectNamespace; ANALYTICS?: AnalyticsEngineDataset },
  invoiceId: string,
  verified: { amountPaisa: number | null; metadata: Record<string, unknown> | null; rawResponse: string },
  now: string
): Promise<ApplyPaymentResult> {
  const db = env.DB;

  // 1. Read the payment row.
  const payment = await db
    .prepare(`SELECT id, order_id, amount_paisa, status FROM payments WHERE invoice_id = ?1`)
    .bind(invoiceId)
    .first<{ id: string; order_id: string; amount_paisa: number; status: string }>();
  if (!payment) return { ok: false, code: 'PAYMENT_NOT_FOUND' };

  // 2. Amount authority: verified amount MUST match what we charged.
  if (verified.amountPaisa === null || verified.amountPaisa !== payment.amount_paisa) {
    const firstItem = await db
      .prepare(`SELECT variant_id FROM order_items WHERE order_id = ?1 LIMIT 1`)
      .bind(payment.order_id)
      .first<{ variant_id: string }>();
    await db
      .prepare(
        `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(
        crypto.randomUUID(),
        firstItem?.variant_id ?? 'unknown',
        `payment_amount_mismatch invoice=${invoiceId} expected=${payment.amount_paisa} verified=${verified.amountPaisa}. Manual review required.`,
        now,
      )
      .run();
    return { ok: false, code: 'AMOUNT_MISMATCH' };
  }

  // 3. metadata.order_id must match payment.order_id (defends against invoice reuse).
  if (verified.metadata && typeof verified.metadata.order_id === 'string' && verified.metadata.order_id !== payment.order_id) {
    return { ok: false, code: 'INVOICE_ORDER_MISMATCH' };
  }

  // 4. Decide partial vs full. The order is partial-prepay if metadata
  //    tags it OR if the captured amount is less than the order total.
  const orderTotalPaisa = (await db
    .prepare(`SELECT total_paisa FROM orders WHERE id = ?1`)
    .bind(payment.order_id)
    .first<{ total_paisa: number }>())?.total_paisa ?? Infinity;
  const isPartialPrepay =
    verified.metadata?.type === 'partial_prepay' || payment.amount_paisa < orderTotalPaisa;

  // 5. Claim the payment_events row. This is the SOLE idempotency gate.
  const eventResult = await db
    .prepare(
      `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
       VALUES (?1, ?2, ?3, 'webhook', ?4, ?5, ?6)`,
    )
    .bind(
      crypto.randomUUID(),
      payment.id,
      invoiceId,
      isPartialPrepay ? 'partially_paid' : 'paid',
      verified.rawResponse,
      now,
    )
    .run();
  if (eventResult.meta.changes !== 1) {
    return { ok: true, status: isPartialPrepay ? 'partially_paid' : 'paid', isPartialPrepay, alreadyProcessed: true };
  }

  // 6. Forward-only payments.status update. Replay-safe.
  if (isPartialPrepay) {
    await markPaymentPartiallyPaid(db, invoiceId, now);
  } else {
    await markPaymentPaid(db, invoiceId, now);
  }

  // 7. For partial-prepay, the order payment_status advances but the
  //    stock is NOT deducted (advance only — the COD balance will
  //    collect the rest on delivery and staff confirm at that point).
  if (isPartialPrepay) {
    await db
      .prepare(
        `UPDATE orders SET payment_status = 'partially_paid', updated_at = ?2
         WHERE id = ?1 AND payment_status IN ('created','pending','processing')`,
      )
      .bind(payment.order_id, now)
      .run();
    return { ok: true, status: 'partially_paid', isPartialPrepay, alreadyProcessed: false };
  }

  // 8. Full-payment path: confirm reservations + deduct stock + advance
  //    the order. All in one atomic batch.
  const reservations = await db
    .prepare(
      `SELECT id, variant_id, quantity FROM stock_reservations
       WHERE order_id = ?1 AND status = 'active'`,
    )
    .bind(payment.order_id)
    .all<{ id: string; variant_id: string; quantity: number }>();
  const reservationRows = reservations.results ?? [];

  const deductStmts = reservationRows.map((r) =>
    db
      .prepare(
        `UPDATE inventory_items
         SET reserved_quantity = reserved_quantity - ?1,
             quantity = quantity - ?1,
             updated_at = ?3
         WHERE variant_id = ?2 AND reserved_quantity >= ?1 AND quantity >= ?1`,
      )
      .bind(r.quantity, r.variant_id, now),
  );
  const confirmStmts = reservationRows.map((r) =>
    db
      .prepare(`UPDATE stock_reservations SET status = 'confirmed', updated_at = ?2 WHERE id = ?1`)
      .bind(r.id, now),
  );
  const orderStatusStmt = db
    .prepare(
      `UPDATE orders SET payment_status = 'paid', status = 'payment_verified', updated_at = ?2
       WHERE id = ?1 AND status IN ('pending_review','pending_payment')`,
    )
    .bind(payment.order_id, now);

  await db.batch([...deductStmts, ...confirmStmts, orderStatusStmt], { atomic: true });

  // 9. Re-read order status to detect over-allocation. The batch above
  //    is all-or-nothing: if any deduct returned 0 changes, the order
  //    status was NOT updated, and we need to move it to
  //    'paid_over_allocated' for staff review.
  const orderAfter = await db
    .prepare(`SELECT status FROM orders WHERE id = ?1`)
    .bind(payment.order_id)
    .first<{ status: string }>();

  if (orderAfter?.status === 'payment_verified') {
    return { ok: true, status: 'paid', isPartialPrepay: false, alreadyProcessed: false };
  }

  // Over-allocated: reservations were rolled back by the atomic batch.
  // Mark the order paid_over_allocated so staff can source/substitute/
  // refund, and emit a low_stock_alert.
  await db
    .prepare(
      `UPDATE stock_reservations
       SET status = 'cancelled', updated_at = ?2
       WHERE order_id = ?1 AND status = 'active'`,
    )
    .bind(payment.order_id, now)
    .run();
  await db
    .prepare(
      `UPDATE orders SET status = 'paid_over_allocated', updated_at = ?2
       WHERE id = ?1 AND status NOT IN ('paid_over_allocated','cancelled','refunded')`,
    )
    .bind(payment.order_id, now)
    .run();
  await db
    .prepare(
      `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
       VALUES (?1, ?2, 'paid_over_allocated for order. Sourcing/substitution/refund needed.', ?3)`,
    )
    .bind(crypto.randomUUID(), reservationRows[0]?.variant_id ?? 'unknown', now)
    .run();

  return { ok: true, status: 'paid_over_allocated', isPartialPrepay: false, alreadyProcessed: false };
}

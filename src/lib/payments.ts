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
 * Forward-only payment status update. P0-002 audit fix: the
 * `applyPaymentVerified` function inlines the same UPDATE inside its
 * atomic batch so the claim + status + side effects are all-or-nothing.
 * The standalone helper below is kept for callers (e.g. the
 * reconciliation cron) that need to mark a payment paid without
 * re-running the inventory deduct.
 *
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
 * balance pending on delivery). Same atomic-batch rationale as
 * markPaymentPaid above.
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
  env: { DB: D1Database; VARIANT_INVENTORY_DO?: DurableObjectNamespace; ANALYTICS?: AnalyticsEngineDataset },
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

  // 5. Read the active reservations. We need them on the JS side
  //    because D1 has no way to bind a dynamic list of statements
  //    without first materializing it via SELECT.
  const reservations = await db
    .prepare(
      `SELECT id, variant_id, quantity FROM stock_reservations
       WHERE order_id = ?1 AND status = 'active'`,
    )
    .bind(payment.order_id)
    .all<{ id: string; variant_id: string; quantity: number }>();
  const reservationRows = reservations.results ?? [];

  // 6. Build the entire side-effect batch up-front. P0-002 + P0-003:
  //    The payment_events claim, payments.status update, and (for full
  //    payments) the inventory deduct + reservation confirm + order
  //    status advance ALL run in one atomic batch. If anything fails,
  //    the entire batch rolls back — including the claim — so a retry
  //    can re-run everything. This closes the partial-failure window
  //    where a successful claim but a failed status update left
  //    payments.status stuck.
  const eventId = crypto.randomUUID();
  const claimStmt = db
    .prepare(
      `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
       VALUES (?1, ?2, ?3, 'webhook', ?4, ?5, ?6)`,
    )
    .bind(
      eventId,
      payment.id,
      invoiceId,
      isPartialPrepay ? 'partially_paid' : 'paid',
      verified.rawResponse,
      now,
    );

  if (isPartialPrepay) {
    // Partial-prepay path: only the claim, the payments.status update,
    // and the orders.payment_status update. Stock is NOT deducted
    // here — the COD balance on delivery triggers the deduct via
    // staff confirm.
    const partialPaymentStatusStmt = db
      .prepare(
        `UPDATE payments SET status = 'partially_paid', verified_at = ?1, updated_at = ?1
         WHERE invoice_id = ?2 AND status IN ('created','pending','processing')`,
      )
      .bind(now, invoiceId);
    const partialOrderStatusStmt = db
      .prepare(
        `UPDATE orders SET payment_status = 'partially_paid', updated_at = ?2
         WHERE id = ?1 AND payment_status IN ('created','pending','processing')`,
      )
      .bind(payment.order_id, now);

    const partialBatch = await db.batch(
      [claimStmt, partialPaymentStatusStmt, partialOrderStatusStmt],
      { atomic: true },
    );
    const eventResult = partialBatch[0];
    if (eventResult.meta.changes !== 1) {
      return {
        ok: true,
        status: 'partially_paid',
        isPartialPrepay: true,
        alreadyProcessed: true,
      };
    }
    return {
      ok: true,
      status: 'partially_paid',
      isPartialPrepay: true,
      alreadyProcessed: false,
    };
  }

  // Full-payment path: claim + payments.status + deduct + confirm +
  // order.status, all atomic.
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
  const paymentStatusStmt = db
    .prepare(
      `UPDATE payments SET status = 'paid', verified_at = ?1, updated_at = ?1
       WHERE invoice_id = ?2 AND status IN ('created','pending','processing')`,
    )
    .bind(now, invoiceId);
  const orderStatusStmt = db
    .prepare(
      `UPDATE orders SET payment_status = 'paid', status = 'payment_verified', updated_at = ?2
       WHERE id = ?1 AND status IN ('pending_review','pending_payment')`,
    )
    .bind(payment.order_id, now);

  const fullBatch = await db.batch(
    [claimStmt, paymentStatusStmt, ...deductStmts, ...confirmStmts, orderStatusStmt],
    { atomic: true },
  );
  const eventResult = fullBatch[0];
  if (eventResult.meta.changes !== 1) {
    // The claim was a duplicate. Either a concurrent delivery beat us,
    // or a previous delivery already processed this invoice. The
    // `payments.status`, deduct, confirm, and order.status updates
    // that ran in the same batch are no-ops (the WHERE guards in each
    // UPDATE return 0 changes for an already-processed payment).
    return {
      ok: true,
      status: 'paid',
      isPartialPrepay: false,
      alreadyProcessed: true,
    };
  }

  // The batch succeeded. Now re-read the order to detect
  // over-allocation. If the deducts all hit 0 changes, the order
  // status was not updated and we need to move to 'paid_over_allocated'.
  const orderAfter = await db
    .prepare(`SELECT status FROM orders WHERE id = ?1`)
    .bind(payment.order_id)
    .first<{ status: string }>();

  if (orderAfter?.status === 'payment_verified') {
    return {
      ok: true,
      status: 'paid',
      isPartialPrepay: false,
      alreadyProcessed: false,
    };
  }

  // P0-002: over-allocated transition is now a single atomic batch.
  // Either all three statements commit (stock_reservations cancelled,
  // order moved to paid_over_allocated, alert written) or none do.
  await db.batch(
    [
      db
        .prepare(
          `UPDATE stock_reservations
           SET status = 'cancelled', updated_at = ?2
           WHERE order_id = ?1 AND status = 'active'`,
        )
        .bind(payment.order_id, now),
      db
        .prepare(
          `UPDATE orders SET status = 'paid_over_allocated', updated_at = ?2
           WHERE id = ?1 AND status NOT IN ('paid_over_allocated','cancelled','refunded')`,
        )
        .bind(payment.order_id, now),
      db
        .prepare(
          `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
           VALUES (?1, ?2, 'paid_over_allocated for order. Sourcing/substitution/refund needed.', ?3)`,
        )
        .bind(crypto.randomUUID(), reservationRows[0]?.variant_id ?? 'unknown', now),
    ],
    { atomic: true },
  );

  return {
    ok: true,
    status: 'paid_over_allocated',
    isPartialPrepay: false,
    alreadyProcessed: false,
  };
}

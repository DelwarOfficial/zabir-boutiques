/**
 * POST /api/staff/orders/[id]/cancel — Order Cancellation [Master Plan V8 §13.1, K-38]
 *
 * cancelled is a valid target from every non-terminal state in the state
 * machine (order-state-machine.ts), which already declares the required
 * side effects (restock, refund_full). This route is what was missing:
 * nothing previously called canTransition/executed those effects for a
 * cancel — no route existed at all.
 *
 * RBAC: orders.cancel. Refund-triggering cancels also require step-up
 * (same bar as returns/approve.ts, K-24).
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { nowSql } from '../../../../../lib/dates';
import { requireAuth, requirePermission, RbacError } from '../../../../../lib/rbac';
import { requireRecentStaffSession, CriticalAuthError } from '../../../../../lib/critical-auth';
import { prepareAuditLogInsert, clientIp, userAgent } from '../../../../../lib/audit';
import { canTransition, type OrderStatus } from '../../../../../lib/order-state-machine';
import { releaseReservedVariants, reverseConfirm } from '../../../../../lib/inventory';
import { verifyUddoktaPayment } from '../../../../../lib/payments';
import { UddoktaPayClient } from '../../../../../lib/integrations/uddoktapay';
import { safeLog } from '../../../../../lib/pii-scrubber';

// Order statuses at/after which stock has already moved reserved -> sold
// (order-state-machine.ts / inventory.ts §11.3), so cancellation must
// reverse a SALE (reverseConfirm), not release a still-active reservation.
const ALREADY_SOLD_STATUSES = new Set<OrderStatus>(['staff_confirmed', 'packing', 'shipped']);

async function deleteCancelRefundClaim(db: D1Database, paymentId: string, invoiceId: string, createdAt: string): Promise<void> {
  await db
    .prepare("DELETE FROM payment_events WHERE payment_id = ?1 AND invoice_id = ?2 AND event_type = 'refund' AND status = 'refunded' AND created_at = ?3")
    .bind(paymentId, invoiceId, createdAt)
    .run();
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();
  const orderId = context.params.id;
  if (!orderId) return Response.json({ ok: false, code: 'MISSING_ID' }, { status: 400 });

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'orders.cancel');
    await requireRecentStaffSession(context, user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err instanceof Error ? err : new Error(String(err));
  }

  let body: { reason?: string };
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';

  const order = await env.DB
    .prepare(`SELECT id, status, payment_status, advance_paisa FROM orders WHERE id = ?1`)
    .bind(orderId)
    .first<{ id: string; status: string; payment_status: string; advance_paisa: number }>();
  if (!order) return Response.json({ ok: false, code: 'ORDER_NOT_FOUND' }, { status: 404 });

  if (order.status === 'cancelled') {
    return Response.json({ ok: true, status: 'cancelled', alreadyCancelled: true });
  }
  if (!canTransition(order.status as OrderStatus, 'cancelled')) {
    return Response.json({ ok: false, code: 'INVALID_TRANSITION', error: `Cannot cancel from ${order.status}.`, status: order.status }, { status: 409 });
  }

  // Reverse the stock effect. Two disjoint cases per §13.1: an order that
  // never got past reservation just releases; an order already confirmed
  // (reserved -> sold already happened) needs the compensating reversal.
  if (ALREADY_SOLD_STATUSES.has(order.status as OrderStatus)) {
    const reversal = await reverseConfirm(env as unknown as Parameters<typeof reverseConfirm>[0], orderId, now);
    if (!reversal.ok && reversal.reason !== 'already_reversed' && reversal.reason !== 'no_order_items') {
      safeLog.error('[orders/cancel] stock reversal failed', { orderId, reason: reversal.reason });
      return Response.json({ ok: false, code: 'STOCK_REVERSAL_FAILED' }, { status: 500 });
    }
  } else {
    const reservations = await env.DB
      .prepare(`SELECT id, variant_id, quantity FROM stock_reservations WHERE order_id = ?1 AND status = 'active'`)
      .bind(orderId)
      .all<{ id: string; variant_id: string; quantity: number }>();
    const items = (reservations.results ?? []).map((r) => ({ variantId: r.variant_id, qty: r.quantity, reservationId: r.id }));
    if (items.length > 0) {
      await releaseReservedVariants(env as unknown as Parameters<typeof releaseReservedVariants>[0], items, now);
    }
  }

  // Refund settled money, mirroring returns/approve.ts's pattern exactly.
  let refundPaid = 0;
  if (order.payment_status === 'paid' || order.payment_status === 'partially_paid') {
    const payment = await env.DB
      .prepare(`SELECT id, invoice_id, status FROM payments WHERE order_id = ?1 AND status = 'paid' ORDER BY created_at DESC LIMIT 1`)
      .bind(orderId)
      .first<{ id: string; invoice_id: string; status: string }>();

    if (payment && order.advance_paisa > 0) {
      const verified = await verifyUddoktaPayment(payment.invoice_id, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL, env);
      if (verified.status !== 'paid') {
        return Response.json({ ok: false, code: 'REFUND_FAILED_PAYMENT_UNVERIFIED' }, { status: 409 });
      }

      const refundClaim = await env.DB
        .prepare(
          `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
           VALUES (?1, ?2, ?3, 'refund', 'refunded', 'order_cancelled', ?4)`,
        )
        .bind(crypto.randomUUID(), payment.id, payment.invoice_id, now)
        .run();

      if (refundClaim.meta.changes === 1) {
        try {
          const refund = await new UddoktaPayClient(env).refundPayment({
            invoiceId: payment.invoice_id,
            amountPaisa: order.advance_paisa,
            reason: 'order_cancelled',
          });
          if (!refund.ok) {
            await deleteCancelRefundClaim(env.DB, payment.id, payment.invoice_id, now);
            return Response.json({ ok: false, code: 'REFUND_API_FAILED', status: refund.errorCode ?? 'REFUND_FAILED' }, { status: 502 });
          }
          await env.DB.prepare(`UPDATE payments SET status = 'refunded', updated_at = ?2 WHERE id = ?1 AND status = 'paid'`).bind(payment.id, now).run();
          refundPaid = order.advance_paisa;
        } catch (err) {
          await deleteCancelRefundClaim(env.DB, payment.id, payment.invoice_id, now);
          return Response.json({ ok: false, code: 'REFUND_API_ERROR', error: err instanceof Error ? err.message : 'unknown' }, { status: 502 });
        }
      }
    }
  }

  const fromStatus = order.status;
  const orderUpdate = await env.DB
    .prepare(`UPDATE orders SET status = 'cancelled', payment_status = ?2, updated_at = ?3 WHERE id = ?1 AND status = ?4`)
    .bind(orderId, refundPaid > 0 ? 'refunded' : order.payment_status, now, fromStatus)
    .run();
  if (orderUpdate.meta.changes !== 1) {
    return Response.json({ ok: false, code: 'CONCURRENT_UPDATE' }, { status: 409 });
  }
  await env.DB
    .prepare(`INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, note, created_at) VALUES (?1, ?2, ?3, 'cancelled', ?4, ?5, ?6)`)
    .bind(crypto.randomUUID(), orderId, fromStatus, user.id, reason || null, now)
    .run();

  const auditStmt = await prepareAuditLogInsert(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'order.cancel',
    entityType: 'order',
    entityId: orderId,
    metadata: { from_status: fromStatus, reason, refund_paisa: refundPaid },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  }, now);
  await auditStmt.run().catch((e) => safeLog.warn('[orders/cancel] audit log write failed', { error: e instanceof Error ? e.message : String(e) }));

  return Response.json({ ok: true, status: 'cancelled', refund_paisa: refundPaid });
}

import type { APIContext } from "astro";
import { getEnv } from "../../../../../lib/env";
import { nowSql } from "../../../../../lib/dates";
import { requireAuth, requirePermission, RbacError } from "../../../../../lib/rbac";
import { requireRecentStaffSession, CriticalAuthError } from "../../../../../lib/critical-auth";
import { prepareAuditLogInsert, clientIp, userAgent } from "../../../../../lib/audit";
import { canTransition } from "../../../../../lib/order-state-machine";
import { doAdjustStock } from "../../../../../lib/do-client";
import { verifyUddoktaPayment } from "../../../../../lib/payments";
import { claimRefundAmount, releaseRefundAmount } from "../../../../../lib/payment-refunds";
import { UddoktaPayClient } from "../../../../../lib/integrations/uddoktapay";
import { safeLog } from "../../../../../lib/pii-scrubber";

interface ReturnItem {
  variant_id: string;
  quantity: number;
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "payments.refund");
    // K-24: refund-triggering approval requires a recent step-up.
    await requireRecentStaffSession(context, user);
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    if (err instanceof CriticalAuthError) return err.toResponse();
    throw err instanceof Error ? err : new Error(String(err));
  }

  const id = context.params.id;
  if (!id) return Response.json({ ok: false, code: "MISSING_ID" }, { status: 400 });

  const now = nowSql();
  const rr = await env.DB
    .prepare("SELECT id, order_id, items_json, status, refund_amount_paisa FROM return_requests WHERE id = ?1")
    .bind(id)
    .first<{ id: string; order_id: string; items_json: string; status: string; refund_amount_paisa: number }>();
  if (!rr) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  if (rr.status !== "pending") {
    return Response.json({ ok: true, code: "ALREADY_PROCESSED", refund_paisa: rr.refund_amount_paisa, status: rr.status }, { status: 200 });
  }

  const order = await env.DB
    .prepare("SELECT id, status, payment_status, total_paisa, advance_paisa, payment_method FROM orders WHERE id = ?1")
    .bind(rr.order_id)
    .first<{ id: string; status: string; payment_status: string; total_paisa: number; advance_paisa: number; payment_method: string }>();
  if (!order) return Response.json({ ok: false, code: "ORDER_NOT_FOUND" }, { status: 404 });
  if (!canTransition(order.status as Parameters<typeof canTransition>[0], "returned")) {
    return Response.json({ ok: false, code: "INVALID_ORDER_TRANSITION", current: order.status }, { status: 409 });
  }

  let items: ReturnItem[];
  try {
    items = JSON.parse(rr.items_json) as ReturnItem[];
  } catch {
    return Response.json({ ok: false, code: "INVALID_RETURN_ITEMS" }, { status: 500 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ ok: false, code: "EMPTY_RETURN_ITEMS" }, { status: 400 });
  }

  // ── RET-1: reconcile returned items against canonical order_items ──────
  // Never trust the stored items_json for quantity authority. Recalculate
  // from order_items and enforce (a) variant belongs to the order,
  // (b) qty is a positive integer, (c) cumulative approved qty ≤ purchased.
  const orderItems = await env.DB
    .prepare("SELECT variant_id, quantity, unit_price_paisa FROM order_items WHERE order_id = ?1")
    .bind(rr.order_id)
    .all<{ variant_id: string; quantity: number; unit_price_paisa: number }>();
  const purchased = new Map<string, { qty: number; unit: number }>();
  for (const oi of orderItems.results ?? []) {
    purchased.set(oi.variant_id, { qty: oi.quantity, unit: oi.unit_price_paisa });
  }

  const priorReturns = await env.DB
    .prepare(
      "SELECT items_json, status FROM return_requests WHERE order_id = ?1 AND id != ?2 AND status IN ('approved','completed')",
    )
    .bind(rr.order_id, id)
    .all<{ items_json: string; status: string }>();
  const alreadyReturned = new Map<string, number>();
  for (const pr of priorReturns.results ?? []) {
    try {
      const pri = JSON.parse(pr.items_json) as ReturnItem[];
      for (const it of pri) {
        if (it && typeof it.variant_id === "string" && Number.isSafeInteger(it.quantity) && it.quantity > 0) {
          alreadyReturned.set(it.variant_id, (alreadyReturned.get(it.variant_id) ?? 0) + it.quantity);
        }
      }
    } catch {
      // Malformed prior return is ignored for the cap calc; audited separately.
    }
  }

  // ── RET-1 + RET-2: validate items and compute the item-based refund ────
  const priorRefundSum = await env.DB
    .prepare(
      "SELECT COALESCE(SUM(refund_amount_paisa), 0) AS total FROM return_requests WHERE order_id = ?1 AND id != ?2 AND status IN ('approved','completed')",
    )
    .bind(rr.order_id, id)
    .first<{ total: number }>();
  const alreadyRefunded = priorRefundSum?.total ?? 0;

  const payment = await env.DB
    .prepare(
      "SELECT id, invoice_id, amount_paisa, status, transaction_id, provider_payment_method FROM payments WHERE order_id = ?1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(rr.order_id)
    .first<{
      id: string;
      invoice_id: string;
      amount_paisa: number;
      status: string;
      transaction_id: string | null;
      provider_payment_method: string | null;
    }>();
  const paymentAmount = payment?.amount_paisa ?? 0;

  const evaluation = evaluateReturnRequest({
    items,
    purchased,
    alreadyReturned,
    paymentAmount,
    alreadyRefunded,
  });
  if (!evaluation.ok) {
    const status = evaluation.code === "INVALID_RETURN_QUANTITY" ? 400 : 409;
    return Response.json({ ok: false, code: evaluation.code }, { status });
  }
  const refundAmount = evaluation.refundAmount;

  // ── RET-3: commit the approval FIRST (single winner) so concurrent / ────
  // replayed approvals cannot double-restock. Restock below is also made
  // idempotent via a deterministic stock_adjustments id.
  const transition = await env.DB
    .prepare(
      "UPDATE return_requests SET status = 'approved', refund_amount_paisa = ?2, reviewed_by = ?3, updated_at = ?4 WHERE id = ?1 AND status = 'pending'",
    )
    .bind(id, refundAmount, user.id, now)
    .run();
  if (transition.meta.changes !== 1) {
    return Response.json({ ok: true, code: "ALREADY_PROCESSED", refund_paisa: refundAmount, status: "approved" }, { status: 200 });
  }

  // Restock (idempotent per variant via stable adjustment id).
  for (const item of items) {
    const result = await doAdjustStock(
      env,
      item.variant_id,
      item.quantity,
      "return_approved",
      user.id,
      undefined,
      `return:${id}:${item.variant_id}`,
    );
    if (!result.ok) {
      safeLog.error("[returns/approve] Restock failed via DO", { variantId: item.variant_id, error: result.error });
      await env.DB
        .prepare("UPDATE return_requests SET status = 'pending', refund_amount_paisa = 0 WHERE id = ?1 AND status = 'approved'")
        .bind(id)
        .run();
      return Response.json({ ok: false, code: "RESTOCK_FAILED", error: result.error }, { status: 409 });
    }
  }

  // Refund via payment provider when a paid payment exists and amount > 0.
  let refundPaid = 0;
  if (payment && payment.status === "paid" && refundAmount > 0) {
    const verified = await verifyUddoktaPayment(payment.invoice_id, env.UDDOKTAPAY_API_KEY, env.UDDOKTAPAY_BASE_URL, env);
    if (verified.status !== "paid") {
      await env.DB
        .prepare("UPDATE return_requests SET status = 'pending', refund_amount_paisa = 0 WHERE id = ?1 AND status = 'approved'")
        .bind(id)
        .run();
      return Response.json({ ok: false, code: "REFUND_FAILED_PAYMENT_UNVERIFIED" }, { status: 409 });
    }

    const refundClaim = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO payment_events (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
         VALUES (?1, ?2, ?3, 'refund', 'refunded', 'return_approved', ?4)`,
      )
      .bind(crypto.randomUUID(), payment.id, payment.invoice_id, now)
      .run();

    if (refundClaim.meta.changes === 1) {
      // N-28: canonical over-refund cap. The ceiling is payments.amount_paisa
      // minus what D1 already records as refunded, claimed atomically so two
      // concurrent approvals cannot both pass it.
      const amountClaim = await claimRefundAmount(env.DB, payment.id, refundAmount, now);
      if (!amountClaim.ok) {
        await deleteRefundClaim(env.DB, payment.id, payment.invoice_id, now);
        await env.DB
          .prepare("UPDATE return_requests SET status = 'pending', refund_amount_paisa = 0 WHERE id = ?1 AND status = 'approved'")
          .bind(id)
          .run();
        return Response.json({ ok: false, code: amountClaim.code }, { status: 409 });
      }
      try {
        // N-28: the provider refunds against transaction_id + payment_method,
        // never the invoice id. Both come from the verification response above
        // or the copy persisted on the payment row at verification time.
        const transactionId = verified.transactionId ?? payment.transaction_id ?? null;
        const providerMethod = verified.paymentMethod ?? payment.provider_payment_method ?? null;
        if (!transactionId || !providerMethod) {
          await releaseRefundAmount(env.DB, payment.id, refundAmount, now);
          await deleteRefundClaim(env.DB, payment.id, payment.invoice_id, now);
          await env.DB
            .prepare("UPDATE return_requests SET status = 'pending', refund_amount_paisa = 0 WHERE id = ?1 AND status = 'approved'")
            .bind(id)
            .run();
          return Response.json({ ok: false, code: "REFUND_MISSING_TRANSACTION_REFERENCE" }, { status: 409 });
        }
        const refund = await new UddoktaPayClient(env).refundPayment({
          transactionId,
          paymentMethod: providerMethod,
          amountPaisa: refundAmount,
          productName: `Return ${id}`,
          reason: "return_approved",
        });
        if (!refund.ok) {
          await releaseRefundAmount(env.DB, payment.id, refundAmount, now);
          await deleteRefundClaim(env.DB, payment.id, payment.invoice_id, now);
          await env.DB
            .prepare("UPDATE return_requests SET status = 'pending', refund_amount_paisa = 0 WHERE id = ?1 AND status = 'approved'")
            .bind(id)
            .run();
          return Response.json({ ok: false, code: "REFUND_API_FAILED", status: refund.errorCode ?? "REFUND_FAILED" }, { status: 502 });
        }
        await env.DB
          .prepare("UPDATE payments SET status = 'refunded', updated_at = ?2 WHERE id = ?1 AND status = 'paid'")
          .bind(payment.id, now)
          .run();
        refundPaid = refundAmount;
      } catch (err) {
        await releaseRefundAmount(env.DB, payment.id, refundAmount, now);
        await deleteRefundClaim(env.DB, payment.id, payment.invoice_id, now);
        await env.DB
          .prepare("UPDATE return_requests SET status = 'pending', refund_amount_paisa = 0 WHERE id = ?1 AND status = 'approved'")
          .bind(id)
          .run();
        return Response.json({ ok: false, code: "REFUND_API_ERROR", error: err instanceof Error ? err.message : "unknown" }, { status: 502 });
      }
    }
  }

  const fromStatus = order.status;
  const auditStmt = await prepareAuditLogInsert(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "return.approve",
    entityType: "return_request",
    entityId: id,
    metadata: { order_id: rr.order_id, restock_count: items.length, refund_paisa: refundPaid, payment_id: payment?.id ?? null },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request),
  }, now);

  const stateResults = await env.DB.batch([
    env.DB.prepare(
      "UPDATE orders SET status = 'returned', updated_at = ?2 WHERE id = ?1 AND status = ?3",
    ).bind(rr.order_id, now, fromStatus),
    env.DB.prepare(
      `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
       VALUES (?1, ?2, ?3, 'returned', ?4, ?5)`,
    ).bind(crypto.randomUUID(), rr.order_id, fromStatus, user.id, now),
    env.DB.prepare(
      "UPDATE orders SET status = 'refunded', updated_at = ?2 WHERE id = ?1 AND status = 'returned'",
    ).bind(rr.order_id, now),
    env.DB.prepare(
      `INSERT INTO order_status_history (id, order_id, from_status, to_status, changed_by, created_at)
       VALUES (?1, ?2, 'returned', 'refunded', ?3, ?4)`,
    ).bind(crypto.randomUUID(), rr.order_id, user.id, now),
    auditStmt,
  ], { atomic: true });

  if (stateResults[0].meta.changes !== 1 || stateResults[2].meta.changes !== 1) {
    return Response.json({ ok: false, code: "STATE_MACHINE_COMMIT_FAILED" }, { status: 500 });
  }

  return Response.json({ ok: true, refund_paisa: refundPaid, order_status: "refunded" });
}

async function deleteRefundClaim(db: D1Database, paymentId: string, invoiceId: string, createdAt: string): Promise<void> {
  await db
    .prepare("DELETE FROM payment_events WHERE payment_id = ?1 AND invoice_id = ?2 AND event_type = 'refund' AND status = 'refunded' AND created_at = ?3")
    .bind(paymentId, invoiceId, createdAt)
    .run();
}

export interface ReturnEvaluation {
  ok: boolean;
  code?: string;
  refundAmount: number;
  returnedValue: number;
}

/**
 * Pure, server-side reconciliation for a return approval (RET-1 / RET-2).
 *
 * - Every returned item must belong to the order (variant present in `purchased`).
 * - Every returned quantity must be a positive integer.
 * - Cumulative approved quantity (this return + prior approved/completed returns)
 *   must not exceed the purchased quantity for that variant.
 * - The refund is the sum of returned line values, capped at the amount actually
 *   paid minus prior refunds — never the full payment for a partial return.
 *
 * All inputs are canonical records supplied by the caller; nothing here trusts
 * the caller-provided items_json for authority.
 */
export function evaluateReturnRequest(params: {
  items: ReturnItem[];
  purchased: Map<string, { qty: number; unit: number }>;
  alreadyReturned: Map<string, number>;
  paymentAmount: number;
  alreadyRefunded: number;
}): ReturnEvaluation {
  const { items, purchased, alreadyReturned, paymentAmount, alreadyRefunded } = params;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, code: "EMPTY_RETURN_ITEMS", refundAmount: 0, returnedValue: 0 };
  }

  let returnedValue = 0;
  for (const item of items) {
    if (typeof item.variant_id !== "string" || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, code: "INVALID_RETURN_QUANTITY", refundAmount: 0, returnedValue: 0 };
    }
    const p = purchased.get(item.variant_id);
    if (!p) {
      return { ok: false, code: "RETURN_VARIANT_NOT_IN_ORDER", refundAmount: 0, returnedValue: 0 };
    }
    const cumulative = (alreadyReturned.get(item.variant_id) ?? 0) + item.quantity;
    if (cumulative > p.qty) {
      return { ok: false, code: "RETURN_QTY_EXCEEDS_PURCHASED", refundAmount: 0, returnedValue: 0 };
    }
    returnedValue += item.quantity * p.unit;
  }

  const remainingRefundable = Math.max(0, paymentAmount - alreadyRefunded);
  const refundAmount = Math.max(0, Math.min(returnedValue, remainingRefundable));
  return { ok: true, refundAmount, returnedValue };
}


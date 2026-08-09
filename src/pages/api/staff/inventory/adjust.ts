import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission, can } from '../../../../lib/rbac';
import { requireRecentStaffSession } from '../../../../lib/critical-auth';
import { doAdjustStock } from '../../../../lib/do-client';
import { prepareAuditLogInsert } from '../../../../lib/audit';
import { nowSql } from '../../../../lib/dates';
import { safeLog } from '../../../../lib/pii-scrubber';
import { ADJUSTMENT_REASONS } from '../../../../types/inventory';

export async function POST(context: APIContext): Promise<Response> {
  try {
    const user = await requireAuth(context);
    requirePermission(user, 'inventory.adjust');
    // K-24: manual stock adjustment requires a recent step-up.
    await requireRecentStaffSession(context, user);

    const env = getEnv(context);
    let body: { variantId?: string; delta?: number; reason?: string; notes?: string; approvedByStaffId?: string; idempotency_key?: string };

    try {
      body = await context.request.json();
    } catch {
      return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { variantId, delta, reason, notes, approvedByStaffId } = body;

    // Idempotency: without a stable key every network retry generated a
    // fresh crypto.randomUUID() adjustment_id downstream and double-applied
    // the delta. A key is required, same as /api/checkout.
    const idempotencyKey = context.request.headers.get('Idempotency-Key') ?? body.idempotency_key;
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return Response.json({ ok: false, error: 'MISSING_IDEMPOTENCY_KEY' }, { status: 400 });
    }

    if (!variantId || typeof variantId !== 'string') {
      return Response.json({ ok: false, error: 'variantId is required' }, { status: 400 });
    }
    if (!Number.isSafeInteger(delta) || delta === 0) {
      return Response.json({ ok: false, error: 'delta must be a non-zero integer' }, { status: 400 });
    }
    const stockDelta = delta as number;
    if (!reason || typeof reason !== 'string' || !ADJUSTMENT_REASONS.find(r => r.value === reason)) {
      return Response.json({ ok: false, error: 'reason must be a valid adjustment reason' }, { status: 400 });
    }
    if (notes && (typeof notes !== 'string' || notes.length > 1000)) {
      return Response.json({ ok: false, error: 'notes must be under 1000 characters' }, { status: 400 });
    }

    const reasonDef = ADJUSTMENT_REASONS.find(r => r.value === reason)!;
    if (stockDelta > 0 && !reasonDef.isPositive) {
      return Response.json({ ok: false, error: `Reason "${reasonDef.label}" does not allow stock increases` }, { status: 400 });
    }
    if (stockDelta < 0 && !reasonDef.isNegative) {
      return Response.json({ ok: false, error: `Reason "${reasonDef.label}" does not allow stock decreases` }, { status: 400 });
    }

    // Two-person rule: a stock decrease (damage, theft, shrinkage, correction
    // downward) must be approved by a second staff member, not the person
    // requesting it. Prevents a single compromised or careless account from
    // quietly writing off inventory.
    if (stockDelta < 0) {
      if (!approvedByStaffId || typeof approvedByStaffId !== 'string') {
        return Response.json({ ok: false, error: 'APPROVER_REQUIRED' }, { status: 400 });
      }
      if (approvedByStaffId === user.id) {
        return Response.json({ ok: false, error: 'APPROVER_MUST_DIFFER_FROM_REQUESTER' }, { status: 400 });
      }
      const approver = await env.DB
        .prepare('SELECT id, role, is_active FROM staff_users WHERE id = ?1')
        .bind(approvedByStaffId)
        .first<{ id: string; role: string; is_active: number }>();
      if (!approver || !approver.is_active || !can(approver.role as Parameters<typeof can>[0], 'inventory.adjust')) {
        return Response.json({ ok: false, error: 'INVALID_APPROVER' }, { status: 400 });
      }
    }

    const now = nowSql();

    const result = await doAdjustStock(env, variantId, stockDelta, reason, user.id, notes ?? undefined, idempotencyKey);
    if (!result.ok) {
      const status = result.error === 'INSUFFICIENT_STOCK' ? 409 : 500;
      return Response.json({ ok: false, error: result.error, currentStock: result.current_stock }, { status });
    }

    const auditStmt = await prepareAuditLogInsert(env.DB, {
      actorStaffId: user.id,
      actorRole: user.role,
      action: 'inventory.adjust',
      entityType: 'stock_adjustment',
      entityId: result.adjustment_id,
      metadata: {
        variantId,
        delta: stockDelta,
        previousStock: result.previous_stock,
        newStock: result.new_stock,
        reason,
        approvedByStaffId: approvedByStaffId ?? null,
      },
    }, now);
    await auditStmt.run().catch((e) => safeLog.warn('[inventory/adjust] Audit log write failed', { error: e instanceof Error ? e.message : String(e) }));

    return Response.json({
      ok: true,
      variantId,
      previousStock: result.previous_stock,
      newStock: result.new_stock,
      delta: stockDelta,
      adjustmentId: result.adjustment_id,
    });
  } catch (err) {
    safeLog.error('[inventory/adjust] Unexpected error', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

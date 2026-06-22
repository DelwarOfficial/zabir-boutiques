import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission } from '../../../../lib/rbac';
import { doSyncFromD1 } from '../../../../lib/do-client';
import { writeAuditLog } from '../../../../lib/audit';
import { ADJUSTMENT_REASONS } from '../../../../types/inventory';

export async function POST(context: APIContext): Promise<Response> {
  const user = await requireAuth(context);
  requirePermission(user, 'inventory.adjust');

  const env = getEnv(context);
  let body: { variantId?: string; delta?: number; reason?: string; notes?: string };

  try {
    body = await context.request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { variantId, delta, reason, notes } = body;

  if (!variantId || typeof variantId !== 'string') {
    return Response.json({ ok: false, error: 'variantId is required' }, { status: 400 });
  }
  if (!Number.isSafeInteger(delta) || delta === 0) {
    return Response.json({ ok: false, error: 'delta must be a non-zero integer' }, { status: 400 });
  }
  if (!reason || typeof reason !== 'string' || !ADJUSTMENT_REASONS.find(r => r.value === reason)) {
    return Response.json({ ok: false, error: 'reason must be a valid adjustment reason' }, { status: 400 });
  }
  if (notes && (typeof notes !== 'string' || notes.length > 1000)) {
    return Response.json({ ok: false, error: 'notes must be under 1000 characters' }, { status: 400 });
  }

  // Validate reason direction matches delta sign
  const reasonDef = ADJUSTMENT_REASONS.find(r => r.value === reason)!;
  if (delta > 0 && !reasonDef.isPositive) {
    return Response.json({ ok: false, error: `Reason "${reasonDef.label}" does not allow stock increases` }, { status: 400 });
  }
  if (delta < 0 && !reasonDef.isNegative) {
    return Response.json({ ok: false, error: `Reason "${reasonDef.label}" does not allow stock decreases` }, { status: 400 });
  }

  // Verify variant exists
  const variant = await env.DB.prepare(
    `SELECT v.id, i.quantity FROM product_variants v
     LEFT JOIN inventory_items i ON i.variant_id = v.id
     WHERE v.id = ?1 AND v.is_deleted = 0`
  ).bind(variantId).first<{ id: string; quantity: number | null }>();

  if (!variant) {
    return Response.json({ ok: false, error: 'Variant not found or deleted' }, { status: 404 });
  }

  const currentStock = variant.quantity ?? 0;
  const newStock = currentStock + delta;

  if (newStock < 0) {
    return Response.json({
      ok: false,
      error: 'Insufficient stock',
      currentStock,
      delta,
      message: `Cannot remove ${Math.abs(delta)} units — only ${currentStock} available`,
    }, { status: 409 });
  }

  const adjustmentId = crypto.randomUUID();
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // Atomic batch: update stock + record adjustment
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE inventory_items SET quantity = quantity + ?1, updated_at = ?2 WHERE variant_id = ?3`
    ).bind(delta, now, variantId),
    env.DB.prepare(
      `INSERT INTO stock_adjustments (id, variant_id, delta, reason, prev_quantity, new_quantity, notes, adjusted_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    ).bind(adjustmentId, variantId, delta, reason, currentStock, newStock, notes ?? null, user.staffId, now),
  ], { atomic: true });

  // Sync DO with new state
  await doSyncFromD1(env, variantId, newStock, 0, 0);

  // Write audit log
  try {
    await writeAuditLog(env, {
      actorStaffId: user.staffId,
      actorRole: user.role,
      action: 'inventory.adjust',
      entityType: 'stock_adjustment',
      entityId: adjustmentId,
      metadata: {
        variantId,
        delta,
        previousStock: currentStock,
        newStock,
        reason,
      },
    });
  } catch {
    // Non-fatal: audit failure should not block the adjustment
  }

  return Response.json({
    ok: true,
    variantId,
    previousStock: currentStock,
    newStock,
    delta,
    adjustmentId,
  });
}

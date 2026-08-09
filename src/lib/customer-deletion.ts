/**
 * Deferred customer data deletion [Master Plan §13.2-adjacent / N-12]
 *
 * /api/me/delete used to anonymize immediately. The plan wants a 30-day
 * window so a fraud investigation or an open order/return/chargeback isn't
 * cut off mid-flight by the customer's own deletion request. The request
 * is still accepted and phone-verified immediately; only the actual
 * anonymization is deferred to a daily cron, and only proceeds if nothing
 * for that phone is still open when the 30 days are up (checked again on
 * each cron pass — "flag and hold", not silently skip forever).
 */
import { nowSql } from './dates';
import { writeAuditLog } from './audit';

const DELETION_WINDOW_DAYS = 30;

export async function scheduleCustomerDeletion(
  db: D1Database,
  phone: string,
  phoneLocal: string,
  phoneHash: string,
  now: string,
): Promise<{ scheduledFor: string; alreadyScheduled: boolean }> {
  const existing = await db
    .prepare(`SELECT scheduled_for FROM pending_deletions WHERE phone = ?1 AND status = 'pending'`)
    .bind(phone)
    .first<{ scheduled_for: string }>();
  if (existing) {
    return { scheduledFor: existing.scheduled_for, alreadyScheduled: true };
  }

  const scheduledFor = nowSql(new Date(Date.parse(`${now.replace(' ', 'T')}Z`) + DELETION_WINDOW_DAYS * 24 * 60 * 60 * 1000));

  await db
    .prepare(
      `INSERT INTO pending_deletions (id, phone, phone_local, phone_hash, status, requested_at, scheduled_for, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?5, ?5)`,
    )
    .bind(crypto.randomUUID(), phone, phoneLocal, phoneHash, now, scheduledFor)
    .run();

  await writeAuditLog(db, {
    actorStaffId: null,
    actorRole: null,
    action: 'customer.data_deletion_requested',
    entityType: 'customer',
    entityId: `sha256:${phoneHash}`,
    metadata: { scheduled_for: scheduledFor, window_days: DELETION_WINDOW_DAYS },
  });

  return { scheduledFor, alreadyScheduled: false };
}

/**
 * Non-terminal orders, a fraud block, or an open return for this phone
 * hold the deletion — checked fresh on every cron pass, not just at
 * request time, since new activity can appear during the 30-day window.
 */
async function findActiveHold(db: D1Database, phone: string, phoneLocal: string): Promise<string | null> {
  const openOrder = await db
    .prepare(
      `SELECT id FROM orders
       WHERE phone IN (?1, ?2)
         AND status NOT IN ('delivered', 'cancelled', 'refunded')
       LIMIT 1`,
    )
    .bind(phone, phoneLocal)
    .first<{ id: string }>();
  if (openOrder) return 'open_order';

  const blockedOrder = await db
    .prepare(`SELECT id FROM orders WHERE phone IN (?1, ?2) AND fraud_decision = 'blocked' LIMIT 1`)
    .bind(phone, phoneLocal)
    .first<{ id: string }>();
  if (blockedOrder) return 'fraud_blocked_order';

  const openReturn = await db
    .prepare(
      `SELECT rr.id FROM return_requests rr
       JOIN orders o ON o.id = rr.order_id
       WHERE o.phone IN (?1, ?2) AND rr.status = 'pending'
       LIMIT 1`,
    )
    .bind(phone, phoneLocal)
    .first<{ id: string }>();
  if (openReturn) return 'open_return';

  return null;
}

async function anonymizeCustomer(db: D1Database, phone: string, phoneLocal: string, now: string): Promise<void> {
  const anon = `DELETED-${crypto.randomUUID().slice(0, 8)}`;
  await db.batch([
    db.prepare(`UPDATE orders SET name = ?2, address = ?3, email = NULL, phone = ?2, updated_at = ?4 WHERE phone IN (?1, ?5)`).bind(phone, anon, anon, now, phoneLocal),
    db.prepare(`UPDATE cart_activity SET customer_name = ?2, customer_email = NULL, customer_phone = NULL WHERE customer_phone IN (?1, ?3)`).bind(phone, anon, phoneLocal),
  ]);
}

export interface ProcessDeletionsResult {
  processed: number;
  completed: number;
  held: number;
}

/** Daily cron entrypoint: anonymize anything due whose hold has cleared. */
export async function processPendingDeletions(db: D1Database, now: string): Promise<ProcessDeletionsResult> {
  const due = await db
    .prepare(`SELECT id, phone, phone_local, phone_hash FROM pending_deletions WHERE status = 'pending' AND scheduled_for <= ?1`)
    .bind(now)
    .all<{ id: string; phone: string; phone_local: string; phone_hash: string }>();

  let completed = 0;
  let held = 0;

  for (const row of due.results ?? []) {
    const hold = await findActiveHold(db, row.phone, row.phone_local);
    if (hold) {
      held++;
      await db
        .prepare(`UPDATE pending_deletions SET status = 'held', hold_reason = ?2, updated_at = ?3 WHERE id = ?1`)
        .bind(row.id, hold, now)
        .run();
      continue;
    }

    await anonymizeCustomer(db, row.phone, row.phone_local, now);
    await db
      .prepare(`UPDATE pending_deletions SET status = 'completed', completed_at = ?2, updated_at = ?2 WHERE id = ?1`)
      .bind(row.id, now)
      .run();
    await writeAuditLog(db, {
      actorStaffId: null,
      actorRole: null,
      action: 'customer.data_deletion_completed',
      entityType: 'customer',
      entityId: `sha256:${row.phone_hash}`,
      metadata: { anonymized: true },
    });
    completed++;
  }

  // Re-check anything previously held — a hold that has since cleared
  // (order delivered, return resolved) should complete on the next pass
  // rather than waiting for a fresh deletion request.
  const heldRows = await db
    .prepare(`SELECT id, phone, phone_local, phone_hash FROM pending_deletions WHERE status = 'held'`)
    .all<{ id: string; phone: string; phone_local: string; phone_hash: string }>();
  for (const row of heldRows.results ?? []) {
    const hold = await findActiveHold(db, row.phone, row.phone_local);
    if (hold) continue;
    await anonymizeCustomer(db, row.phone, row.phone_local, now);
    await db
      .prepare(`UPDATE pending_deletions SET status = 'completed', completed_at = ?2, updated_at = ?2 WHERE id = ?1`)
      .bind(row.id, now)
      .run();
    await writeAuditLog(db, {
      actorStaffId: null,
      actorRole: null,
      action: 'customer.data_deletion_completed',
      entityType: 'customer',
      entityId: `sha256:${row.phone_hash}`,
      metadata: { anonymized: true, previously_held: true },
    });
    completed++;
  }

  return { processed: (due.results ?? []).length, completed, held };
}

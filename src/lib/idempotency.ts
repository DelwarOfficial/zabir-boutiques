/**
 * Checkout Idempotency [v6.8A]
 * Prevents duplicate checkout retries using idempotency keys.
 *
 * Lifecycle:
 *   1. claimIdempotency  -> row created with status='processing'
 *   2. recordOrderInProgress -> order_id written to the processing row so a
 *      worker retry can find the order and return the same response.
 *   3. completeIdempotency   -> row finalized to 'complete' with response body.
 *   4. failIdempotency       -> row finalized to 'failed' (re-submit allowed).
 */
import { nowSql } from './dates';

export type IdempotencyStatus = 'processing' | 'complete' | 'failed';

export async function checkIdempotency(
  db: D1Database,
  key: string
): Promise<{ exists: true; status: IdempotencyStatus; responseBody: string | null; orderId: string | null } | { exists: false }> {
  const row = await db.prepare(
    `SELECT status, response_body, order_id, expires_at FROM checkout_idempotency WHERE idempotency_key = ?1`
  ).bind(key).first<{ status: IdempotencyStatus; response_body: string | null; order_id: string | null; expires_at: string }>();

  if (!row) return { exists: false };

  const now = nowSql();
  if (row.expires_at < now) return { exists: false };

  return { exists: true, status: row.status, responseBody: row.response_body, orderId: row.order_id };
}

export async function claimIdempotency(
  db: D1Database,
  key: string,
  now: string
): Promise<boolean> {
  const expiresAt = nowSql(new Date(Date.now() + 30 * 60 * 1000));
  try {
    await db.prepare(
      `INSERT INTO checkout_idempotency (idempotency_key, status, created_at, expires_at)
       VALUES (?1, 'processing', ?2, ?3)`
    ).bind(key, now, expiresAt).run();
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist the order_id into the in-flight `processing` row so a worker
 * retry (after a crash between order insert and the 200 response) can
 * reconstruct the success response without a duplicate order.
 */
export async function recordOrderInProgress(
  db: D1Database,
  key: string,
  orderId: string
): Promise<void> {
  await db.prepare(
    `UPDATE checkout_idempotency SET order_id = ?2 WHERE idempotency_key = ?1`
  ).bind(key, orderId).run();
}

export async function completeIdempotency(
  db: D1Database,
  key: string,
  orderId: string,
  responseBody: string
): Promise<void> {
  await db.prepare(
    `UPDATE checkout_idempotency SET status = 'complete', order_id = ?2, response_body = ?3
     WHERE idempotency_key = ?1`
  ).bind(key, orderId, responseBody).run();
}

export async function failIdempotency(db: D1Database, key: string): Promise<void> {
  await db.prepare(
    `UPDATE checkout_idempotency SET status = 'failed' WHERE idempotency_key = ?1`
  ).bind(key).run();
}

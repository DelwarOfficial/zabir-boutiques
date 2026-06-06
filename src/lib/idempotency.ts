/**
 * Checkout Idempotency [v6.8A]
 * Prevents duplicate checkout retries using idempotency keys.
 */
import { nowSql } from './dates';

export type IdempotencyStatus = 'processing' | 'complete' | 'failed';

export async function checkIdempotency(
  db: D1Database,
  key: string
): Promise<{ exists: true; status: IdempotencyStatus; responseBody: string | null } | { exists: false }> {
  const row = await db.prepare(
    `SELECT status, response_body, expires_at FROM checkout_idempotency WHERE idempotency_key = ?1`
  ).bind(key).first<{ status: IdempotencyStatus; response_body: string | null; expires_at: string }>();

  if (!row) return { exists: false };

  // Check if expired
  const now = nowSql();
  if (row.expires_at < now) return { exists: false };

  return { exists: true, status: row.status, responseBody: row.response_body };
}

export async function claimIdempotency(
  db: D1Database,
  key: string,
  now: string
): Promise<boolean> {
  const expiresAt = nowSql(new Date(Date.now() + 30 * 60 * 1000)); // 30 min expiry
  try {
    await db.prepare(
      `INSERT INTO checkout_idempotency (idempotency_key, status, created_at, expires_at)
       VALUES (?1, 'processing', ?2, ?3)`
    ).bind(key, now, expiresAt).run();
    return true;
  } catch {
    return false; // Already claimed
  }
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

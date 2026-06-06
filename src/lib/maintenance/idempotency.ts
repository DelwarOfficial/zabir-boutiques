/**
 * Idempotency Key Cleanup [v6.8A]
 * Remove expired idempotency keys from checkout_idempotency table.
 * Called by daily maintenance cron.
 */

export async function cleanExpiredIdempotencyKeys(db: D1Database): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(
    `DELETE FROM checkout_idempotency WHERE expires_at < ?1`
  ).bind(now).run();
}

/**
 * Log Archive [v6.8A]
 * Monthly 1st 05:00 UTC — Archive old payment_events/fraud_checks/audit logs to R2
 * and prune where safe.
 */

export async function archiveOldEvents(db: D1Database, backups: R2Bucket): Promise<void> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // 90 days ago
    .toISOString().replace('T', ' ').slice(0, 19);
  const date = new Date().toISOString().slice(0, 10);

  // Archive payment_events older than 90 days
  const oldEvents = await db.prepare(
    `SELECT * FROM payment_events WHERE created_at < ?1`
  ).bind(cutoff).all();

  if (oldEvents.results && oldEvents.results.length > 0) {
    await backups.put(
      `backups/archives/${date}-payment-events.json`,
      JSON.stringify(oldEvents.results, null, 2)
    );
    await db.prepare(
      `DELETE FROM payment_events WHERE created_at < ?1`
    ).bind(cutoff).run();
  }

  // Archive old audit_log entries
  const oldAudit = await db.prepare(
    `SELECT * FROM audit_log WHERE created_at < ?1`
  ).bind(cutoff).all();

  if (oldAudit.results && oldAudit.results.length > 0) {
    await backups.put(
      `backups/archives/${date}-audit-log.json`,
      JSON.stringify(oldAudit.results, null, 2)
    );
    await db.prepare(
      `DELETE FROM audit_log WHERE created_at < ?1`
    ).bind(cutoff).run();
  }
}

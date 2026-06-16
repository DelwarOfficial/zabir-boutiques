/**
 * Scheduled Jobs and Cron Dispatch [v6.8D + Master_Prompt v7.0 §2.4, §2.5]
 *
 * Job                                          | Frequency              | Purpose
 * Stock cleanup (10 min TTL)                   | Every 5 min            | Release expired reservations (was every 10 min in v6.8D)
 * Partial-prepay sweeper                        | Every 5 min            | Cancel partially_paid orders > 24h
 * Payment reconciliation                        | Every 15 min           | Fix or auto-cancel stale pending payments
 * Session cleanup                                | Hourly                 | Revoke sessions past absolute expiry
 * AI content budget reset                       | Daily 00:00 UTC        | Daily AI generation cap
 * Inventory reconciliation                      | Daily 03:00 UTC       | Detect drift > 2 units; alert
 * Session / Idempotency cleanup                 | Daily 03:00 UTC        | Mirror to cron entrypoint
 * Audit integrity check + checkpoint            | Daily 03:00 UTC        | Hash-chain verification
 * Tinify retry                                   | Daily 03:30 UTC        | Re-compress any uncompressed images
 * D1 backup to R2 (d1-backup queue)             | Every 6 hours          | DR backup via queue consumer
 * Sitemap generation                            | Daily 02:00 UTC        | sitemap.xml to R2
 * Backup verification on staging                | Weekly Sun 09:00 UTC   | Restore test
 * Monthly archive                                | 1st of month 05:00 UTC | Archive old events to R2
 *
 * GUARDRAIL: Never import runtime cron jobs from root scripts/.
 * Runtime maintenance code lives under src/lib/maintenance/.
 */
import type { Env } from "../env";
import { nowSql } from "./dates";

type CronHandler = (env: Env) => Promise<void>;

export const CRON_HANDLERS: Record<string, CronHandler> = {
  // Every 5 min — reservation cleanup + partial-prepay sweeper.
  "*/5 * * * *": async (env) => {
    const { cleanExpiredReservations } = await import('./inventory');
    const { sweepStalePartialPrepayOrders } = await import('./maintenance/partial-prepay');
    await cleanExpiredReservations(env, 200);
    await sweepStalePartialPrepayOrders(env.DB);
  },
  // Every 15 min — payment reconciliation.
  "*/15 * * * *": async (env) => {
    const { reconcilePendingPayments } = await import('./maintenance/reconciliation');
    await reconcilePendingPayments(env);
  },
  // Hourly — session sweep.
  "0 * * * *": async (env) => {
    const { cleanExpiredSessions } = await import('./sessions');
    await cleanExpiredSessions(env.DB);
  },
  // Daily 00:00 UTC — AI daily budget reset (the counter is daily-bucketed).
  "0 0 * * *": async (env) => {
    const cache = (env as unknown as { CACHE?: KVNamespace }).CACHE;
    if (cache) await cache.delete("AI_DAILY_USAGE_COUNT");
  },
  // Daily 02:00 UTC — sitemap generation.
  "0 2 * * *": async (env) => {
    const { generateSitemap } = await import('./maintenance/sitemap');
    await generateSitemap(env.DB, (env as unknown as { MEDIA?: R2Bucket }).MEDIA);
  },
  // Daily 03:00 UTC — daily maintenance (sessions + idempotency + inventory reconcile + audit).
  "0 3 * * *": async (env) => {
    const { cleanExpiredSessions } = await import('./sessions');
    const { retryUncompressedImages } = await import('./tinify');
    const { cleanExpiredIdempotencyKeys } = await import('./maintenance/idempotency');
    const { recordAuditIntegrityCheck, writeAuditCheckpoint } = await import('./audit');
    const { reconcileInventory } = await import('./maintenance/inventory-reconcile');
    await cleanExpiredSessions(env.DB);
    await retryUncompressedImages(env.DB, (env as unknown as { MEDIA: R2Bucket; TINIFY_API_KEY: string }).MEDIA, (env as unknown as { MEDIA: R2Bucket; TINIFY_API_KEY: string }).TINIFY_API_KEY);
    await cleanExpiredIdempotencyKeys(env.DB);
    await recordAuditIntegrityCheck(env.DB);
    await writeAuditCheckpoint(env.DB);
    await reconcileInventory(env.DB);
  },
  // Every 6 hours — D1 backup via queue.
  "0 */6 * * *": async (env) => {
    const { enqueueD1Backup } = await import('./queue-publisher');
    await enqueueD1Backup(env as unknown as { D1_BACKUP?: Queue }, nowSql());
  },
  // Weekly Sun 09:00 UTC — backup verification.
  "0 9 * * 0": async (env) => {
    const { verifyBackup } = await import('./maintenance/backup');
    await verifyBackup(env.DB, (env as unknown as { BACKUPS?: R2Bucket }).BACKUPS);
  },
  // Monthly 1st 05:00 UTC — archive old events to R2.
  "0 5 1 * *": async (env) => {
    const { archiveOldEvents } = await import('./maintenance/archive');
    const e = env as unknown as { BACKUPS: R2Bucket; AUDIT_LEDGER_SECRET?: string; BACKUP_ENCRYPTION_KEY?: string };
    await archiveOldEvents(env.DB, e.BACKUPS, e.AUDIT_LEDGER_SECRET, e.BACKUP_ENCRYPTION_KEY);
  },
};

export async function dispatchCron(cron: string, env: Env): Promise<void> {
  const handler = CRON_HANDLERS[cron];
  if (!handler) {
    const { safeLog } = await import('./pii-scrubber');
    safeLog.error(`[cron] No handler registered for expression`, { cron });
    return;
  }
  await handler(env);
}

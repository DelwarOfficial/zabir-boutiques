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
  // Every 5 min — partial-prepay sweeper.
  "*/5 * * * *": async (env) => {
    const { sweepStalePartialPrepayOrders } = await import('./maintenance/partial-prepay');
    await sweepStalePartialPrepayOrders(env.DB);
  },
  // Every 15 min — payment reconciliation + abandoned cart scan.
  "*/15 * * * *": async (env) => {
    const { reconcilePendingPayments } = await import('./maintenance/reconciliation');
    const { scanAbandonedCarts } = await import('./maintenance/abandoned-cart');
    await reconcilePendingPayments(env);
    await scanAbandonedCarts(env as unknown as { DB: D1Database; ORDER_EMAILS?: Queue });
  },
  // Hourly — runs hourly, daily, 6-hourly, weekly, and monthly jobs dynamically based on UTC time.
  "0 * * * *": async (env) => {
    const { cleanExpiredReservations } = await import('./inventory');
    const { cleanExpiredSessions } = await import('./sessions');
    await cleanExpiredReservations(env, 200);
    await cleanExpiredSessions(env.DB);

    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcDayOfWeek = now.getUTCDay(); // 0 = Sunday
    const utcDayOfMonth = now.getUTCDate();

    // Daily 00:00 UTC — AI daily budget reset.
    if (utcHour === 0) {
      const cache = (env as unknown as { CACHE?: KVNamespace }).CACHE;
      if (cache) await cache.delete("AI_DAILY_USAGE_COUNT");
    }

    // Daily 02:00 UTC — sitemap generation.
    if (utcHour === 2) {
      const { generateSitemap } = await import('./maintenance/sitemap');
      await generateSitemap(env.DB, (env as unknown as { MEDIA?: R2Bucket }).MEDIA);
    }

    // Daily 03:00 UTC — daily maintenance (sessions + idempotency + inventory reconcile + audit).
    if (utcHour === 3) {
      const { cleanExpiredSessions: cleanSessionsDaily } = await import('./sessions');
      const { retryUncompressedImages } = await import('./tinify');
      const { cleanExpiredIdempotencyKeys } = await import('./maintenance/idempotency');
      const { recordAuditIntegrityCheck, writeAuditCheckpoint } = await import('./audit');
      const { reconcileInventory } = await import('./maintenance/inventory-reconcile');
      await cleanSessionsDaily(env.DB);
      await retryUncompressedImages(env.DB, (env as unknown as { MEDIA: R2Bucket; TINIFY_API_KEY: string }).MEDIA, (env as unknown as { MEDIA: R2Bucket; TINIFY_API_KEY: string }).TINIFY_API_KEY);
      await cleanExpiredIdempotencyKeys(env.DB);
      await recordAuditIntegrityCheck(env.DB);
      await writeAuditCheckpoint(env.DB);
      await reconcileInventory(env.DB, env as unknown as { VARIANT_INVENTORY_DO?: DurableObjectNamespace; ANALYTICS?: AnalyticsEngineDataset });
    }

    // Every 6 hours — D1 backup via queue.
    if (utcHour % 6 === 0) {
      const { enqueueD1Backup } = await import('./queue-publisher');
      await enqueueD1Backup(env as unknown as { D1_BACKUP?: Queue }, nowSql());
    }

    // Weekly Sun 09:00 UTC — backup verification + restore drill.
    if (utcHour === 9 && utcDayOfWeek === 0) {
      const { verifyBackup } = await import('./maintenance/backup');
      const e = env as unknown as { BACKUPS?: R2Bucket; BACKUP_ENCRYPTION_KEY?: string; SESSION_SECRET?: string };
      await verifyBackup(env.DB, e.BACKUPS, e);
    }

    // Monthly 1st 05:00 UTC — archive old events to R2.
    if (utcHour === 5 && utcDayOfMonth === 1) {
      const { archiveOldEvents } = await import('./maintenance/archive');
      const e = env as unknown as { BACKUPS: R2Bucket; AUDIT_LEDGER_SECRET?: string; BACKUP_ENCRYPTION_KEY?: string };
      await archiveOldEvents(env.DB, e.BACKUPS, e.AUDIT_LEDGER_SECRET, e.BACKUP_ENCRYPTION_KEY);
    }
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

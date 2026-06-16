/**
 * Scheduled Jobs and Cron Dispatch [v6.8A]
 *
 * Job                                    | Frequency              | Purpose
 * Reservation cleanup + FraudBD poll     | Every 10 minutes       | Release expired reservations, timeout old fraud_polls (initial decision at checkout is authoritative)
 * Daily maintenance                      | Daily 03:00 UTC        | Session cleanup, Tinify retry, idempotency expiry
 * D1 backup to R2                        | Weekly Sunday 04:00    | Export key business tables to R2
 * Log archive                            | Monthly 1st 05:00      | Archive old events to R2
 *
 * GUARDRAIL: Never import runtime cron jobs from root scripts/.
 * Runtime maintenance code lives under src/lib/maintenance/.
 */
import type { Env } from '../env';

type CronHandler = (env: Env) => Promise<void>;

export const CRON_HANDLERS: Record<string, CronHandler> = {
  '*/10 * * * *': async (env) => {
    const { cleanExpiredReservations } = await import('./inventory');
    const { pollPendingFraudChecks, sweepTimedOutFraudPolls } = await import('./fraud');
    const { sweepStalePartialPrepayOrders } = await import('./maintenance/partial-prepay');
    await cleanExpiredReservations(env.DB);
    await pollPendingFraudChecks(env.DB, env.FRAUDBD_API_KEY);
    await sweepTimedOutFraudPolls(env.DB);
    await sweepStalePartialPrepayOrders(env.DB);
  },
  '0 3 * * *': async (env) => {
    const { cleanExpiredSessions } = await import('./sessions');
    const { retryUncompressedImages } = await import('./tinify');
    const { cleanExpiredIdempotencyKeys } = await import('./maintenance/idempotency');
    const { recordAuditIntegrityCheck, writeAuditCheckpoint } = await import('./audit');
    await cleanExpiredSessions(env.DB);
    await retryUncompressedImages(env.DB, env.MEDIA, env.TINIFY_API_KEY);
    await cleanExpiredIdempotencyKeys(env.DB);
    await recordAuditIntegrityCheck(env.DB);
    await writeAuditCheckpoint(env.DB);
  },
  '0 4 * * 0': async (env) => {
    const { backupD1ToR2 } = await import('./maintenance/backup');
    await backupD1ToR2(env.DB, env.BACKUPS);
  },
  '0 5 1 * *': async (env) => {
    const { archiveOldEvents } = await import('./maintenance/archive');
    await archiveOldEvents(env.DB, env.BACKUPS, env.AUDIT_LEDGER_SECRET);
  }
};

export async function dispatchCron(cron: string, env: Env): Promise<void> {
  const handler = CRON_HANDLERS[cron];
  if (!handler) {
    console.error(`[cron] No handler registered for expression: ${cron}`);
    return;
  }
  await handler(env);
}

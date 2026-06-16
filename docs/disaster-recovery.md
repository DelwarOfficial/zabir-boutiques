# Disaster Recovery [Master_Prompt v7.0 §19, G14]

## Recovery Objectives

- **RPO** (Recovery Point Objective): **6 hours**. Aligned with the
  every-6-hour D1 backup cron. Worst-case data loss is the orders
  created in the last 6 hours.
- **RTO** (Recovery Time Objective): **2 hours**. The time to restore
  the latest backup into a fresh D1 and re-deploy.

## Backup Strategy

- **Frequency**: Every 6 hours, via the `d1-backup` queue consumer
  triggered by cron `0 */6 * * *`.
- **Destination**: R2 bucket `zabir-backups` (per env: `-staging`,
  `-dev`).
- **Format**: SQL dump (one `INSERT INTO … VALUES …` per row, with
  `BEGIN TRANSACTION;` and `COMMIT;` wrapping). See
  `src/lib/maintenance/backup.ts` for the implementation.
- **Retention**: 30 days in R2 Standard. Older backups are deleted
  automatically (handled in `backupD1ToR2`).
- **Verification**: Every Sunday 09:00 UTC the `verifyBackup` cron
  checks that a fresh backup exists. If not, a `low_stock_alerts`
  row is written with `variant_id = 'system'`.

## Restoration Procedure

**Manual runbook** (used when a fresh D1 needs to be restored from
backup):

```bash
# 1. List available backups
npx wrangler r2 object list zabir-backups --prefix=backups/

# 2. Pick the most recent valid backup (check timestamp).
# 3. Download it:
npx wrangler r2 object get zabir-backups backups/d1-2026-06-09-03-00-00.sql --file=restore.sql

# 4. Inspect restore.sql (optional sanity check):
head -20 restore.sql

# 5. Apply to staging first:
npm run db:migrate:local  # run 0010, 0011, 0012 if not already
npx wrangler d1 execute zabir-db-staging --remote --file=restore.sql

# 6. Verify row counts against the backup metadata:
#    Compare SELECT COUNT(*) per table against expected counts in the
#    backup log (see src/lib/maintenance/backup.ts).

# 7. Smoke test:
#    - Open the staff dashboard. /staff/orders lists recent orders.
#    - Open the storefront. /products/slug loads.
#    - Run a test checkout (UddoktaPay sandbox).

# 8. If staging looks good, repeat against prod:
npx wrangler d1 execute zabir-db --remote --file=restore.sql

# 9. Purge all caches (after data restoration, caches are stale):
npx wrangler cache purge --everything

# 10. Monitor error rates for 30 min. Page the on-call if errors > 1%.
```

## Incident Response

- **P1 (revenue-impacting: payments down, checkout broken)**:
  1. Page immediately. Acknowledge within 15 min.
  2. Communicate every 30 min in `#zabir-ops`.
  3. Post-mortem within 48 hours.
  4. Escalate to Cloudflare support within 1 hour if unresolved.
- **P2 (degraded: slow, partial failures)**: Notify within 15 min.
- **P3 (minor: UI bugs)**: Daily digest.

## What is NOT covered

- Cross-region R2 replication is not configured. Backups live in the
  same region as primary data. If a regional outage hits Cloudflare,
  RPO increases to (next backup in another region) — currently 0.
  Tracked in Phase 3 (G13 acceptance: staging mirrors production).
- Real-time replication to a hot-standby D1 is not implemented. The
  every-6-hour backup is the recovery point.

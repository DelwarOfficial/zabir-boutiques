# Deployment Guide

This document is the runbook for shipping a new version of Zabir
Boutiques to Cloudflare Pages + Workers. It assumes the operator has
Wrangler 4.x installed (`npm i -g wrangler`) and Cloudflare API access
for the `zabir-boutiques` account.

## Pre-deploy checklist

### 1. Local validation

```bash
npm install
npm run typecheck      # astro check + tsc --noEmit — must report 0 errors
npm test               # vitest — must report 219 tests passing
npm run build          # snapshots + astro + bundlewatch — must pass
```

The build artifact is `dist/client/` (static assets) and
`dist/server/` (the Worker). Confirm:

- `dist/bundlewatch-report.json` shows `totalGzBytes` ≤ 76657
- `dist/server/wrangler.json` is generated (this is what wrangler
  actually deploys).

### 2. Migration status

```bash
npm run db:migrate:status    # via tsx scripts/migrate.ts --status
```

Compare `Applied` and `Pending` lists against the `db/migrations/`
folder. Every migration in `db/migrations/0001..NNNN.sql` must have
a paired `db/migrations/rollback/NNNN_*.sql`.

For a v7.0.0 deploy, the new migrations are:

- `0013_order_state_machine_constraints.sql`
- `0014_inventory_baseline.sql`

If applying to a fresh database, all 14 migrations run in order. If
applying to an existing v6.8D database, the rebuild steps in 0013
will run automatically.

### 3. Secrets

Verify each secret is set on the target environment. **The deploy WILL
fail if `BACKUP_ENCRYPTION_KEY` is missing** — the d1-backup cron
throws on every run if the env is unconfigured.

```bash
# Production
for s in SESSION_SECRET PASSWORD_PEPPER TINIFY_API_KEY \
         UDDOKTAPAY_API_KEY UDDOKTAPAY_BASE_URL FRAUDBD_API_KEY \
         DEEPSEEK_API_KEY OPENAI_API_KEY TURNSTILE_SECRET_KEY \
         API_KEY_PEPPER AUDIT_LEDGER_SECRET BACKUP_ENCRYPTION_KEY \
         RESEND_API_KEY RESEND_FROM_EMAIL \
         AI_FALLBACK_KEY AI_FALLBACK_URL \
         CF_API_TOKEN CF_ZONE_ID; do
  wrangler secret put "$s" --env production
done

# Repeat for staging
for s in ...; do wrangler secret put "$s" --env staging; done
```

`wrangler secret put` is interactive. The deploy script in CI uses
`wrangler secret:bulk` from a JSON file — see `.github/workflows/`.

### 4. D1 + KV + R2 + Queue resources

Confirm the bindings are real (not placeholders):

```bash
# Show D1 database IDs and confirm they are populated
grep -E '"database_id"|"id"' wrangler.jsonc
# Every line should have a real 32-char hex ID, NOT "REPLACE_WITH_..."
```

If any line shows `REPLACE_WITH_*`, the deploy will fail with a
binding error. Replace the placeholders with the real IDs from
`wrangler d1 list`, `wrangler kv list`, `wrangler r2 bucket list`,
`wrangler queues list`.

### 5. Durable Object migrations

The DOs require a one-time migration to create the underlying SQLite
tables. `wrangler.jsonc` has the migrations declared:

```json
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["VariantInventoryDO", "IdempotencyDO"] },
  { "tag": "v2", "new_sqlite_classes": ["BudgetCounterDO", "WafRules"] }
]
```

If you add a new DO class, append a `v3` migration entry. The deploy
will fail if the migration is missing.

## Deploy

### Staging (mandatory first)

```bash
# Apply migrations to staging
wrangler d1 execute zabir-db-staging --remote --file=db/migrations/0001_initial_v6_8a_schema.sql
wrangler d1 execute zabir-db-staging --remote --file=db/migrations/0002_indexes.sql
# ... continue through 0014

# Deploy
wrangler deploy --env staging

# Smoke tests
# 1. Open https://staging.zabirboutiques.com/ — home renders
# 2. Open /products/<a-real-slug> — JSON-LD + canonical present
# 3. Open /api/stock/<variant-id> — returns {"available": N}
# 4. Open /api/search?q=b — returns product list
# 5. Open /staff/login — Turnstile renders
# 6. Run a sandbox UddoktaPay charge end-to-end
# 7. Wait 6 hours and verify the d1-backup cron wrote a new R2 object
```

### Production (after staging passes)

```bash
# Apply migrations to production
wrangler d1 execute zabir-db --remote --file=db/migrations/0001_initial_v6_8a_schema.sql
wrangler d1 execute zabir-db --remote --file=db/migrations/0002_indexes.sql
# ... continue through 0014

# Deploy
wrangler deploy

# Smoke tests
# Same as staging, against https://zabirboutiques.com
```

### Single-shot

For CI (or a one-liner that runs both):

```bash
npm run db:migrate:prod && npm run build && wrangler deploy
```

The `db:migrate:prod` script is a chain of 14 `wrangler d1 execute`
commands. If any one fails, the chain aborts and the deploy does not
run. The script is idempotent: every migration ends with `INSERT OR
IGNORE INTO schema_migrations` so re-running it is safe.

## Post-deploy verification

### Within 5 minutes

- **Cron `*/5 * * * *` should run.** Watch `wrangler tail` for the
  `[cron] Triggered: */5 * * * *` log line.
- **CSP should be strict-dynamic.** `curl -I
  https://zabirboutiques.com/ | grep -i 'content-security-policy'`
  must include `nonce-` and `'strict-dynamic'`.
- **Stock badge must not write KV.** `wrangler kv key list --binding
  CACHE --prefix=rl:` shows only rate-limit counters, never
  stock-badge reads.

### Within 1 hour

- **The 15-minute reconciliation cron should run.** Open the Cloudflare
  dashboard → Workers → Logs → filter for
  `reconcilePendingPayments`. The output should show
  `result.fixed=0, result.abandoned=0` for a healthy site.
- **The hourly session-cleanup cron should run.** Look for
  `cleanExpiredSessions` invocations.

### Within 6 hours

- **The d1-backup cron should write a new R2 object.** Check the
  `zabir-backups` bucket for a new `backups/d1-<timestamp>.sql.enc`
  with a 32-byte IV header.
- **The verifyBackup cron (weekly Sunday) downloads + decrypts the
  latest backup.** Look for `[verifyBackup] drill` log lines. Failures
  trigger a `low_stock_alert`.

### Within 24 hours

- **The audit chain integrity check (daily 03:00 UTC) should report
  `valid: true`.** Query:
  ```sql
  SELECT * FROM audit_integrity_alerts ORDER BY checked_at DESC LIMIT 1;
  ```
  `valid` should be `1`.

## Rollback

If a deploy breaks production, two options exist:

### Option A: Revert the Worker code (preferred)

```bash
git revert HEAD
git push origin main
# CI will redeploy the previous version automatically
```

The Worker code is stateless; reverts are safe as long as the D1
schema is unchanged. If the deploy included a schema change (new
migration), prefer Option B.

### Option B: Roll back a migration

```bash
# Roll back the most recent migration
npx tsx scripts/migrate.ts --rollback-last

# Or a specific version
npx tsx scripts/migrate.ts --rollback 0014
```

Then redeploy the prior code:

```bash
npm run build && wrangler deploy
```

The `migrate.ts` script expects a paired rollback file at
`db/migrations/rollback/<version>_rollback_<rest>.sql`. All 14
migrations have one. If a rollback is missing, the script exits with
a clear error — never silently leaves a half-applied state.

## Emergency contacts

- **Owner** (always-on): see `site_settings` in the D1 admin panel
- **Cloudflare support**: Pro plan tickets via the dashboard
- **UddoktaPay support**: `support@uddoktapay.com`
- **FraudBD support**: see FraudBD dashboard

## Reference

- [Master_Prompt v7.0](./Master_Prompt.md) — source of truth for the
  audit, state machine, and architecture.
- [AGENTS.md](./AGENTS.md) — agent rules (architecture overview,
  guardrails, graphify).
- [docs/disaster-recovery.md](./docs/disaster-recovery.md) — backup
  + restore runbook.
- [docs/alerting.md](./docs/alerting.md) — alert rules and the
  observability model.
- [CHANGELOG.md](./CHANGELOG.md) — release notes.

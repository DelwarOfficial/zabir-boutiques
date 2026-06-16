# Changelog

All notable changes to Zabir Boutiques are documented here. Versions
follow [Semantic Versioning](https://semver.org/). The **v7.0.0** entry
below covers the v6.8D → v7.0 transition that landed in the same
release branch as the critical audit fixes.

## [7.0.0] — 2026-06-16

The v7.0 release closes the critical-audit findings and adds the
Phase-7 inventory reconciliation + backup restore-and-verify drill.

### Security (critical-audit fixes)

- **P0-001 — Webhook inline path.** Refactored the inline and queue
  paths to share a single claim-gated `applyPaymentVerified`
  function in `src/lib/payments.ts`. Idempotency is enforced by the
  `payment_events` UNIQUE claim that runs before any other DB write.
- **P0-002 — Refund over-payment + missing `payments.status='refunded'`.**
  `src/pages/api/staff/returns/[id]/approve.ts` now gates the UddoktaPay
  refund call on a `payment_events` UNIQUE claim, caps the refund at
  the original `payment.amount_paisa`, and drives the order state
  machine all the way to `refunded` with explicit history rows.
- **P0-003 — Login PBKDF2 upgrade race.** `src/pages/api/staff/login.ts`
  now uses a conditional `UPDATE … WHERE password_hash=? AND
  password_salt IS NULL` so a concurrent login cannot overwrite the
  new salt. The session insert + last-login write are wrapped in a
  single `db.batch({ atomic: true })`.
- **P0-004 — Audit-trail garbage from_status.** The
  partial-prepay sweeper now reads `orders.status` and writes the
  correct value to `order_status_history.from_status`. The
  reconciliation cron now also writes history rows on auto-cancel.
  Migration 0013 adds CHECK constraints on `order_status_history`.
- **P0-005 — Order confirm double-deduct.** `confirm.ts` now uses an
  idempotency key + atomic batch (deduct + confirm reservations +
  order-status + history) with a `status=?3` guard. A no-reservation
  path now returns 409 instead of silently flipping the order.
- **P0-006 — Partial-prepay state divergence.** New
  `markPaymentPartiallyPaid` writes `payments.status='partially_paid'`
  on a partial-prepay verify. Migration 0013 extends the
  `payments.status` CHECK to include `'partially_paid'` and
  `'partially_refunded'`.
- **P0-007 — Unencrypted backups.** `backupD1ToR2` now AES-256-GCM
  encrypts the SQL dump with a per-backup random IV, stores the
  HMAC-SHA256 signature in `customMetadata`, and writes a
  `media_objects` row with `owner_type='backup'`, `visibility='owner_only'`.
  Decryption requires `BACKUP_ENCRYPTION_KEY` (or `SESSION_SECRET`
  fallback). The prune path writes audit_log rows.
- **P0-008 — Sitemap never written to R2.** `generateSitemap` now
  actually calls `media.put('sitemap.xml', xml, ...)`.

### Security (P1 hardening)

- **P1-001 — Legacy `session=` cookie.** Dropped from
  `middleware.ts`, `rbac.ts`, and `logout.ts`. Only `__Host-session`
  is accepted; the bare `session=` and `csrf-token=` cookies are no
  longer read.
- **P1-002 — Refund state-machine dead code.** `returns/approve.ts`
  drives the order to `refunded` with an explicit history row, so the
  state-machine's `refund_partial` side effect is finally fired.
- **P1-003 — Reconciliation race.** The cancel and verify passes use
  status-guarded atomic batches; the verify path shares
  `applyPaymentVerified` with the inline webhook and queue consumer.
- **P1-004 — Client money tampering silent.** `assertNoClientMoneyTrust`
  now emits an Analytics Engine metric, increments a KV-bucketed tamper
  counter, and writes a `low_stock_alert` when an IP exceeds 10
  attempts in 5 minutes.
- **P1-005 — CSP missing inline scripts.** `csp-hashes-plugin.mjs`
  now walks `src/{pages,components,layouts,islands}` for `<script>`
  blocks and adds their SHA-256 to the hash list.
- **P1-006 — PII leaks via `console.*`.** All 20 call sites wired
  to `safeLog` (analytics, ai-client, archive, audit, cache-api,
  checkout-pricing, content-moderation, cron-dispatch, login,
  maintenance/{archive,backup,reconciliation}, middleware, queues,
  rbac, AI gen, payments/create, staff/orders/create, entry-cloudflare).
- **P1-007 — Session idle/revoke race.** `getCurrentStaffUser` now
  uses a single guarded UPDATE. Migration 0013 adds
  `trg_staff_sessions_no_refresh_on_revoked` to block any UPDATE on a
  revoked session.

### Operations

- **Phase-7 inventory reconciliation** (`src/lib/maintenance/inventory-reconcile.ts`).
  The previous version was a no-op for most variants. The new
  implementation reads `inventory_baseline` (migration 0014), compares
  live `inventory_items` against the baseline, emits
  `low_stock_alert` on drift > 2 units (soft) or > 10 units (hard),
  re-syncs the `VariantInventoryDO` with the live D1 state, and
  refreshes the baseline so subsequent runs only flag *new* drift.
  Bounded to 500 variants per invocation.
- **Phase-7 backup restore-and-verify drill** (`src/lib/maintenance/backup.ts`).
  `verifyBackup` (weekly Sunday 09:00 UTC) now downloads the latest
  R2 object, AES-256-GCM decrypts it with `BACKUP_ENCRYPTION_KEY`,
  verifies the HMAC signature, parses per-table row counts, and
  writes a summary `low_stock_alert`.
- **Paired migration rollbacks.** 14 rollback files in
  `db/migrations/rollback/` (0001..0014). `scripts/migrate.ts` was
  updated to discover rollbacks via the `<version>_rollback_<rest>.sql`
  convention.

### Schema

- `db/migrations/0013_order_state_machine_constraints.sql` —
  rebuilds `payments`, `orders`, and `order_status_history` to extend
  CHECK constraints; adds the no-refresh-on-revoked trigger.
- `db/migrations/0014_inventory_baseline.sql` — adds the
  `inventory_baseline` table and seeds it from current
  `inventory_items`.

## [6.8.0] — 2026-06-04

- Astro 6.4.4 + `@astrojs/cloudflare` 13.6.1 (advanced runtime).
- 22-table D1 schema, 4 Durable Objects, 5 Queues, 9 cron triggers.
- Server-authoritative checkout pricing, idempotency keys,
  reservation-first inventory.
- UddoktaPay + FraudBD + Turnstile + Resend + Workers AI + DeepSeek.
- 8-role RBAC, HMAC sessions, session-independent CSRF, KV session
  blacklist mirror, tampered-evident audit log with chain hash.

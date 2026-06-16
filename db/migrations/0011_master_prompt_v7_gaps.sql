-- Zabir Boutiques v7.0 — Master_Prompt Gap Tables
-- Adds the tables called for in Master_Prompt v7.0 §3.1, §11.4, §15, §16.2, §20.1
-- that are missing from the v6.8D schema.

-- 1. stock_adjustments — every manual change to inventory is recorded here.
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  adjusted_by TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_variant ON stock_adjustments(variant_id, created_at);

-- 2. email_log — every transactional email attempt is recorded for bounce tracking.
CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  email_type TEXT NOT NULL,
  recipient TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','sent','failed','bounced')),
  sent_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_log_order ON email_log(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_log_status ON email_log(status, created_at);

-- 3. return_requests — the Master_Prompt §7.2 return flow.
CREATE TABLE IF NOT EXISTS return_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  items_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','completed')),
  reviewed_by TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
  refund_amount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount_paisa >= 0),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_return_requests_order ON return_requests(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_return_requests_status ON return_requests(status, created_at);

-- 4. sitemap_metadata — last build of the sitemap, served at /sitemap.xml.
CREATE TABLE IF NOT EXISTS sitemap_metadata (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  last_modified TEXT NOT NULL,
  priority REAL NOT NULL DEFAULT 0.5,
  change_frequency TEXT NOT NULL DEFAULT 'weekly'
);
CREATE INDEX IF NOT EXISTS idx_sitemap_metadata_modified ON sitemap_metadata(last_modified);

-- 5. customer_consent — privacy compliance (cookie consent, marketing opt-in).
CREATE TABLE IF NOT EXISTS customer_consent (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  consent_type TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 0 CHECK (granted IN (0,1)),
  granted_at TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_consent_session ON customer_consent(session_id, consent_type);
CREATE INDEX IF NOT EXISTS idx_customer_consent_type ON customer_consent(consent_type, granted);

-- 6. coupon_brute_force — track per-session coupon attempt failures (rate limit, lockout).
CREATE TABLE IF NOT EXISTS coupon_brute_force (
  session_id TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_attempt_at TEXT NOT NULL
);

-- 7. session_blacklist — KV-backed mirror; D1 mirror allows admin lookups.
CREATE TABLE IF NOT EXISTS session_blacklist (
  token_hash TEXT PRIMARY KEY,
  staff_user_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  revoked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_blacklist_expires ON session_blacklist(expires_at);

-- 8. Extend orders.status CHECK to add 'returned' (Master_Prompt §7.1).
-- SQLite cannot ALTER CHECK; we have to rename + recreate. We carry this
-- out via the standard pattern used in 0009_staff_roles_developer_auditor.sql.
-- For fresh DBs the 0001 schema already covers this; for legacy DBs the
-- admin must run the rebuild manually in the Dashboard SQL console
-- (PRAGMA foreign_keys = OFF; rebuild; PRAGMA foreign_keys = ON;).
-- The CHECK clause is documented here for the rebuild script.
--
--   CREATE TABLE orders_new (
--     ... all columns from 0001 ...
--     status TEXT NOT NULL DEFAULT 'pending_review'
--       CHECK (status IN (
--         'pending_review','pending_payment','payment_verified','paid_over_allocated',
--         'staff_confirmed','packing','shipped','delivered','returned','cancelled','refunded'
--       )),
--     ...
--   );
--   INSERT INTO orders_new SELECT * FROM orders;
--   DROP TABLE orders;
--   ALTER TABLE orders_new RENAME TO orders;
--
-- 9. Extend payments.status CHECK to add 'partially_refunded' and 'refunded'.
-- Same caveat: 0001 should be updated for fresh DBs; legacy DBs need a
-- manual rebuild. Schema is documented in the rebuild script.
--
--   CHECK (status IN (
--     'created','pending','processing','paid','partially_paid','failed',
--     'cancelled','expired','refunded','partially_refunded'
--   ))

INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ('0011_master_prompt_v7_gaps', '2026-06-09 00:00:00');

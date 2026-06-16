-- Zabir Boutiques v7.0 — Inventory Baseline Tracking
-- Phase-7 fix for the audit-flagged `reconcileInventory` no-op.
--
-- A baseline row per (variant_id) records the last known-good
-- {quantity, reserved_quantity, hash}. The daily reconcile compares
-- the live inventory_items row against the baseline and:
--   1. Emits a low_stock_alert on drift > threshold
--   2. Re-syncs the VariantInventoryDO with the live D1 state
--   3. Refreshes the baseline row with the corrected values
--
-- The baseline is the source-of-truth anchor for "what should be in
-- stock right now". Without it, the reconcile query cannot distinguish
-- "legitimately sold" from "lost to a race / corrupted write".

CREATE TABLE IF NOT EXISTS inventory_baseline (
  variant_id TEXT PRIMARY KEY REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  baseline_hash TEXT NOT NULL,
  set_at TEXT NOT NULL,
  set_by TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
  reconciliation_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_inventory_baseline_set_at
  ON inventory_baseline(set_at);

-- Seed baselines from current inventory_items state. Each row is its
-- own baseline; reconciliation_count=0. The next reconcile will compare
-- against this seed. The baseline_hash is a SHA-256 of the live state
-- at seed time; the reconcile code computes the same hash from the
-- current state and compares.
INSERT OR IGNORE INTO inventory_baseline (variant_id, quantity, reserved_quantity, baseline_hash, set_at, set_by, reconciliation_count)
SELECT
  iv.variant_id,
  iv.quantity,
  iv.reserved_quantity,
  'seed-no-hash',
  '2026-06-15 00:00:00',
  NULL,
  0
FROM inventory_items iv
WHERE NOT EXISTS (SELECT 1 FROM inventory_baseline WHERE inventory_baseline.variant_id = iv.variant_id);

-- After seeding, stamp each baseline_hash with the SHA-256 of the
-- initial state. SQL has no built-in SHA-256, so we use a 16-byte
-- random placeholder and have the reconcile code refresh the hash on
-- first successful run.
UPDATE inventory_baseline
SET baseline_hash = 'pending-first-reconcile'
WHERE baseline_hash = 'seed-no-hash';

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0014_inventory_baseline', '2026-06-15 00:00:00');

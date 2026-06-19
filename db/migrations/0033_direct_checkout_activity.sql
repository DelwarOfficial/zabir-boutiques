-- Migration: direct_checkout_activity table [Master_Prompt v7.0 §6.3]
-- D1 searchable index for direct checkout (Buy Now) abandoned session detection.
-- DirectCheckoutSessionDO publishes activity messages that the queue consumer
-- batches and upserts into this table.

CREATE TABLE IF NOT EXISTS direct_checkout_activity (
  session_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  customer_phone TEXT,
  customer_name TEXT,
  source_page TEXT,
  landing_version INTEGER NOT NULL DEFAULT 0,
  last_activity_at TEXT NOT NULL,
  converted_order_id TEXT,
  abandoned_email_sent_at TEXT,
  consent_status TEXT CHECK(consent_status IN ('unknown', 'allowed', 'denied')) DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_direct_checkout_activity_abandoned
  ON direct_checkout_activity(last_activity_at)
  WHERE converted_order_id IS NULL
    AND abandoned_email_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_direct_checkout_activity_email
  ON direct_checkout_activity(customer_email)
  WHERE customer_email IS NOT NULL;

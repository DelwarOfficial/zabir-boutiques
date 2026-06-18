-- Migration: cart_activity table [Master_Prompt v7.0 §6.3]
-- D1 searchable index for abandoned cart detection.
-- CartDO publishes lightweight messages to cart-activity queue;
-- the queue consumer batches and upserts this table.

CREATE TABLE IF NOT EXISTS cart_activity (
  session_id TEXT PRIMARY KEY,
  customer_phone TEXT,
  customer_email TEXT,
  customer_name TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  subtotal_paisa INTEGER NOT NULL DEFAULT 0,
  last_cart_update_at TEXT NOT NULL,
  checkout_started_at TEXT,
  converted_order_id TEXT,
  abandoned_1h_sent_at TEXT,
  abandoned_24h_sent_at TEXT,
  consent_status TEXT CHECK(consent_status IN ('unknown', 'allowed', 'denied')) DEFAULT 'unknown',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cart_activity_abandoned
  ON cart_activity(last_cart_update_at, abandoned_1h_sent_at, abandoned_24h_sent_at)
  WHERE converted_order_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_cart_activity_consent
  ON cart_activity(consent_status, last_cart_update_at)
  WHERE consent_status = 'allowed';

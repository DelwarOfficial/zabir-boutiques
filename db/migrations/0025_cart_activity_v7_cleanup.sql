-- Migration: V7 abandoned-cart schema cleanup [Master Plan V7 §6.3, §17.3, §35]

ALTER TABLE cart_activity ADD COLUMN abandoned_email_sent_at TEXT;

DROP INDEX IF EXISTS idx_cart_activity_abandoned;

CREATE INDEX IF NOT EXISTS idx_cart_activity_abandoned
  ON cart_activity(last_cart_update_at)
  WHERE converted_order_id IS NULL
    AND abandoned_email_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cart_activity_email
  ON cart_activity(customer_email)
  WHERE customer_email IS NOT NULL;

ALTER TABLE cart_activity DROP COLUMN abandoned_1h_sent_at;
ALTER TABLE cart_activity DROP COLUMN abandoned_24h_sent_at;

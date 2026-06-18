ALTER TABLE cart_activity ADD COLUMN abandoned_1h_sent_at TEXT;
ALTER TABLE cart_activity ADD COLUMN abandoned_24h_sent_at TEXT;
DROP INDEX IF EXISTS idx_cart_activity_email;
DROP INDEX IF EXISTS idx_cart_activity_abandoned;
CREATE INDEX IF NOT EXISTS idx_cart_activity_abandoned
  ON cart_activity(last_cart_update_at, abandoned_1h_sent_at, abandoned_24h_sent_at)
  WHERE converted_order_id IS NULL;
-- ROLLBACK_EXCEPTION: abandoned_email_sent_at left in place; preserving data is safer than dropping it.

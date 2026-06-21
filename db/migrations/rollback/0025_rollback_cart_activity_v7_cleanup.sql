ALTER TABLE cart_activity ADD COLUMN abandoned_1h_sent_at TEXT;
ALTER TABLE cart_activity ADD COLUMN abandoned_24h_sent_at TEXT;
DROP INDEX IF EXISTS idx_cart_activity_email;
DROP INDEX IF EXISTS idx_cart_activity_write_source;
DROP INDEX IF EXISTS idx_cart_activity_abandoned;
CREATE INDEX IF NOT EXISTS idx_cart_activity_abandoned
  ON cart_activity(last_cart_update_at, abandoned_1h_sent_at, abandoned_24h_sent_at)
  WHERE converted_order_id IS NULL;
-- ROLLBACK_EXCEPTION: abandoned_email_sent_at left in place; preserving data is safer than dropping it.
-- ROLLBACK_EXCEPTION: last_d1_write_at, last_d1_write_source, last_d1_write_seq left in place; the alarm + queue persistence contract continues to function with a degraded audit trail, and dropping the columns would invalidate any in-flight workers reading from CartDO.

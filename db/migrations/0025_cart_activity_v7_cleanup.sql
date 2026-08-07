-- Migration: V7 abandoned-cart schema cleanup [Master Plan V7 §6.3, §17.3, §35]
-- Forward SQL also adds queue/alarm race-contract columns per Section 6.3 "Queue vs Alarm Write Race".

ALTER TABLE cart_activity ADD COLUMN abandoned_email_sent_at TEXT;

-- Queue/alarm race contract columns (Section 6.3)
ALTER TABLE cart_activity ADD COLUMN last_d1_write_at TEXT;
ALTER TABLE cart_activity ADD COLUMN last_d1_write_source TEXT
  CHECK(last_d1_write_source IN ('alarm','cart_activity_queue','lifecycle_cleanup'));
ALTER TABLE cart_activity ADD COLUMN last_d1_write_seq INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS idx_cart_activity_abandoned;

CREATE INDEX IF NOT EXISTS idx_cart_activity_abandoned
  ON cart_activity(last_cart_update_at)
  WHERE converted_order_id IS NULL
    AND abandoned_email_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cart_activity_email
  ON cart_activity(customer_email)
  WHERE customer_email IS NOT NULL;

-- Index supporting stale-write detection during ops triage:
-- queries like "rows where queue wrote but alarm write was rejected" use this.
CREATE INDEX IF NOT EXISTS idx_cart_activity_write_source
  ON cart_activity(last_d1_write_source, last_d1_write_at);

ALTER TABLE cart_activity DROP COLUMN abandoned_1h_sent_at;
ALTER TABLE cart_activity DROP COLUMN abandoned_24h_sent_at;

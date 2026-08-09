PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE payment_events_old (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(invoice_id, event_type, status)
);

INSERT OR IGNORE INTO payment_events_old (id, payment_id, invoice_id, event_type, status, raw_payload, created_at)
SELECT id, payment_id, invoice_id, event_type, status, raw_payload, created_at
FROM payment_events;

DROP TABLE payment_events;
ALTER TABLE payment_events_old RENAME TO payment_events;

COMMIT;
PRAGMA foreign_keys = ON;

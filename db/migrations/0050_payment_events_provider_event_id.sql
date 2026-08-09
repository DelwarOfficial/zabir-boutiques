-- N-16/INV-2: payment_events dedup was UNIQUE(invoice_id, event_type, status),
-- which blocks more than replays — a second GENUINE webhook for the same
-- invoice/type/status (e.g. a provider retry with a new provider event id)
-- is silently dropped too. Replace with UNIQUE(provider, provider_event_id),
-- matching V8's intended dedup grain: identity is the provider's own event,
-- not an (invoice, type, status) tuple.
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE payment_events_new (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  provider_event_id TEXT,
  raw_payload TEXT,
  created_at TEXT NOT NULL
);

-- Backfill provider from the linked payment, and provider_event_id from the
-- existing id (which was already the provider event id / body-hash fallback
-- at insert time — see payment-webhook-ingress.ts resolveWebhookEventId).
INSERT INTO payment_events_new (id, payment_id, invoice_id, event_type, status, provider, provider_event_id, raw_payload, created_at)
SELECT pe.id, pe.payment_id, pe.invoice_id, pe.event_type, pe.status, p.provider, pe.id, pe.raw_payload, pe.created_at
FROM payment_events pe
JOIN payments p ON p.id = pe.payment_id;

DROP TABLE payment_events;
ALTER TABLE payment_events_new RENAME TO payment_events;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_provider_event
  ON payment_events(provider, provider_event_id)
  WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_events_invoice
  ON payment_events(invoice_id);

COMMIT;
PRAGMA foreign_keys = ON;

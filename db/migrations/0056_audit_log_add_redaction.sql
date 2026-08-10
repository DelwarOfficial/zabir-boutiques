-- N-11: mark individual audit_log rows as PII-redacted without touching
-- previous_hash/chain_hash, so the hash chain stays intact for every row
-- after them.
ALTER TABLE audit_log ADD COLUMN redacted_at TEXT;

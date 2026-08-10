-- N-11: paired with 0056's redacted_at — records why a row was redacted.
ALTER TABLE audit_log ADD COLUMN redacted_reason TEXT;

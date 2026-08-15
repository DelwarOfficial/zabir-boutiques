-- N-20: make audit_log.redaction_hash write-once.
--
-- 0058's trigger set deliberately leaves redaction_hash writable so
-- redactAuditLogEntry can populate it in the same UPDATE that blanks
-- metadata_json. Without this guard an attacker with D1 write access could
-- redact a row, tamper with its surviving columns, and then overwrite
-- redaction_hash to match — re-opening exactly the hole 0059 closes.
-- Once set, it can never be changed.
CREATE TRIGGER IF NOT EXISTS trg_audit_log_redaction_hash_write_once
BEFORE UPDATE OF redaction_hash ON audit_log
WHEN OLD.redaction_hash IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'audit_log.redaction_hash is write-once');
END;

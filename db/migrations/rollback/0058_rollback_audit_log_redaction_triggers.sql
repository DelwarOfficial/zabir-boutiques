-- Rollback N-19: restore 0008's blanket append-only trigger on audit_log.
-- NOTE: doing so re-breaks redactAuditLogEntry() — the N-11 redaction path
-- will abort again. Only roll back if redaction is also being reverted.

DROP TRIGGER IF EXISTS trg_audit_log_immutable_columns;

DROP TRIGGER IF EXISTS trg_audit_log_metadata_redact_only;

DROP TRIGGER IF EXISTS trg_audit_log_redaction_immutable;

CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

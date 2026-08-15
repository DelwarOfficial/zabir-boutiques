-- Rollback N-20 write-once guard on audit_log.redaction_hash.
DROP TRIGGER IF EXISTS trg_audit_log_redaction_hash_write_once;

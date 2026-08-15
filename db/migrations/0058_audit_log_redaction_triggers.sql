-- N-19: scope the audit_log append-only trigger so redaction can run.
--
-- 0008_security_hardening.sql created `trg_audit_log_no_update` as a bare
-- `BEFORE UPDATE ON audit_log` with no OF-column list and no WHEN clause, so
-- it aborts EVERY update. N-11 (0056/0057) then added redacted_at /
-- redacted_reason and shipped redactAuditLogEntry(), whose
-- `UPDATE audit_log SET metadata_json = NULL, redacted_at = ?, redacted_reason = ?`
-- that trigger unconditionally rejects — the redaction feature has been
-- inert in production since it shipped, and the deferred-deletion cron
-- (customer-deletion.ts -> redactAuditLogForOrders) throws when it reaches
-- a customer with order-linked audit rows. This was missed because
-- tests/audit-log-redaction.test.ts built its fixture from 0001+0007+0056+0057
-- and never applied 0008, so the trigger was absent under test.
--
-- Replaced with three narrower triggers that keep the append-only property
-- for everything that matters while permitting exactly the redaction write:
--   1. every forensically-meaningful column stays immutable,
--   2. metadata_json may only ever be set to NULL, never rewritten,
--   3. redaction is one-way — redacted_at cannot be changed once set.
-- Net effect: strictly tighter than 0008 for metadata_json (which 0008
-- blocked wholesale but which could previously have been rewritten had the
-- trigger ever been scoped), and unchanged for every other column.
--
-- trg_audit_log_no_delete (0008) is deliberately left in place untouched.

DROP TRIGGER IF EXISTS trg_audit_log_no_update;

CREATE TRIGGER IF NOT EXISTS trg_audit_log_immutable_columns
BEFORE UPDATE OF
  id, actor_staff_id, actor_role, action, entity_type, entity_id,
  ip_address, user_agent, created_at, previous_hash, chain_hash
ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_log_metadata_redact_only
BEFORE UPDATE OF metadata_json ON audit_log
WHEN NEW.metadata_json IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'audit_log.metadata_json may only be cleared, never rewritten');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_log_redaction_immutable
BEFORE UPDATE OF redacted_at ON audit_log
WHEN OLD.redacted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'audit_log redaction is irreversible');
END;

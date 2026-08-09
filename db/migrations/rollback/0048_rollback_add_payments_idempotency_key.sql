-- ROLLBACK_EXCEPTION: column idempotency_key left in place; harmless and idempotent.
SELECT 1 WHERE 0;

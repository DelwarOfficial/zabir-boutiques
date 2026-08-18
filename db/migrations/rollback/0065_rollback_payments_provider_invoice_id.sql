-- ROLLBACK_EXCEPTION: column left in place; harmless and idempotent.
SELECT 1 WHERE 0;

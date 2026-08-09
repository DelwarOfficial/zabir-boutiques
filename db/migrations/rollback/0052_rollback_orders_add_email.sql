-- ROLLBACK_EXCEPTION: column email left in place; harmless and idempotent.
SELECT 1 WHERE 0;

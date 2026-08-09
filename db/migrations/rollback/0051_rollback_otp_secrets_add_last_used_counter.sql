-- ROLLBACK_EXCEPTION: column last_used_counter left in place; harmless and idempotent.
SELECT 1 WHERE 0;

-- ROLLBACK_EXCEPTION: column left in place; harmless and idempotent (NULL when unused).
SELECT 1 WHERE 0;

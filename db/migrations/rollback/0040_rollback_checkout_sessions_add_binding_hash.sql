-- ROLLBACK_EXCEPTION: column bindingHash left in place; harmless and idempotent.
-- SQLite requires a table rebuild to drop a column; not worth it for a rollback.
SELECT 1 WHERE 0;

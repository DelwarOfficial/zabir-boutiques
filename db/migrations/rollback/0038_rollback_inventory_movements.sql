-- Rollback: remove added columns
-- SQLite cannot drop columns, so this is a no-op marker.
-- To truly rollback, restore from backup before this migration.
SELECT 1;

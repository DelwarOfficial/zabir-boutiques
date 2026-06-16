-- Rollback for 0009_staff_roles_developer_auditor.sql
-- This migration is a no-op (it only recorded the version for fresh
-- databases). For legacy DBs that ran the staff_users rebuild via
-- the dashboard, the rebuild is not reverted by this file. Use the
-- dashboard script in the original migration comments to revert the
-- role CHECK if needed.

DELETE FROM schema_migrations WHERE version = '0009_staff_roles_developer_auditor';

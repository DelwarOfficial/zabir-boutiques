-- Rollback for 0005_password_salt.sql
-- Removes the per-user password salt column. WARNING: any staff
-- users with a non-null password_salt at rollback time will fail
-- subsequent logins because the password verification path expects
-- the salt. Reset passwords via a one-shot script before running.
ALTER TABLE staff_users DROP COLUMN password_salt;

DELETE FROM schema_migrations WHERE version = '0005_password_salt';

-- Rollback for 0036_rbac_management.sql
-- Reverses: roles + role_permissions tables (seeded system roles/permissions
-- are removed with the tables) and their indexes.
-- role_permissions FK references roles ON DELETE CASCADE, but both are dropped
-- explicitly to keep the rollback self-contained. Indexes drop with tables.

DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS roles;
